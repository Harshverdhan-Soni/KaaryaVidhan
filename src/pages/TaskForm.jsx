import { useState, useMemo } from 'react';
import { Modal, Field, Avatar, Chip } from '../components/ui';
import { createTask } from '../lib/db';
import { toDateInput, initialMemberState } from '../lib/progress';

/**
 * One form, three modes driven by role:
 *   - employee → self-assign: origin 'self', can only add themselves + colleagues they pull in
 *   - manager  → assign to own reports (and self): origin 'assigned'
 *   - admin    → assign to anyone: origin 'assigned'
 * The member's starting state (accept gate vs manager-approval gate) is decided
 * by initialMemberState, not here — this form just picks people.
 */
export default function TaskForm({ open, onClose, employees, me, role, onCreated }) {
  const isEmployee = role === 'employee';
  const isManager  = role === 'manager';
  const origin = isEmployee ? 'self' : 'assigned';

  const [title, setTitle] = useState('');
  const [desc, setDesc]   = useState('');
  const [dept, setDept]   = useState(isEmployee ? me.department : '');
  const [date, setDate]   = useState('');
  const [acts, setActs]   = useState(['']);
  const [sel, setSel]     = useState(isEmployee ? [me.empId] : []);
  const [q, setQ]         = useState('');
  const [busy, setBusy]   = useState(false);

  // Who this person is allowed to assign to.
  const assignable = useMemo(() => {
    const all = Object.values(employees || {}).filter((e) => e.active !== false);
    if (role === 'admin') return all;
    if (isManager) return all.filter((e) => e.managerId === me.empId || e.empId === me.empId);
    return all;   // employee self-assign can still pull in colleagues to collaborate
  }, [employees, role, isManager, me.empId]);

  const depts = useMemo(
    () => [...new Set(Object.values(employees || {}).map((e) => e.department).filter(Boolean))].sort(),
    [employees]);

  const list = useMemo(() => assignable
    .filter((e) => !q || `${e.name} ${e.empId} ${e.department} ${e.designation}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [assignable, q]);

  const clean = acts.map((a) => a.trim()).filter(Boolean);
  const valid = title.trim() && date && clean.length && sel.length;

  const submit = async () => {
    setBusy(true);
    const activities = {};
    clean.forEach((t, i) => { activities[`a${i}`] = { title: t, order: i, progress: 0, blocked: false }; });
    const members = {};
    sel.forEach((id) => {
      const assignee = employees?.[id];
      // The gate rule lives in one place; self-assigns, own-manager assigns and
      // cross-team admin assigns all resolve here.
      members[id] = assignee
        ? initialMemberState({ empId: me.empId, role }, assignee)
        : { state: 'pending', at: Date.now() };
    });
    const id = await createTask({
      title: title.trim(), description: desc.trim(), department: dept || me.department || '',
      origin, startDate: Date.now(), deadline: new Date(date).setHours(23, 59, 59),
      status: 'active', activities, members
    }, me);
    setBusy(false);
    setTitle(''); setDesc(''); setDate(''); setActs(['']); setSel(origin === 'self' ? [me.empId] : []);
    onClose(); onCreated?.(id);
  };

  return (
    <Modal open={open} onClose={onClose} wide
           title={origin === 'self' ? 'Add a task' : 'Create and assign a task'}>
      <div className="space-y-4">
        <Field label="Task">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Migrate the HMIS reporting module to the new schema" />
        </Field>
        <Field label="Description" hint="Optional. What does done look like?">
          <textarea className="field" rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <input className="field" list="depts" value={dept} onChange={(e) => setDept(e.target.value)}
                   placeholder="AI & Quantum Computing" />
            <datalist id="depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Deadline" hint="Progress is paced against today ÷ this date.">
            <input type="date" className="field font-mono" value={date} min={toDateInput(Date.now())}
                   onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div>
          <p className="eyebrow mb-1.5">Activities — the steps that make up the task</p>
          <p className="mb-2 text-[11px] text-muted">
            Progress is the average of these. Four activities means each one is worth a quarter of the task.
          </p>
          <div className="space-y-2">
            {acts.map((a, i) => (
              <div key={i} className="flex gap-2">
                <span className="grid w-7 shrink-0 place-items-center font-mono text-[11px] text-muted">{i + 1}</span>
                <input className="field" value={a} placeholder="Freeze the target schema with the DBA"
                       onChange={(e) => setActs(acts.map((x, j) => (j === i ? e.target.value : x)))}
                       onKeyDown={(e) => { if (e.key === 'Enter' && a.trim() && i === acts.length - 1) setActs([...acts, '']); }} />
                <button className="btn-ghost !px-2.5 text-xs" disabled={acts.length === 1}
                        onClick={() => setActs(acts.filter((_, j) => j !== i))} aria-label="Remove activity">×</button>
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 text-xs" onClick={() => setActs([...acts, ''])}>+ Add activity</button>
        </div>

        <div>
          <p className="eyebrow mb-1.5">
            {origin === 'self' ? 'Work with' : 'Assign to'} — {sel.length} selected
          </p>
          <input className="field mb-2" placeholder="Search name, ID, department or designation"
                 value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-1.5">
            {list.length === 0 && <p className="p-3 text-center text-xs text-muted">No one matches that search.</p>}
            {list.map((e) => (
              <label key={e.empId}
                     className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-sky
                                 ${origin === 'self' && e.empId === me.empId ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="accent-blue" checked={sel.includes(e.empId)}
                       disabled={origin === 'self' && e.empId === me.empId}
                       onChange={() => setSel((s) => s.includes(e.empId) ? s.filter((x) => x !== e.empId) : [...s, e.empId])} />
                <Avatar emp={e} size={24} />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {e.name}{origin === 'self' && e.empId === me.empId && ' (you)'}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted">{e.department}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="btn-primary w-full" disabled={!valid || busy} onClick={submit}>
          {busy ? 'Creating…' : `Create task with ${clean.length} ${clean.length === 1 ? 'activity' : 'activities'}`}
        </button>
      </div>
    </Modal>
  );
}
