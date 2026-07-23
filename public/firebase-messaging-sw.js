/* Firebase Cloud Messaging background handler.
   Shows a notification when a push arrives while the app is closed or in the
   background. The config below is filled in at build time from .env — see
   PUSH-SETUP.md. Safe to leave as-is if push is not configured: the file simply
   never receives anything. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

self.addEventListener('fetch', () => {});   // keeps the SW eligible for install

/* The config arrives as query parameters on the registration URL, so this file
   never has to be edited by hand and no keys are committed here. */
const q = new URL(self.location).searchParams;
firebase.initializeApp({
  apiKey: q.get('k'),
  authDomain: q.get('d'),
  projectId: q.get('p'),
  messagingSenderId: q.get('s'),
  appId: q.get('a')
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, taskId } = payload.data || {};
  self.registration.showNotification(title || 'KaaryaVidhan', {
    body: body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-48.png',
    tag: taskId || 'kaaryavidhan',
    data: { taskId }
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w) return w.focus();
    return clients.openWindow('/');
  }));
});
