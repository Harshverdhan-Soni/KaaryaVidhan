import { ref, push, set, update, get } from 'firebase/database';
import { db } from './firebase';

/**
 * Notifications have two halves that work independently:
 *
 *  1. IN-APP  — a row under /notifications/{empId}. Always works, everywhere,
 *     no setup. The bell in the header reads it live.
 *  2. PUSH    — a Cloud Function watches that same path and sends a real push
 *     to any device the person has registered. Needs Firebase Cloud Messaging
 *     to be configured (see PUSH-SETUP.md); if it is not, the in-app half still
 *     works and nothing breaks.
 *
 * So every notify() call is useful even before push is switched on.
 */

/** Send one notification to one person. Never throws — a failed notice must
 *  never roll back the action that triggered it. */
export async function notify(empId, { type, title, body = '', taskId = null }) {
  if (!empId) return;
  try {
    const id = push(ref(db, `notifications/${empId}`)).key;
    await set(ref(db, `notifications/${empId}/${id}`), {
      id, type, title, body, taskId, at: Date.now(), read: false
    });
  } catch (e) {
    console.warn('notification not delivered', e);
  }
}

/** Same notice to several people at once. */
export async function notifyMany(empIds, payload) {
  await Promise.all([...new Set(empIds.filter(Boolean))].map((id) => notify(id, payload)));
}

export async function markRead(empId, nid) {
  await update(ref(db, `notifications/${empId}/${nid}`), { read: true });
}

export async function markAllRead(empId) {
  const snap = await get(ref(db, `notifications/${empId}`));
  const all = snap.val() || {};
  const patch = {};
  for (const k of Object.keys(all)) if (!all[k].read) patch[`${k}/read`] = true;
  if (Object.keys(patch).length) await update(ref(db, `notifications/${empId}`), patch);
}

export async function clearAll(empId) {
  await set(ref(db, `notifications/${empId}`), null);
}

/* ----------------------------- push (FCM) --------------------------------- */

/**
 * Register the messaging service worker and read THIS device's FCM token.
 * Assumes the caller has already confirmed a VAPID key is present, that the
 * Notification/serviceWorker APIs exist, and (for a silent flow) that permission
 * is granted — getToken() does not prompt on its own. Returns
 * { supported, token }: supported=false means this browser can't do FCM,
 * token=null means none could be obtained. Both register and unregister go
 * through here so they always act on the exact same token.
 */
async function deviceToken() {
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) return { supported: false, token: null };

  // The worker gets the Firebase config through its URL, so the file itself
  // stays generic and nothing has to be hand-edited per deployment.
  const e = import.meta.env;
  const qs = new URLSearchParams({
    k: e.VITE_FB_API_KEY || '', d: e.VITE_FB_AUTH_DOMAIN || '',
    p: e.VITE_FB_PROJECT_ID || '', s: e.VITE_FB_MESSAGING_SENDER_ID || '',
    a: e.VITE_FB_APP_ID || ''
  }).toString();
  const reg = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${qs}`);
  const token = await getToken(getMessaging(), { vapidKey: e.VITE_FCM_VAPID_KEY, serviceWorkerRegistration: reg });
  return { supported: true, token: token || null };
}

/**
 * Store this device's push token against the signed-in employee. Safe to call on
 * every sign-in: it is a no-op when the browser cannot do push, when the user
 * has declined, or when messaging has not been configured. Returns a short
 * status string for the UI.
 *
 * `silent: true` is for automatic calls (e.g. right after login): it NEVER shows
 * a permission prompt. It only proceeds when permission has already been granted;
 * if permission is 'default' or 'denied' it does nothing and returns 'skipped'.
 * The non-silent path (the bell's "Notify me" button) is unchanged: it asks.
 */
export async function registerPush(empId, { silent = false } = {}) {
  const vapid = import.meta.env.VITE_FCM_VAPID_KEY;
  if (!vapid) return 'not-configured';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';

  try {
    if (silent) {
      // A silent call must never surface a browser prompt — only act on an
      // already-granted permission.
      if (Notification.permission !== 'granted') return 'skipped';
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return 'denied';
    }

    const { supported, token } = await deviceToken();
    if (!supported) return 'unsupported';
    if (!token) return 'no-token';

    // Tokens are per-device; a person may legitimately have several.
    await set(ref(db, `fcmTokens/${empId}/${token}`), { at: Date.now(), ua: navigator.userAgent.slice(0, 120) });
    return 'enabled';
  } catch (e) {
    console.warn('push registration failed', e);
    return 'error';
  }
}

/**
 * Detach this device's push token from an employee — called on logout so a
 * shared browser stops delivering the previous user's notifications. Removes
 * ONLY /fcmTokens/{empId}/{thisToken}, never the parent node, so the person's
 * OTHER devices keep receiving. Deliberately does NOT call FCM deleteToken():
 * the browser keeps the same token, so the next user's (or a later) silent
 * re-register is instant. Never throws — a failure here must not block sign-out.
 */
export async function unregisterPush(empId) {
  try {
    if (!empId) return;
    const vapid = import.meta.env.VITE_FCM_VAPID_KEY;
    if (!vapid) return;                                     // push not configured
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    // Nothing was ever stored from this device unless permission was granted,
    // and without it getToken() would prompt — which logout must never do.
    if (Notification.permission !== 'granted') return;

    const { token } = await deviceToken();
    if (!token) return;

    await set(ref(db, `fcmTokens/${empId}/${token}`), null);
  } catch (e) {
    console.warn('push unregister failed', e);
  }
}

/** Show pushes that arrive while the app is open and focused. */
export async function listenForeground(onMessageCb) {
  try {
    const { getMessaging, onMessage, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return () => {};
    return onMessage(getMessaging(), onMessageCb);
  } catch { return () => {}; }
}
