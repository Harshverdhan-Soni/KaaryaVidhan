import { useState, useMemo, useEffect } from 'react';
import { useAuthed } from '../lib/auth';
import { useDb } from '../lib/useDb';
import PaceBar from '../components/PaceBar';
import { Avatar, Chip, Modal, Field, DangerConfirm } from '../components/ui';
import { httpsCallable } from 'firebase/functions';
import { fns } from '../lib/firebase';
import { colorFor } from '../lib/colors';
import { statusOf, contributions, fmtDate, fmtDateTime, toDateInput } from '../lib/progress';
import {
  setActivityProgress, toggleBlocked, addComment, respondToTask, extendDeadline, reassignTask, updateTaskFields,
  approveAssignment, rejectAssignment
} from '../lib/db';

/* ------------------------------- one activity ------------------------------ */

function Activity({ task, actId, act, employees, canEdit, me }) {
  const [open, setOpen]   = useState(false);
  const [draft, setDraft] = useState(null);      // live slider value while dragging / awaiting sync
  const [saving, setSaving] = useState(false);
  const [text, setText]   = useState('');
  const comments = useDb(`comments/${task.id}/${actId}`, open);
  const list = Object.entries(comments || {}).sort((a, b) => a[1].at - b[1].at);
  const serverVal = Number(act.progress) || 0;
  const val = draft ?? serverVal;
  const mover = employees?.[act.updatedBy];

  // Once the live task sync brings the server value up to what we committed,
  // release the draft. Until then the slider holds our position instead of
  // snapping back to the stale prop.
  useEffect(() => {
    if (draft !== null && serverVal === draft) { setDraft(null); setSaving(false); }
  }, [serverVal, draft]);

  const commit = async (v) => {
    if (v === serverVal) { setDraft(null); return; }
    setDraft(v);           // hold the new position on screen immediately
    setSaving(true);
    try { await setActivityProgress(task, actId, v, me); }
    catch { setDraft(null); setSaving(false); }   // write failed — fall back to truth
  };

  return (
    <div className={`card p-4 ${act.blocked ? 'border-bad/40 bg-bad/[.02]' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{act.title}</p>
          {act.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{act.detail}</p>}
        </div>
        <span className="flex items-center gap-1.5">
          {saving && <span className="font-mono text-[10px] font-normal text-muted animate-pulse">saving…</span>}
          <span className="font-mono text-sm font-semibold tabular-nums"
                style={{ color: val >= 100 ? '#1F8A4C' : act.blocked ? '#D93025' : '#0A2540' }}>
            {val}%
          </span>
        </span>
      </div>

      {/* the slider carries the mover's colour, so the group reads contribution
          without opening anything */}
      <input type="range" min="0" max="100" step="5" value={val} disabled={!canEdit}
             className="mt-3 w-full accent-blue disabled:opacity-50"
             style={{ accentColor: act.updatedBy ? colorFor(act.updatedBy) : '#0B4E8C' }}
             onInput={(e) => setDraft(Number(e.target.value))}
             onChange={(e) => setDraft(Number(e.target.value))}
             onPointerUp={(e) => commit(Number(e.target.value))}
             onMouseUp={(e) => commit(Number(e.target.value))}
             onTouchEnd={(e) => commit(Number(e.target.value))}
             onKeyUp={(e) => commit(Number(e.target.value))} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {mover && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <Avatar emp={mover} size={16} /> {mover.name.split(' ')[0]} · {fmtDateTime(act.updatedAt)}
          </span>
        )}
        {act.blocked && <Chip color="#D93025">Blocked</Chip>}
        <span className="ml-auto flex gap-2">
          {canEdit && (
            <button className="text-[11px] font-medium text-muted hover:text-bad"
                    onClick={() => toggleBlocked(task, actId, !act.blocked, me)}>
              {act.blocked ? 'Unblock' : 'Flag blocked'}
            </button>
          )}
          <button className="text-[11px] font-medium text-blue hover:text-ink" onClick={() => setOpen(!open)}>
            Remarks{list.length ? ` (${list.length})` : ''}
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {list.length === 0 && <p className="text-[11px] text-muted">No remarks yet.</p>}
          {list.map(([id, c]) => (
            <div key={id} className="flex gap-2">
              <Avatar emp={employees?.[c.empId]} size={22} />
              <div className="min-w-0 flex-1 rounded-lg rounded-tl-none px-2.5 py-1.5"
                   style={{ background: `${colorFor(c.empId)}0F` }}>
                <p className="font-mono text-[10px]" style={{ color: colorFor(c.empId) }}>
                  {employees?.[c.empId]?.name || c.empId} · {fmtDateTime(c.at)}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed">{c.text}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input className="field text-xs" placeholder="Add a remark for the admin…" value={text}
                   onChange={(e) => setText(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { addComment(task.id, actId, me, text); setText(''); } }} />
            <button className="btn-ghost !px-3 text-xs" disabled={!text.trim()}
                    onClick={() => { addComment(task.id, actId, me, text); setText(''); }}>Post</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- the screen ------------------------------- */

export default function TaskDetail({ task, employees, onClose, isAdmin }) {
  const updates = useDb(`updates/${task.id}`);
  const audit   = useDb(`audit/${task.id}`);
  const { me }  = useAuthed();
  const [tab, setTab]           = useState('work');
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason]     = useState('');
  const [extOpen, setExtOpen]   = useState(false);
  const [reaOpen, setReaOpen]   = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen]   = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [justActed, setJustActed] = useState(false);
  const [respondErr, setRespondErr] = useState('');

  const st      = statusOf(task);
  const mine    = task.members?.[me.empId];

  // When our accept lands (the live task sync flips our state to 'accepted'),
  // clear the busy flag and flash a confirmation that fades after a few seconds.
  useEffect(() => {
    if (mine?.state === 'accepted' && accepting) {
      setAccepting(false);
      setJustActed(true);
      const t = setTimeout(() => setJustActed(false), 6000);
      return () => clearTimeout(t);
    }
  }, [mine?.state, accepting]);
  const acts    = Object.entries(task.activities || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const parts   = contributions(updates, task);
  const canEdit = mine?.state === 'accepted' || task.createdBy === me.empId;
  const trail   = Object.entries(audit || {}).sort((a, b) => b[1].at - a[1].at);
  const exts    = Object.values(task.extensions || {});

  return (
    <div className="space-y-4">
      <button className="eyebrow hover:text-ink" onClick={onClose}>← Back</button>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="eyebrow">{task.origin === 'self' ? 'Self assigned' : 'Assigned'} · {task.department || 'No department'}</span>
            <h2 className="mt-1 font-display text-2xl font-bold leading-tight">{task.title}</h2>
            {task.description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{task.description}</p>}
          </div>
          <Chip color={st.color} solid>{st.label}</Chip>
        </div>

        <div className="mt-5">
          <PaceBar task={task} updates={updates} employees={employees} height={18} showLegend />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          {[['Started', fmtDate(task.startDate)],
            ['Deadline', fmtDate(task.deadline)],
            ['Days left', st.key === 'completed' ? '—' : `${st.left}`],
            ['Owner', employees?.[task.createdBy]?.name || task.createdBy]].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="mt-0.5 font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>

        {exts.length > 0 && (
          <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">
            Deadline extended {exts.length}×. Originally due {fmtDate(exts[0].from)}.
          </p>
        )}

        {isAdmin && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <button className="btn-ghost text-xs" onClick={() => setEditOpen(true)}>Edit details</button>
            <button className="btn-ghost text-xs" onClick={() => setExtOpen(true)}>Extend deadline</button>
            <button className="btn-ghost text-xs" onClick={() => setReaOpen(true)}>Reassign</button>
            <button className="text-xs font-medium text-bad hover:underline ml-auto" onClick={() => setDelOpen(true)}>Delete task</button>
          </div>
        )}
      </div>

      {/* the accept / decline gate */}
      {mine?.state === 'pending' && (
        <div className="card border-blue/30 bg-blue/[.03] p-4">
          <p className="text-sm font-medium">You have been assigned this task.</p>
          <p className="mt-0.5 text-xs text-muted">Accept to start recording progress, or decline and say why so the admin can reassign it.</p>
          {respondErr && <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{respondErr}</p>}
          <div className="mt-3 flex gap-2">
            <button className="btn-primary text-xs" disabled={accepting}
                    onClick={async () => {
                      setRespondErr(''); setAccepting(true);
                      try { await respondToTask(task, me, true); }
                      catch { setRespondErr('Could not accept the task. Check your connection and try again.'); setAccepting(false); }
                    }}>
              {accepting ? 'Accepting…' : 'Accept task'}
            </button>
            <button className="btn-ghost text-xs" disabled={accepting} onClick={() => setDenyOpen(true)}>Decline</button>
          </div>
        </div>
      )}
      {mine?.state === 'accepted' && justActed && (
        <div className="card border-ok/40 bg-ok/[.04] p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ok">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-ok text-white text-xs">✓</span>
            Task accepted — you can now record progress on the activities below.
          </p>
        </div>
      )}
      {mine?.state === 'denied' && (
        <div className="card border-warn/40 p-4">
          <p className="text-xs text-warn">You declined this task{mine.reason ? `: “${mine.reason}”` : ''}. The admin can reassign it or ask you again.</p>
        </div>
      )}
      {mine?.state === 'awaiting_manager' && (
        <div className="card border-line p-4">
          <p className="text-sm font-medium">Waiting on your manager</p>
          <p className="mt-0.5 text-xs text-muted">
            This task was assigned to you by an administrator. Your reporting manager needs to approve it
            before it comes to you to accept. You'll see it here once they do.
          </p>
        </div>
      )}

      {/* manager approval panel — shown to the recorded approver for any member
          on this task still awaiting them */}
      <ManagerApprovalPanel task={task} me={me} employees={employees} />

      <div className="inline-flex gap-1 rounded-xl bg-blue/[.07] p-1">
        {[['work', `Activities (${acts.length})`], ['team', `Team (${Object.keys(task.members || {}).length})`], ['trail', 'History']]
          .map(([v, l]) => (
            <button key={v} className={`tab ${tab === v ? 'tab-on' : ''}`} onClick={() => setTab(v)}>{l}</button>
          ))}
      </div>

      {tab === 'work' && (
        <div className="space-y-2.5">
          {acts.length === 0 && <div className="card p-6 text-center text-sm text-muted">No activities on this task yet.</div>}
          {acts.map(([id, a]) => (
            <Activity key={id} task={task} actId={id} act={a} employees={employees} me={me} canEdit={canEdit} />
          ))}
          {!canEdit && mine?.state !== 'pending' && (
            <p className="text-center text-[11px] text-muted">You are viewing this task. Only accepted members can record progress.</p>
          )}
        </div>
      )}

      {tab === 'team' && (
        <div className="card divide-y divide-line">
          {Object.entries(task.members || {}).map(([id, m]) => {
            const c = parts.find((p) => p.empId === id);
            const e = employees?.[id];
            return (
              <div key={id} className="flex items-center gap-3 p-3.5">
                <Avatar emp={e} size={34} ring />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e?.name || id}</p>
                  <p className="font-mono text-[11px] text-muted">{id} · {e?.designation || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold" style={{ color: colorFor(id) }}>
                    {c ? `${Math.round(c.share * 100)}%` : '—'}
                  </p>
                  <p className="eyebrow">of progress</p>
                </div>
                <Chip color={m.state === 'accepted' ? '#1F8A4C' : m.state === 'denied' ? '#D93025' : m.state === 'awaiting_manager' ? '#0B4E8C' : '#5A7391'}>
                  {m.state === 'denied' ? 'Declined' : m.state === 'accepted' ? 'Accepted' : m.state === 'awaiting_manager' ? 'Manager approval' : 'Awaiting'}
                </Chip>
              </div>
            );
          })}
          {Object.values(task.members || {}).some((m) => m.reason) && (
            <div className="p-3.5">
              <p className="eyebrow mb-1.5">Reasons given for declining</p>
              {Object.entries(task.members || {}).filter(([, m]) => m.reason).map(([id, m]) => (
                <p key={id} className="text-xs text-muted">
                  <b className="text-ink">{employees?.[id]?.name || id}</b> — {m.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'trail' && (
        <div className="card divide-y divide-line">
          {trail.length === 0 && <p className="p-6 text-center text-sm text-muted">Nothing recorded yet.</p>}
          {trail.map(([id, a]) => (
            <div key={id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar emp={employees?.[a.empId]} size={22} />
              <p className="min-w-0 flex-1 truncate text-xs">
                <b>{employees?.[a.empId]?.name || a.empId}</b>{' '}
                <span className="text-muted">{a.action}</span>{' '}
                {a.detail && <span className="text-muted">— {a.detail}</span>}
              </p>
              <span className="shrink-0 font-mono text-[10px] text-muted">{fmtDateTime(a.at)}</span>
            </div>
          ))}
        </div>
      )}

      <Modal open={denyOpen} onClose={() => setDenyOpen(false)} title="Decline this task">
        <div className="space-y-4">
          <Field label="Reason" hint="The admin sees this and can reassign the task to someone else.">
            <textarea className="field" rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Already committed to the AIRAWAT deployment through this month." />
          </Field>
          <button className="btn-danger w-full" disabled={!reason.trim() || declining}
                  onClick={async () => {
                    setDeclining(true);
                    try { await respondToTask(task, me, false, reason); setDenyOpen(false); setReason(''); }
                    catch { setDeclining(false); }
                  }}>
            {declining ? 'Declining…' : 'Decline task'}
          </button>
        </div>
      </Modal>

      <ExtendModal open={extOpen} onClose={() => setExtOpen(false)} task={task} me={me} />
      <ReassignModal open={reaOpen} onClose={() => setReaOpen(false)} task={task} me={me} employees={employees} />
      <EditTaskModal open={editOpen} onClose={() => setEditOpen(false)} task={task} me={me} employees={employees} />

      <DangerConfirm
        open={delOpen} onClose={() => setDelOpen(false)}
        title="Delete this task"
        body={`This permanently removes "${task.title}" and its entire history — progress, remarks and audit trail. This cannot be undone.`}
        phrase="DELETE" confirmLabel="Delete task"
        onConfirm={async (pin) => { await httpsCallable(fns, 'deleteTasks')({ taskIds: [task.id], pin }); onClose(); }} />
    </div>
  );
}

/* -------------------------------- admin acts ------------------------------- */

function ExtendModal({ open, onClose, task, me }) {
  const [date, setDate] = useState(toDateInput(task.deadline));
  const [why, setWhy]   = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Extend the deadline">
      <div className="space-y-4">
        <p className="text-xs text-muted">Currently due {fmtDate(task.deadline)}. The extension is recorded against the task, and the original date stays on the record.</p>
        <Field label="New deadline">
          <input type="date" className="field font-mono" value={date} min={toDateInput(Date.now())}
                 onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="field" value={why} onChange={(e) => setWhy(e.target.value)}
                 placeholder="Procurement of the test bench slipped by three weeks." />
        </Field>
        <button className="btn-primary w-full" disabled={!date || !why.trim()}
                onClick={() => { extendDeadline(task, new Date(date).setHours(23, 59, 59), why, me); onClose(); }}>
          Extend deadline
        </button>
      </div>
    </Modal>
  );
}

function ReassignModal({ open, onClose, task, me, employees }) {
  const [sel, setSel]   = useState(Object.keys(task.members || {}));
  const [date, setDate] = useState('');
  const [why, setWhy]   = useState('');
  const [reset, setReset] = useState(false);
  const [q, setQ]       = useState('');

  const list = useMemo(() => Object.values(employees || {})
    .filter((e) => e.active !== false)
    .filter((e) => !q || `${e.name} ${e.empId} ${e.department}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [employees, q]);

  return (
    <Modal open={open} onClose={onClose} title="Reassign this task" wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          The activities stay. The current team, their answers and the old deadline are filed as a round on the record,
          then the task goes out fresh to whoever you pick.
        </p>
        <Field label="Assign to">
          <input className="field" placeholder="Search name, ID or department" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line p-1.5">
          {list.map((e) => (
            <label key={e.empId} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-sky">
              <input type="checkbox" className="accent-blue" checked={sel.includes(e.empId)}
                     onChange={() => setSel((s) => s.includes(e.empId) ? s.filter((x) => x !== e.empId) : [...s, e.empId])} />
              <Avatar emp={e} size={22} />
              <span className="min-w-0 flex-1 truncate text-xs">{e.name}</span>
              <span className="font-mono text-[10px] text-muted">{e.department}</span>
            </label>
          ))}
        </div>
        <Field label="New deadline">
          <input type="date" className="field font-mono" value={date} min={toDateInput(Date.now())}
                 onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="field" value={why} onChange={(e) => setWhy(e.target.value)}
                 placeholder="Deliverable did not meet the review checklist." />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="accent-blue" checked={reset} onChange={(e) => setReset(e.target.checked)} />
          Reset all activities to 0% and clear the contribution record
        </label>
        <button className="btn-primary w-full" disabled={!sel.length || !date || !why.trim()}
                onClick={() => { reassignTask(task, sel, new Date(date).setHours(23, 59, 59), why, me, reset, { employees, role: 'admin' }); onClose(); }}>
          Reassign to {sel.length} {sel.length === 1 ? 'person' : 'people'}
        </button>
      </div>
    </Modal>
  );
}

function EditTaskModal({ open, onClose, task, me, employees }) {
  const [title, setTitle] = useState(task.title || '');
  const [desc, setDesc]   = useState(task.description || '');
  const [dept, setDept]   = useState(task.department || '');
  const [date, setDate]   = useState(toDateInput(task.deadline));
  const [busy, setBusy]   = useState(false);

  useMemo(() => {
    if (open) { setTitle(task.title || ''); setDesc(task.description || '');
                setDept(task.department || ''); setDate(toDateInput(task.deadline)); }
  }, [open, task]);

  const depts = useMemo(
    () => [...new Set(Object.values(employees || {}).map((e) => e.department).filter(Boolean))].sort(),
    [employees]);

  const save = async () => {
    setBusy(true);
    await updateTaskFields(task.id, {
      title, description: desc, department: dept,
      deadline: date ? new Date(date).setHours(23, 59, 59) : task.deadline
    }, me);
    setBusy(false); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit task details">
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Changes the headline fields. Activities, members and progress are managed from the task itself;
          use Reassign to change who is on it.
        </p>
        <Field label="Task">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className="field" rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <input className="field" list="edit-task-depts" value={dept} onChange={(e) => setDept(e.target.value)} />
            <datalist id="edit-task-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Deadline" hint="Changing this re-paces the task against today.">
            <input type="date" className="field font-mono" value={date} min={toDateInput(Date.now())}
                   onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <button className="btn-primary w-full" disabled={!title.trim() || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------- manager approval panel (in task) ------------------- */

function ManagerApprovalPanel({ task, me, employees }) {
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // empId being rejected
  const [reason, setReason] = useState('');

  // Members on this task whose approver is me and who are still awaiting.
  const mine = Object.entries(task.members || {})
    .filter(([, m]) => m.state === 'awaiting_manager' && m.approver === me.empId);
  if (!mine.length) return null;

  const approve = async (empId) => {
    setBusyId(empId);
    try { await approveAssignment(task.id, empId); }
    finally { setBusyId(null); }
  };
  const reject = async (empId) => {
    setBusyId(empId);
    try { await rejectAssignment(task.id, empId, reason); setRejecting(null); setReason(''); }
    finally { setBusyId(null); }
  };

  return (
    <div className="card border-blue/40 bg-blue/[.03] p-4">
      <p className="text-sm font-medium">Approval needed from you</p>
      <p className="mt-0.5 text-xs text-muted">
        An administrator assigned this task to {mine.length === 1 ? 'someone' : 'people'} who report{mine.length === 1 ? 's' : ''} to you.
        Approve to send it on for their acceptance, or reject it back to the administrator.
      </p>
      <div className="mt-3 space-y-2">
        {mine.map(([empId]) => {
          const e = employees?.[empId];
          const isRejecting = rejecting === empId;
          return (
            <div key={empId} className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-center gap-2.5">
                <Avatar emp={e} size={28} ring />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e?.name || empId}</p>
                  <p className="font-mono text-[10px] text-muted">{empId} · {e?.designation || '—'}</p>
                </div>
                {!isRejecting && (
                  <div className="flex gap-2">
                    <button className="btn-primary !py-1.5 text-xs" disabled={busyId === empId}
                            onClick={() => approve(empId)}>
                      {busyId === empId ? '…' : 'Approve'}
                    </button>
                    <button className="btn-ghost !py-1.5 text-xs" disabled={busyId === empId}
                            onClick={() => setRejecting(empId)}>Reject</button>
                  </div>
                )}
              </div>
              {isRejecting && (
                <div className="mt-2.5 space-y-2">
                  <input className="field text-xs" placeholder="Reason (optional) — the admin will see this"
                         value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <button className="btn-danger !py-1.5 text-xs" disabled={busyId === empId}
                            onClick={() => reject(empId)}>
                      {busyId === empId ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => { setRejecting(null); setReason(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
