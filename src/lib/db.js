import { ref, push, update, set, serverTimestamp, get } from 'firebase/database';
import { db, fns } from './firebase';
import { initialMemberState } from './progress';
import { notify } from './notify';
import { httpsCallable } from 'firebase/functions';

/** Nothing changes without leaving a trace. Called by every mutation below. */
export async function audit(taskId, empId, action, detail = '') {
  await push(ref(db, `audit/${taskId}`), { empId, action, detail, at: Date.now() });
}

/**
 * The one write that matters. Moving a slider does three things atomically:
 * sets the new value, banks the delta against the mover, and logs the audit.
 * The delta is what the Pace Bar renders — never re-derive it from the value.
 */
export async function setActivityProgress(task, actId, next, me) {
  const prev = Number(task.activities?.[actId]?.progress) || 0;
  const val = Math.max(0, Math.min(100, Math.round(next)));
  if (val === prev) return;

  const updId = push(ref(db, `updates/${task.id}`)).key;
  const patch = {
    [`tasks/${task.id}/activities/${actId}/progress`]: val,
    [`tasks/${task.id}/activities/${actId}/updatedBy`]: me.empId,
    [`tasks/${task.id}/activities/${actId}/updatedAt`]: Date.now(),
    // Any change re-opens validation: an activity that was signed off and then
    // moved again must be approved afresh.
    [`tasks/${task.id}/activities/${actId}/approvedAt`]: null,
    [`tasks/${task.id}/activities/${actId}/approvedBy`]: null,
    [`tasks/${task.id}/lastActivityAt`]: Date.now(),
    [`updates/${task.id}/${updId}`]: {
      actId, empId: me.empId, from: prev, to: val, delta: val - prev, at: Date.now()
    }
  };

  // Completion is a fact about the task, recorded the moment it becomes true.
  const acts = { ...(task.activities || {}) };
  acts[actId] = { ...acts[actId], progress: val };
  const list = Object.values(acts);
  const mean = list.reduce((s, a) => s + (Number(a.progress) || 0), 0) / (list.length || 1);
  // Reaching 100% is a claim, not completion. The task is only marked complete
  // once EVERY activity has also been validated — which this write cannot do,
  // since it just cleared this activity's approval. So completion is settled in
  // approveActivity() instead, and any change here un-completes the task.
  if (task.completedAt) {
    patch[`tasks/${task.id}/completedAt`] = null;
    patch[`tasks/${task.id}/status`] = 'active';
  }

  await update(ref(db), patch);
  await audit(task.id, me.empId, 'progress', `${task.activities[actId]?.title}: ${prev}% → ${val}%`);
  // Hitting 100% is a claim that needs signing off — tell whoever owns the task.
  if (val >= 100 && prev < 100 && task.createdBy !== me.empId) {
    notify(task.createdBy, { type: 'validate', taskId: task.id,
      title: `Ready for your approval: ${task.activities[actId]?.title}`,
      body: `${me.name} marked it complete in "${task.title}".` });
  }
}

export async function toggleBlocked(task, actId, blocked, me) {
  await update(ref(db, `tasks/${task.id}/activities/${actId}`), { blocked, updatedAt: Date.now() });
  await audit(task.id, me.empId, blocked ? 'blocked' : 'unblocked', task.activities[actId]?.title || '');
}

export async function addComment(taskId, actId, me, text) {
  if (!text.trim()) return;
  await push(ref(db, `comments/${taskId}/${actId}`), {
    empId: me.empId, text: text.trim(), at: Date.now()
  });
}

export async function respondToTask(task, me, accepted, reason = '') {
  await update(ref(db, `tasks/${task.id}/members/${me.empId}`), {
    state: accepted ? 'accepted' : 'denied',
    reason: accepted ? null : reason.trim(),
    at: Date.now()
  });
  await audit(task.id, me.empId, accepted ? 'accepted' : 'denied', reason);
  notify(task.createdBy, {
    type: accepted ? 'accepted' : 'rejected', taskId: task.id,
    title: `${me.name} ${accepted ? 'accepted' : 'declined'}: ${task.title}`,
    body: accepted ? 'They can now record progress.' : (reason ? `Reason: ${reason}` : 'You can reassign it.')
  });
}

export async function extendDeadline(task, newDeadline, reason, me) {
  await push(ref(db, `tasks/${task.id}/extensions`), {
    from: task.deadline, to: newDeadline, reason, by: me.empId, at: Date.now()
  });
  await update(ref(db, `tasks/${task.id}`), { deadline: newDeadline, status: 'active' });
  await audit(task.id, me.empId, 'extended', reason);
}

/**
 * Reassignment keeps the activity list and its history but hands the work to a
 * new set of people with a fresh clock. The old run is preserved as a round so
 * the record of who was asked, and what came back, is not overwritten.
 */
export async function reassignTask(task, empIds, newDeadline, reason, me, resetProgress, ctx = {}) {
  await push(ref(db, `tasks/${task.id}/rounds`), {
    members: task.members || {}, deadline: task.deadline, reason, by: me.empId, at: Date.now()
  });
  const members = {};
  for (const id of empIds) {
    const assignee = ctx.employees?.[id];
    members[id] = assignee
      ? initialMemberState({ empId: me.empId, role: ctx.role || 'admin' }, assignee)
      : { state: 'pending', at: Date.now() };
  }

  const patch = {
    [`tasks/${task.id}/members`]: members,
    [`tasks/${task.id}/deadline`]: newDeadline,
    [`tasks/${task.id}/startDate`]: Date.now(),
    [`tasks/${task.id}/status`]: 'active',
    [`tasks/${task.id}/completedAt`]: null
  };
  if (resetProgress) {
    for (const actId of Object.keys(task.activities || {})) {
      patch[`tasks/${task.id}/activities/${actId}/progress`] = 0;
    }
    patch[`updates/${task.id}`] = null;
  }
  await update(ref(db), patch);
  await audit(task.id, me.empId, 'reassigned', reason);
}

export async function createTask(t, me) {
  const id = push(ref(db, 'tasks')).key;
  await set(ref(db, `tasks/${id}`), { ...t, id, createdBy: me.empId, createdAt: Date.now() });
  await audit(id, me.empId, 'created', t.title);
  // Tell each person what the task needs from them: employees are asked to
  // accept, managers are asked to approve on their report's behalf.
  for (const [empId, m] of Object.entries(t.members || {})) {
    if (empId === me.empId) continue;
    if (m.state === 'pending') {
      notify(empId, { type: 'assigned', taskId: id,
        title: `New task: ${t.title}`, body: `Assigned by ${me.name}. Open it to accept or decline.` });
    } else if (m.state === 'awaiting_manager' && m.approver) {
      notify(m.approver, { type: 'approval', taskId: id,
        title: `Approval needed: ${t.title}`, body: `${me.name} assigned this to one of your reports.` });
    }
  }
  return id;
}

/* Admin edits an employee's own details. Role is derived, not set here — the
   only role change an edit can make is promoting to manager when someone starts
   reporting to this person; an admin is never demoted by an edit. */
export async function updateEmployee(empId, fields, me) {
  const reportingTo = fields.reportingTo.trim();
  const clean = {
    name: fields.name.trim(),
    designation: fields.designation.trim(),
    department: fields.department.trim(),
    reportingTo
  };

  // Resolve the chosen name to an actual account so the manager's team view
  // links immediately — not only after the next Excel import. Names can repeat,
  // so if more than one person carries this name we can't safely pick; leave the
  // link unresolved (the name is still stored) rather than guess wrong.
  const all = (await get(ref(db, 'employees'))).val() || {};
  const matches = Object.values(all).filter((e) => e.name === reportingTo && e.empId !== empId);
  clean.managerId = matches.length === 1 ? matches[0].empId : null;

  await update(ref(db, `employees/${empId}`), clean);

  // If this person now has reports, they should be a manager (never demote an
  // admin). Promote the newly-chosen manager if they aren't already.
  if (clean.managerId) {
    const mgr = all[clean.managerId];
    if (mgr && mgr.role === 'employee') {
      await update(ref(db, `employees/${clean.managerId}`), { role: 'manager' });
    }
  }
}

/* Admin edits a task's headline fields. Activities, members and progress are
   edited from the task detail screen; this is for the title/description/
   department/deadline that the create form sets. */
export async function updateTaskFields(taskId, fields, me) {
  const patch = {
    title: fields.title.trim(),
    description: (fields.description || '').trim(),
    department: (fields.department || '').trim()
  };
  if (fields.deadline) patch.deadline = fields.deadline;
  await update(ref(db, `tasks/${taskId}`), patch);
  await audit(taskId, me.empId, 'edited', 'Task details updated');
}

/* Manager approval gate — these call the server, which verifies the caller is
   the recorded approver before doing anything. */
export async function approveAssignment(taskId, empId, ctx = {}) {
  await httpsCallable(fns, 'approveAssignment')({ taskId, empId });
  notify(empId, { type: 'assigned', taskId,
    title: `New task: ${ctx.taskTitle || 'a task'}`,
    body: 'Your manager approved it. Open it to accept or decline.' });
}
export async function rejectAssignment(taskId, empId, reason) {
  await httpsCallable(fns, 'rejectAssignment')({ taskId, empId, reason });
}

/* -------------------------- task templates (private) ---------------------- */

/** Save a reusable template under the current user. Activities is a string[]. */
export async function saveTemplate(uid, { title, description, activities }) {
  const id = push(ref(db, `templates/${uid}`)).key;
  await set(ref(db, `templates/${uid}/${id}`), {
    id,
    title: title.trim(),
    description: (description || '').trim(),
    activities: activities.map((a) => a.trim()).filter(Boolean),
    createdAt: Date.now()
  });
  return id;
}

export async function deleteTemplate(uid, tid) {
  await set(ref(db, `templates/${uid}/${tid}`), null);
}

/**
 * Add one or more people to a task that is already running, WITHOUT disturbing
 * anyone already on it. Each new person is gated individually by the same rule
 * as first assignment: an admin adding someone who reports to a different
 * manager → awaiting_manager; a manager adding own report, or anyone adding
 * themselves → straight in. Existing members are untouched.
 *
 * @param ctx { employees, role } — assigner context for the gate rule.
 */
export async function addMembers(task, empIds, me, ctx = {}) {
  const existing = task.members || {};
  const patch = {};
  const added = [];
  for (const id of empIds) {
    if (existing[id]) continue;                    // already on the task — skip
    const assignee = ctx.employees?.[id];
    const state = assignee
      ? initialMemberState({ empId: me.empId, role: ctx.role || 'admin' }, assignee)
      : { state: 'pending', at: Date.now() };
    patch[`tasks/${task.id}/members/${id}`] = state;
    added.push({ id, state: state.state, row: state });
  }
  if (!Object.keys(patch).length) return { added: [] };
  await update(ref(db), patch);
  for (const a of added) {
    if (a.id === me.empId) continue;
    if (a.state === 'awaiting_manager') {
      const approver = ctx.employees?.[a.id]?.managerId;
      if (approver) notify(approver, { type: 'approval', taskId: task.id,
        title: `Approval needed: ${task.title}`, body: `${me.name} added one of your reports to this task.` });
    } else {
      notify(a.id, { type: 'assigned', taskId: task.id,
        title: `Added to a task: ${task.title}`, body: `${me.name} added you. Open it to accept or decline.` });
    }
  }
  // The members are already saved at this point. An audit failure must not make
  // the caller think the add failed, so it is logged rather than thrown.
  try {
    await audit(task.id, me.empId, 'added members',
      added.map((a) => `${ctx.employees?.[a.id]?.name || a.id}${a.state === 'awaiting_manager' ? ' (awaiting approval)' : ''}`).join(', '));
  } catch (e) { console.warn('audit not written', e); }
  return { added };
}

/* ------------------- activity completion validation ------------------------ */

/**
 * The task owner (or an admin) signs off an activity that has been marked 100%.
 * If that was the last one outstanding, the whole task becomes complete — this
 * is the ONLY place a task is marked completed, so a task can never be finished
 * on an unvalidated claim.
 */
export async function approveActivity(task, actId, me) {
  const now = Date.now();
  const patch = {
    [`tasks/${task.id}/activities/${actId}/approvedAt`]: now,
    [`tasks/${task.id}/activities/${actId}/approvedBy`]: me.empId
  };

  // Would every activity now be approved?
  const acts = { ...(task.activities || {}) };
  acts[actId] = { ...acts[actId], approvedAt: now };
  const all = Object.values(acts);
  const done = all.length > 0 && all.every(
    (a) => (Number(a.progress) || 0) >= 99.5 && a.approvedAt);

  if (done) {
    patch[`tasks/${task.id}/completedAt`] = now;
    patch[`tasks/${task.id}/status`] = 'completed';
  }
  await update(ref(db), patch);
  await audit(task.id, me.empId, 'approved activity',
    `${task.activities?.[actId]?.title || actId}${done ? ' — task complete' : ''}`);
  const worker = task.activities?.[actId]?.updatedBy;
  if (worker && worker !== me.empId) {
    notify(worker, { type: 'completed', taskId: task.id,
      title: `Approved: ${task.activities?.[actId]?.title || 'activity'}`,
      body: done ? `"${task.title}" is now complete.` : `${me.name} signed off your work.` });
  }
  return { taskCompleted: done };
}

/** Send an activity back for more work: clears the sign-off and the completion. */
export async function rejectActivity(task, actId, me, note = '') {
  await update(ref(db), {
    [`tasks/${task.id}/activities/${actId}/approvedAt`]: null,
    [`tasks/${task.id}/activities/${actId}/approvedBy`]: null,
    [`tasks/${task.id}/activities/${actId}/reworkNote`]: note.trim() || null,
    [`tasks/${task.id}/completedAt`]: null,
    [`tasks/${task.id}/status`]: 'active'
  });
  await audit(task.id, me.empId, 'sent back',
    `${task.activities?.[actId]?.title || actId}${note ? ' — ' + note.trim() : ''}`);
  const w = task.activities?.[actId]?.updatedBy;
  if (w && w !== me.empId) {
    notify(w, { type: 'rejected', taskId: task.id,
      title: `Sent back: ${task.activities?.[actId]?.title || 'activity'}`,
      body: note.trim() || `${me.name} asked for more work on this.` });
  }
}
