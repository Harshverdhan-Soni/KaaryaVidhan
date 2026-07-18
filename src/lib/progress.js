export const DAY = 86400000;

/** Actual completion: the mean of every activity's own 0–100 slider. */
export function actualPct(task) {
  const acts = Object.values(task?.activities || {});
  if (!acts.length) return 0;
  return acts.reduce((s, a) => s + (Number(a.progress) || 0), 0) / acts.length;
}

/** Where the task *should* be today: days elapsed ÷ days allotted. */
export function expectedPct(task, now = Date.now()) {
  const { startDate: s, deadline: d } = task || {};
  if (!s || !d || d <= s) return 0;
  if (now <= s) return 0;
  if (now >= d) return 100;
  return ((now - s) / (d - s)) * 100;
}

export function daysLeft(task, now = Date.now()) {
  return Math.ceil((task.deadline - now) / DAY);
}

/**
 * Status drives every colour in the app. Order matters: finished and breached
 * are facts, everything else is a judgement about pace.
 */
export function statusOf(task, now = Date.now()) {
  const actual = actualPct(task), expected = expectedPct(task, now);
  const left = daysLeft(task, now);

  if (task.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', color: '#5A7391', actual, expected, left };
  if (actual >= 99.5) {
    const late = task.completedAt && task.completedAt > task.deadline;
    return { key: 'completed', label: late ? 'Completed late' : 'Completed', color: late ? '#E8801A' : '#1F8A4C', actual, expected, left };
  }
  if (now > task.deadline) return { key: 'breached', label: 'Deadline breached', color: '#D93025', actual, expected, left, alert: true };

  const gap = actual - expected;
  if (gap < -15 && left <= 7)  return { key: 'critical', label: 'Slow — deadline near', color: '#D93025', actual, expected, left, alert: true };
  if (gap < -15)               return { key: 'behind',   label: 'Behind pace',        color: '#E8801A', actual, expected, left };
  if (gap < -5)                return { key: 'watch',    label: 'Slipping',           color: '#E8801A', actual, expected, left };
  return { key: 'ontrack', label: 'On track', color: '#1F8A4C', actual, expected, left };
}

export const NEEDS_ATTENTION = new Set(['critical', 'breached']);

/**
 * Who actually moved this task. Every slider change is banked as a delta in
 * /updates/{taskId}; a person's share is their positive movement over all
 * positive movement. Pulling a slider back does not buy anyone credit.
 */
export function contributions(updates, task) {
  const gained = {};
  let total = 0;
  // A task with no slider moves has no /updates node at all, and Firebase
  // returns null for a missing path — not undefined — so a default arg of {}
  // does not catch it. Normalise here.
  for (const u of Object.values(updates || {})) {
    const d = Number(u.delta) || 0;
    if (d <= 0) continue;
    gained[u.empId] = (gained[u.empId] || 0) + d;
    total += d;
  }
  const actual = actualPct(task);
  return Object.entries(gained)
    .map(([empId, amount]) => ({
      empId,
      amount,
      share: total ? amount / total : 0,
      pctOfTask: total ? (amount / total) * actual : 0
    }))
    .sort((a, b) => b.amount - a.amount);
}

export const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (ms) =>
  ms ? new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const toDateInput = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/**
 * The gate rule, in one place. Decides what state a newly-assigned member
 * starts in, given who is assigning and who the assignee reports to.
 *
 *   - self-assigning yourself            → accepted (nothing to accept)
 *   - assigned by your own manager       → pending  (you still accept/decline)
 *   - assigned by admin, you report to   → awaiting_manager (your manager must
 *       a DIFFERENT manager                 approve before it reaches you)
 *   - assigned by admin, no manager      → pending  (admin is your top; no gate)
 *   - anything else                      → pending
 *
 * assigner: { empId, role }.  assignee: the employee record (has managerId).
 */
export function initialMemberState(assigner, assignee) {
  const now = Date.now();
  if (assignee.empId === assigner.empId) return { state: 'accepted', at: now };

  if (assigner.role === 'admin') {
    const mgr = assignee.managerId;
    // Admin assigns someone who reports to an actual manager (not the admin) →
    // that manager must approve first.
    if (mgr && mgr !== assigner.empId) {
      return { state: 'awaiting_manager', approver: mgr, at: now };
    }
    return { state: 'pending', at: now };   // no manager, or reports to admin
  }

  // Manager (or anyone else) assigning: straight to the employee.
  return { state: 'pending', at: now };
}

/** Member states that mean "not yet actionable by the employee". */
export const PRE_EMPLOYEE = new Set(['awaiting_manager']);

/** True if this task has any member still waiting on a manager's approval. */
export function awaitingApproval(task) {
  return Object.values(task?.members || {}).some((m) => m.state === 'awaiting_manager');
}
