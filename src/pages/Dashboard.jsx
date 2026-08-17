import { useState, useMemo } from 'react';
import { useDb } from '../lib/useDb';
import TaskCard from '../components/TaskCard';
import { Empty, Tabs, Chip, AsyncButton, DangerConfirm, Modal } from '../components/ui';
import { httpsCallable } from 'firebase/functions';
import { fns } from '../lib/firebase';
import { statusOf, NEEDS_ATTENTION, fmtDate, livePendingApprovals, visibleGroups, GROUP_KINDS } from '../lib/progress';
import { deleteGroup } from '../lib/db';
import { exportRows } from '../lib/excel';

/** Manage the groups you created: delete one only when no task uses it. */
function GroupsModal({ open, onClose, me, groupsRaw, tasks }) {
  const mine = useMemo(() => Object.values(groupsRaw || {})
    .filter((g) => g.createdBy === me.empId)
    .sort((a, b) => (a.kind || 'functional').localeCompare(b.kind || 'functional') || (a.name || '').localeCompare(b.name || '')),
    [groupsRaw, me.empId]);
  const [busy, setBusy] = useState('');
  const usage = (gid) => tasks.filter((t) => t.groupId === gid).length;

  const del = async (g) => {
    setBusy(g.id);
    try { await deleteGroup(g.id); } catch (e) { console.warn('group delete failed', e); }
    finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage groups">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Groups you created. A group can be deleted only when no task uses it — in any state, open or completed.
        </p>
        {mine.length === 0 ? (
          <Empty title="You haven't created any groups yet." />
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {mine.map((g) => {
              const n = usage(g.id);
              return (
                <div key={g.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.name}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {g.kind === 'project' ? 'Project' : 'Functional area'}{g.scope === 'org' ? ' · org-wide' : ' · your team'}
                    </p>
                  </div>
                  {n > 0 ? (
                    <span className="shrink-0 font-mono text-[11px] text-muted">In use by {n} {n === 1 ? 'task' : 'tasks'}</span>
                  ) : (
                    <button className="btn-ghost shrink-0 !px-2.5 text-[11px] text-bad hover:bg-bad/10"
                            disabled={busy === g.id} onClick={() => del(g)}>
                      {busy === g.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The five stat categories, defined once so the tiles and the list filter agree. */
const CAT_MATCH = {
  open:       (st) => st.key !== 'completed',
  ontrack:    (st) => st.key === 'ontrack',
  slipping:   (st) => st.key === 'watch' || st.key === 'behind',
  attention:  (st) => !!st.alert,
  completed:  (st) => st.key === 'completed'
};
const STAT_CELLS = [
  ['open', 'Open', '#0A2540'],
  ['ontrack', 'On track', '#1F8A4C'],
  ['slipping', 'Slipping', '#E8801A'],
  ['attention', 'Need attention', '#D93025'],
  ['completed', 'Completed', '#1F8A4C']
];

/** Stat strip. Each tile filters the list below to that category; click again to clear. */
function Stats({ tasks, active, onPick }) {
  const s = tasks.map((t) => statusOf(t));
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
      {STAT_CELLS.map(([key, label, c]) => {
        const v = s.filter((x) => CAT_MATCH[key](x)).length;
        const on = active === key;
        return (
          <button key={key} onClick={() => onPick(key)} aria-pressed={on}
            className="card px-3.5 py-3 text-left transition hover:border-blue-400"
            style={on ? { boxShadow: `inset 0 0 0 2px ${c}` } : undefined}>
            <p className="font-mono text-2xl font-semibold tabular-nums" style={{ color: c }}>{v}</p>
            <p className="eyebrow mt-0.5">{label}{on && ' ·'}</p>
          </button>
        );
      })}
    </div>
  );
}

/** The alert the brief asks for: slow work with the deadline in sight. */
function AttentionRail({ tasks, onOpen }) {
  const hot = tasks.filter((t) => statusOf(t).alert)
    .sort((a, b) => a.deadline - b.deadline);
  if (!hot.length) return null;
  return (
    <div className="card border-bad/30 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />
        <p className="text-sm font-semibold">
          {hot.length} {hot.length === 1 ? 'task needs' : 'tasks need'} your attention
        </p>
      </div>
      <p className="mt-0.5 text-xs text-muted">Progress is well behind pace with the deadline close, or the date has already passed.</p>
      <div className="mt-3 space-y-2">
        {hot.slice(0, 4).map((t) => {
          const st = statusOf(t);
          return (
            <button key={t.id} onClick={() => onOpen(t)}
                    className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left hover:bg-sky">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{t.title}</p>
                <p className="font-mono text-[10px] text-muted">
                  {st.actual.toFixed(0)}% done · should be {st.expected.toFixed(0)}% · due {fmtDate(t.deadline)}
                </p>
              </div>
              <Chip color={st.color} solid>{st.key === 'breached' ? `${Math.abs(st.left)}d over` : `${st.left}d left`}</Chip>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({ role, me, employees, onOpen }) {
  const tasksRaw   = useDb('tasks');
  const allUpdates = useDb('updates');
  const groupsRaw  = useDb('groups');
  const [tab, setTab]   = useState(role === 'admin' ? 'assigned' : 'mine');
  const [selMode, setSelMode] = useState(false);
  const [selT, setSelT]       = useState([]);
  const [delOpen, setDelOpen] = useState(false);
  const [dept, setDept] = useState('all');
  const [state, setState] = useState('open');
  const [group, setGroup] = useState('all');
  const [cat, setCat] = useState('all');   // stat-tile category, or 'all'
  const [groupsOpen, setGroupsOpen] = useState(false);

  const tasks = useMemo(() => Object.values(tasksRaw || {}), [tasksRaw]);
  const groups = useMemo(() => visibleGroups(groupsRaw, me, role), [groupsRaw, me, role]);
  const depts = useMemo(
    () => [...new Set(Object.values(employees || {}).map((e) => e.department).filter(Boolean))].sort(),
    [employees]);

  // Who is allowed to see what.
  const reports = useMemo(
    () => Object.values(employees || {}).filter((e) => e.managerId === me.empId).map((e) => e.empId),
    [employees, me.empId]);

  const buckets = useMemo(() => {
    const isMember = (t, id) => !!t.members?.[id];
    const creatorRole = (t) => employees?.[t.createdBy]?.role;
    if (role === 'admin') return {
      assigned: tasks.filter((t) => t.origin === 'assigned' && t.createdBy === me.empId),
      byManagers: tasks.filter((t) => t.origin === 'assigned' && creatorRole(t) === 'manager'),
      self:     tasks.filter((t) => t.origin === 'self')
    };
    if (role === 'manager') {
      // Tasks where one of my reports is still awaiting MY approval — but a
      // completed task has no live approvals (livePendingApprovals handles that).
      const approvals = tasks.filter((t) => livePendingApprovals(t, me.empId).length > 0);
      return {
        mine:  tasks.filter((t) => isMember(t, me.empId)),
        team:  tasks.filter((t) => reports.some((r) => isMember(t, r)) && !isMember(t, me.empId)),
        approvals
      };
    }
    return { mine: tasks.filter((t) => isMember(t, me.empId)) };
  }, [tasks, role, me.empId, reports, employees]);

  // Everything in the current tab + department + group. The stat tiles count
  // from this, so their numbers stay stable whatever tile/state is selected.
  const base = (buckets[tab] || [])
    .filter((t) => dept === 'all' || t.department === dept)
    .filter((t) => group === 'all' || (group === '__none__' ? !t.groupId : t.groupId === group));

  // A clicked stat tile takes over the list; otherwise the Open/Completed/All
  // dropdown applies.
  const shown = base
    .filter((t) => {
      const st = statusOf(t);
      if (cat !== 'all') return CAT_MATCH[cat](st);
      return state === 'all' ? true : state === 'open' ? st.key !== 'completed' : st.key === 'completed';
    })
    .sort((a, b) => {
      const A = statusOf(a), B = statusOf(b);
      if (A.alert !== B.alert) return A.alert ? -1 : 1;       // trouble first
      return a.deadline - b.deadline;
    });

  const tabs = role === 'admin'
    ? [['assigned', 'Assigned by me', buckets.assigned.length],
       ['byManagers', 'By managers', buckets.byManagers.length],
       ['self', 'Self assigned', buckets.self.length]]
    : role === 'manager'
      ? [['mine', 'My tasks', buckets.mine.length],
         ['team', `My team (${reports.length})`, buckets.team.length],
         ['approvals', 'Approvals', buckets.approvals.length]]
      : [['mine', 'My tasks', buckets.mine.length]];

  return (
    <div className="space-y-4">
      <Stats tasks={base} active={cat} onPick={(k) => setCat((c) => (c === k ? 'all' : k))} />

      {(role === 'admin' || role === 'manager') && (
        <AttentionRail tasks={shown} onOpen={onOpen} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onChange={(v) => { setTab(v); setCat('all'); }} options={tabs} />
        <span className="ml-auto flex flex-wrap gap-2">
          <select className="field !w-auto !py-2 text-xs" value={state}
                  onChange={(e) => { setState(e.target.value); setCat('all'); }}>
            <option value="open">Open</option>
            <option value="done">Completed</option>
            <option value="all">All</option>
          </select>
          {groups.length > 0 && (
            <select className="field !w-auto !py-2 text-xs" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">Every group</option>
              <option value="__none__">No group</option>
              {GROUP_KINDS.map(([k, label]) => {
                const gs = groups.filter((g) => (g.kind || 'functional') === k);
                return gs.length ? (
                  <optgroup key={k} label={label}>
                    {gs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          )}
          {role !== 'employee' && (
            <select className="field !w-auto !py-2 text-xs" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">Every department</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {(role === 'admin' || role === 'manager') && (
            <button className="btn-ghost text-xs" onClick={() => setGroupsOpen(true)}>Manage groups</button>
          )}
          {role === 'admin' && shown.length > 0 && (
            <AsyncButton className="btn-ghost text-xs" onClick={() => exportRows(shown, [
              ['Task', (t) => t.title], ['Department', (t) => t.department],
              ['Group', (t) => groupsRaw?.[t.groupId]?.name || ''],
              ['Origin', (t) => (t.origin === 'self' ? 'Self assigned' : 'Assigned by admin')],
              ['Owner', (t) => employees?.[t.createdBy]?.name || t.createdBy],
              ['Members', (t) => Object.keys(t.members || {}).map((id) => employees?.[id]?.name || id).join(', ')],
              ['Progress %', (t) => Math.round(statusOf(t).actual)],
              ['Expected %', (t) => Math.round(statusOf(t).expected)],
              ['Status', (t) => statusOf(t).label],
              ['Deadline', (t) => fmtDate(t.deadline)],
              ['Days left', (t) => statusOf(t).left]
            ], `kaarya-tasks-${dept === 'all' ? 'all' : dept}.xlsx`)}>Export view</AsyncButton>
          )}
        </span>
      </div>

      {shown.length === 0 ? (
        <Empty title={
          state === 'done' ? 'Nothing completed in this view yet.'
          : tab === 'approvals' ? 'No pending approvals. When an administrator assigns one of your reports a task, it appears here for your approval first.'
          : tab === 'byManagers' ? 'No tasks assigned by managers yet.'
          : tab === 'team' ? 'None of your reports have an open task right now.'
          : role === 'employee' ? 'No tasks assigned to you. Add your own from the button above.'
          : 'No tasks in this view. Create one to get started.'} />
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {shown.map((t) => (
            <div key={t.id} className="relative">
              {selMode && (
                <label className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white/95 shadow-card">
                  <input type="checkbox" className="accent-blue" checked={selT.includes(t.id)}
                         onChange={() => setSelT((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])} />
                </label>
              )}
              <TaskCard task={t} updates={allUpdates?.[t.id]} employees={employees}
                        groupName={groupsRaw?.[t.groupId]?.name}
                        showOwner={role !== 'employee'}
                        onOpen={() => selMode
                          ? setSelT((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])
                          : onOpen(t)} />
            </div>
          ))}
        </div>
      )}

      <DangerConfirm
        open={delOpen} onClose={() => setDelOpen(false)}
        title={`Delete ${selT.length} ${selT.length === 1 ? 'task' : 'tasks'}`}
        body={`This permanently removes ${selT.length === 1 ? 'the task' : 'these tasks'} and all their history — progress, remarks and audit trail. This cannot be undone.`}
        phrase="DELETE" confirmLabel={`Delete ${selT.length}`}
        onConfirm={async (pin) => { await httpsCallable(fns, 'deleteTasks')({ taskIds: selT, pin }); setSelT([]); setSelMode(false); }} />

      <GroupsModal open={groupsOpen} onClose={() => setGroupsOpen(false)} me={me} groupsRaw={groupsRaw} tasks={tasks} />
    </div>
  );
}
