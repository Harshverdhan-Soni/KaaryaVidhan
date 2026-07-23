import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { createHash, randomInt } from 'node:crypto';
import { onValueCreated } from 'firebase-functions/v2/database';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const db = () => getDatabase();

/* PINs are never stored as typed and never leave the server. */
const hash = (empId, pin) => createHash('sha256').update(`kaarya:${empId}:${pin}`).digest('hex');
const newPin = () => String(randomInt(1000, 10000));

async function requireAdmin(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
  return req.auth.uid;
}

/**
 * The only way in. The client never sees a PIN and cannot assert who it is —
 * the role travels in the token, and every database rule reads it from there.
 */
export const login = onCall(async (req) => {
  const empId = String(req.data?.empId || '').trim();
  const pin   = String(req.data?.pin || '').trim();
  if (!empId || !pin) throw new HttpsError('invalid-argument', 'Employee ID and PIN are required.');

  const snap = await db().ref(`employees/${empId}`).get();
  if (!snap.exists()) throw new HttpsError('not-found', 'No employee with that ID.');
  const emp = snap.val();
  if (emp.active === false) throw new HttpsError('permission-denied', 'This account is inactive.');

  // Simple throttle: five wrong PINs buys a fifteen minute wait.
  const gateRef = db().ref(`_gate/${empId}`);
  const gate = (await gateRef.get()).val() || { fails: 0, until: 0 };
  if (gate.until > Date.now())
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in a few minutes.');

  const stored = (await db().ref(`pins/${empId}`).get()).val();
  if (!stored || stored !== hash(empId, pin)) {
    const fails = (gate.fails || 0) + 1;
    await gateRef.set({ fails, until: fails >= 5 ? Date.now() + 15 * 60000 : 0 });
    throw new HttpsError('permission-denied', 'That PIN does not match.');
  }
  await gateRef.remove();

  const token = await getAuth().createCustomToken(empId, {
    role: emp.role || 'employee',
    department: emp.department || ''
  });
  await db().ref(`employees/${empId}/lastLogin`).set(Date.now());
  return { token };
});

/**
 * Bulk create from the admin's spreadsheet. Roles are derived here, not trusted
 * from the client: you are a manager because somebody reports to you.
 */
export const importEmployees = onCall(async (req) => {
  await requireAdmin(req);
  const rows = Array.isArray(req.data?.rows) ? req.data.rows : [];
  const mode = req.data?.mode === 'skip' ? 'skip' : 'merge';
  if (!rows.length) throw new HttpsError('invalid-argument', 'Nothing to import.');
  if (rows.length > 2000) throw new HttpsError('invalid-argument', 'Import at most 2000 rows at a time.');

  const existing = (await db().ref('employees').get()).val() || {};
  const managerIds = new Set(rows.map((r) => r.managerId).filter(Boolean));

  const updates = {}, pins = [];
  let created = 0, updated = 0, skipped = 0;

  for (const r of rows) {
    const id = String(r.empId || '').trim();
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) { skipped++; continue; }
    const isNew = !existing[id];
    if (!isNew && mode === 'skip') { skipped++; continue; }

    // An existing admin is never demoted by a spreadsheet.
    const role = existing[id]?.role === 'admin' ? 'admin' : (managerIds.has(id) ? 'manager' : 'employee');

    updates[`employees/${id}`] = {
      ...(existing[id] || {}),
      empId: id,
      name: String(r.name || '').trim(),
      designation: String(r.designation || '').trim(),
      department: String(r.department || '').trim(),
      reportingTo: String(r.reportingTo || '').trim(),
      managerId: r.managerId || null,
      role,
      active: existing[id]?.active ?? true,
      createdAt: existing[id]?.createdAt || Date.now()
    };

    if (isNew) {
      const pin = newPin();
      updates[`pins/${id}`] = hash(id, pin);
      pins.push({ empId: id, name: updates[`employees/${id}`].name, pin });
      created++;
    } else updated++;
  }

  await db().ref().update(updates);
  return { created, updated, skipped, pins };
});

/** An admin can reset anyone's PIN. Anyone can change their own. Nobody can read one. */
export const setPin = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const empId = String(req.data?.empId || '').trim();
  const pin   = String(req.data?.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) throw new HttpsError('invalid-argument', 'A PIN is 4 to 6 digits.');
  if (req.auth.token.role !== 'admin' && req.auth.uid !== empId)
    throw new HttpsError('permission-denied', 'You can only change your own PIN.');
  if (!(await db().ref(`employees/${empId}`).get()).exists())
    throw new HttpsError('not-found', 'No employee with that ID.');

  await db().ref(`pins/${empId}`).set(hash(empId, pin));
  await db().ref(`_gate/${empId}`).remove();
  return { ok: true };
});

/**
 * One-time bootstrap for the very first admin, since there is no admin yet to
 * make one. Set BOOTSTRAP_SECRET in the function config, call it once, then
 * unset the secret and redeploy.
 */
export const bootstrapAdmin = onCall(async (req) => {
  const secret = process.env.BOOTSTRAP_SECRET;
  if (!secret) throw new HttpsError('failed-precondition', 'Bootstrap is closed.');
  if (req.data?.secret !== secret) throw new HttpsError('permission-denied', 'Wrong secret.');

  const { empId, name, pin, department = '', designation = 'Administrator' } = req.data || {};
  if (!empId || !name || !/^\d{4,6}$/.test(String(pin || '')))
    throw new HttpsError('invalid-argument', 'empId, name and a 4–6 digit pin are required.');

  await db().ref().update({
    [`employees/${empId}`]: {
      empId, name, designation, department, reportingTo: '', managerId: null,
      role: 'admin', active: true, createdAt: Date.now()
    },
    [`pins/${empId}`]: hash(empId, String(pin))
  });
  return { ok: true, empId };
});

/* -------------------------------------------------------------------------- */
/*  Destructive admin operations                                              */
/*                                                                            */
/*  Deletes live here, not on the client, for one hard reason: cleaning up a  */
/*  deleted employee means deleting their PIN, and /pins is write:false for   */
/*  everyone — only the Admin SDK can touch it. A client-side delete would    */
/*  leave orphaned PIN hashes behind, so a "deleted" person's credentials     */
/*  would still resolve. These functions also re-verify the caller's PIN, so  */
/*  a walk-up to an unlocked admin session cannot wipe the database.          */
/* -------------------------------------------------------------------------- */

/** Re-check the caller's own PIN. Destructive actions demand it fresh. */
async function verifyOwnPin(uid, pin) {
  if (!/^\d{4,6}$/.test(String(pin || '')))
    throw new HttpsError('invalid-argument', 'Enter your PIN to confirm.');
  const stored = (await db().ref(`pins/${uid}`).get()).val();
  if (!stored || stored !== hash(uid, String(pin)))
    throw new HttpsError('permission-denied', 'That PIN is not correct.');
}

/** Strip an employee out of every task's member list, keeping the tasks. */
async function scrubEmployeeFromTasks(empId, patch) {
  const tasks = (await db().ref('tasks').get()).val() || {};
  for (const [tid, t] of Object.entries(tasks)) {
    if (t.members && t.members[empId]) patch[`tasks/${tid}/members/${empId}`] = null;
  }
}

/**
 * Delete one or many employees. Removes each account and its PIN, and unhooks
 * them from any task they were on (the task itself stays). The caller can never
 * delete themselves, and the last remaining admin is protected.
 */
export const deleteEmployees = onCall(async (req) => {
  const uid = await requireAdmin(req);
  await verifyOwnPin(uid, req.data?.pin);

  const ids = [...new Set((req.data?.empIds || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length) throw new HttpsError('invalid-argument', 'No employees selected.');
  if (ids.includes(uid)) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');

  const all = (await db().ref('employees').get()).val() || {};
  const adminsAfter = Object.entries(all)
    .filter(([id, e]) => e.role === 'admin' && !ids.includes(id)).length;
  if (adminsAfter < 1) throw new HttpsError('failed-precondition', 'That would delete the last admin. Keep at least one.');

  const patch = {};
  for (const id of ids) {
    patch[`employees/${id}`] = null;
    patch[`pins/${id}`] = null;
    patch[`_gate/${id}`] = null;
    await scrubEmployeeFromTasks(id, patch);
  }
  await db().ref().update(patch);
  return { deleted: ids.length };
});

/**
 * Delete one or many tasks outright, along with everything hanging off them —
 * the contribution ledger, comments and audit trail for those tasks.
 */
export const deleteTasks = onCall(async (req) => {
  const uid = await requireAdmin(req);
  await verifyOwnPin(uid, req.data?.pin);

  const ids = [...new Set((req.data?.taskIds || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length) throw new HttpsError('invalid-argument', 'No tasks selected.');

  const patch = {};
  for (const id of ids) {
    patch[`tasks/${id}`] = null;
    patch[`updates/${id}`] = null;
    patch[`comments/${id}`] = null;
    patch[`audit/${id}`] = null;
  }
  await db().ref().update(patch);
  return { deleted: ids.length };
});

/**
 * Flush the whole app back to a clean slate: every employee, every PIN, every
 * task and all task-attached data — but the calling admin and their PIN are
 * preserved, so you stay signed in and do not have to re-bootstrap.
 */
export const resetApp = onCall(async (req) => {
  const uid = await requireAdmin(req);
  await verifyOwnPin(uid, req.data?.pin);
  if (req.data?.confirm !== 'RESET')
    throw new HttpsError('invalid-argument', 'Reset was not confirmed.');

  const me   = (await db().ref(`employees/${uid}`).get()).val();
  const myPin = (await db().ref(`pins/${uid}`).get()).val();

  // Wipe the four top-level trees, then restore just the caller.
  await db().ref().update({
    employees: me ? { [uid]: { ...me, managerId: null, reportingTo: '' } } : null,
    pins:      myPin ? { [uid]: myPin } : null,
    tasks:     null,
    updates:   null,
    comments:  null,
    audit:     null,
    _gate:     null
  });
  return { ok: true, keptAdmin: uid };
});

/* -------------------------------------------------------------------------- */
/*  Manager approval gate                                                     */
/*                                                                            */
/*  When an admin assigns a task to someone who reports to a different        */
/*  manager, that member starts in state 'awaiting_manager' with an           */
/*  `approver` = the manager's empId. The manager must approve (→ pending, so */
/*  it reaches the employee) or reject (member removed, admin reassigns).     */
/*                                                                            */
/*  Verified server-side: the caller must actually be the recorded approver   */
/*  for that member. A manager cannot approve for someone who isn't theirs.   */
/* -------------------------------------------------------------------------- */

async function loadMemberForApproval(taskId, empId, callerUid) {
  const snap = await db().ref(`tasks/${taskId}/members/${empId}`).get();
  if (!snap.exists()) throw new HttpsError('not-found', 'That assignment no longer exists.');
  const m = snap.val();
  if (m.state !== 'awaiting_manager')
    throw new HttpsError('failed-precondition', 'This assignment is not awaiting your approval.');
  if (m.approver !== callerUid)
    throw new HttpsError('permission-denied', 'You are not the approver for this person.');
  return m;
}

/** Manager approves: the member moves to 'pending' and reaches the employee. */
export const approveAssignment = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const taskId = String(req.data?.taskId || '').trim();
  const empId  = String(req.data?.empId || '').trim();
  if (!taskId || !empId) throw new HttpsError('invalid-argument', 'Missing task or employee.');

  await loadMemberForApproval(taskId, empId, req.auth.uid);

  await db().ref(`tasks/${taskId}/members/${empId}`).update({
    state: 'pending', approvedBy: req.auth.uid, approvedAt: Date.now(), approver: null
  });
  await db().ref(`audit/${taskId}`).push({
    empId: req.auth.uid, action: 'approved assignment',
    detail: `for ${empId}`, at: Date.now()
  });
  return { ok: true, state: 'pending' };
});

/** Manager rejects: the member is removed; admin can reassign to someone else. */
export const rejectAssignment = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const taskId = String(req.data?.taskId || '').trim();
  const empId  = String(req.data?.empId || '').trim();
  const reason = String(req.data?.reason || '').trim();
  if (!taskId || !empId) throw new HttpsError('invalid-argument', 'Missing task or employee.');

  await loadMemberForApproval(taskId, empId, req.auth.uid);

  // Record who was rejected and why on the task, then remove the member.
  await db().ref(`tasks/${taskId}/rejections`).push({
    empId, by: req.auth.uid, reason, at: Date.now()
  });
  await db().ref(`tasks/${taskId}/members/${empId}`).remove();
  await db().ref(`audit/${taskId}`).push({
    empId: req.auth.uid, action: 'rejected assignment',
    detail: `${empId}${reason ? ' — ' + reason : ''}`, at: Date.now()
  });
  return { ok: true, removed: empId };
});

/* -------------------------------------------------------------------------- */
/*  Push delivery                                                             */
/*                                                                            */
/*  Every in-app notification written to /notifications/{empId}/{id} is        */
/*  mirrored out as a real push to that person's registered devices. Doing it  */
/*  with a database trigger rather than at each call site means the in-app     */
/*  notice and the push can never disagree, and the app keeps working normally */
/*  if messaging is not configured — this function simply finds no tokens.     */
/* -------------------------------------------------------------------------- */

export const pushOnNotification = onValueCreated(
  // NOTE: database triggers run through Eventarc and must be deployed in the
  // REGION OF THE DATABASE INSTANCE — not the region the other functions use.
  // This database lives in asia-southeast1; the callable functions are in
  // asia-south1. Deploying this one to asia-south1 fails with
  // "cannot create a trigger in region asia-south1".
  { ref: '/notifications/{empId}/{nid}', region: 'asia-southeast1' },
  async (event) => {
    const n = event.data.val() || {};
    const empId = event.params.empId;

    const tokensSnap = await db().ref(`fcmTokens/${empId}`).get();
    const tokens = Object.keys(tokensSnap.val() || {});
    if (!tokens.length) return;

    const message = {
      // Data-only, so the service worker decides how to display it. This keeps
      // the notification identical whether the app is open, backgrounded or shut.
      data: {
        title: String(n.title || 'KaaryaVidhan'),
        body: String(n.body || ''),
        taskId: String(n.taskId || ''),
        type: String(n.type || '')
      },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: { link: '/' }
      },
      tokens
    };

    const res = await getMessaging().sendEachForMulticast(message);

    // Prune tokens the device no longer honours, so the list cannot grow stale.
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code || '';
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(code)) dead.push(tokens[i]);
    });
    if (dead.length) {
      const patch = {};
      for (const t of dead) patch[`fcmTokens/${empId}/${t}`] = null;
      await db().ref().update(patch);
    }
  }
);