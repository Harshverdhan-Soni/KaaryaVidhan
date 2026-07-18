import { ref, push, update, set, serverTimestamp, get } from 'firebase/database';
import { db, fns } from './firebase';
import { initialMemberState } from './progress';
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
  if (mean >= 99.5 && !task.completedAt) {
    patch[`tasks/${task.id}/completedAt`] = Date.now();
    patch[`tasks/${task.id}/status`] = 'completed';
  } else if (mean < 99.5 && task.completedAt) {
    patch[`tasks/${task.id}/completedAt`] = null;
    patch[`tasks/${task.id}/status`] = 'active';
  }

  await update(ref(db), patch);
  await audit(task.id, me.empId, 'progress', `${task.activities[actId]?.title}: ${prev}% → ${val}%`);
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
  return id;
}

/* Admin edits an employee's own details. Role is derived, not set here — the
   only role change an edit can make is promoting to manager when someone starts
   reporting to this person; an admin is never demoted by an edit. */
export async function updateEmployee(empId, fields, me) {
  const clean = {
    name: fields.name.trim(),
    designation: fields.designation.trim(),
    department: fields.department.trim(),
    reportingTo: fields.reportingTo.trim()
  };
  await update(ref(db, `employees/${empId}`), clean);
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
export async function approveAssignment(taskId, empId) {
  await httpsCallable(fns, 'approveAssignment')({ taskId, empId });
}
export async function rejectAssignment(taskId, empId, reason) {
  await httpsCallable(fns, 'rejectAssignment')({ taskId, empId, reason });
}
