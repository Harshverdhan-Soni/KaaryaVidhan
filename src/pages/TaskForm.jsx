import { useState, useMemo, useEffect, useRef } from 'react';
import { Modal, Field, Avatar, Chip } from '../components/ui';
import { useDb } from '../lib/useDb';
import { createTask, createGroup, createCompletedTask } from '../lib/db';
import { toDateInput, initialMemberState, visibleGroups, GROUP_KINDS } from '../lib/progress';

/**
 * One form, three modes driven by role:
 *   - employee → self-assign: origin 'self', can only add themselves + colleagues they pull in
 *   - manager  → assign to own reports (and self): origin 'assigned'
 *   - admin    → assign to anyone: origin 'assigned'
 * The member's starting state (accept gate vs manager-approval gate) is decided
 * by initialMemberState, not here — this form just picks people.
 */
export default function TaskForm({ open, onClose, employees, me, role, prefill, onCreated }) {
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
  const [err, setErr]     = useState('');

  // Recording an already-completed task (Phase 1: admins and managers only).
  const canRecordCompleted = role === 'admin' || role === 'manager';
  const [completed, setCompleted] = useState(false);
  const [startD, setStartD] = useState('');
  const [compD, setCompD]   = useState('');
  // Per-activity contributors, kept parallel to `acts`: contribs[i] is the list
  // of { empId, pct } for activity i.
  const [contribs, setContribs] = useState([[]]);

  // Activity add/remove/rename go through these so `acts` and `contribs` always
  // stay the same length.
  const addAct = () => { setActs([...acts, '']); setContribs([...contribs, []]); };
  const removeAct = (i) => { setActs(acts.filter((_, j) => j !== i)); setContribs(contribs.filter((_, j) => j !== i)); };
  const setActTitle = (i, v) => setActs(acts.map((x, j) => (j === i ? v : x)));

  const addContrib = (ai) => setContribs(contribs.map((cs, j) => (j === ai ? [...cs, { empId: '', pct: '' }] : cs)));
  const setContrib = (ai, ci, field, v) =>
    setContribs(contribs.map((cs, j) => (j === ai ? cs.map((c, k) => (k === ci ? { ...c, [field]: v } : c)) : cs)));
  const removeContrib = (ai, ci) => setContribs(contribs.map((cs, j) => (j === ai ? cs.filter((_, k) => k !== ci) : cs)));
  const actSum = (ai) => (contribs[ai] || []).reduce((s, c) => s + (Number(c.pct) || 0), 0);

  // Groups: pick an existing one this person may see; admins/managers can make
  // a new one inline.
  const groupsRaw = useDb('groups');
  const groups = useMemo(() => visibleGroups(groupsRaw, me, role), [groupsRaw, me, role]);
  const canCreateGroup = role === 'admin' || role === 'manager';
  const [groupId, setGroupId]   = useState('');
  const [newGroup, setNewGroup] = useState(false);
  const [gName, setGName]       = useState('');
  const [gKind, setGKind]       = useState('functional');
  const [gBusy, setGBusy]       = useState(false);
  const [gErr, setGErr]         = useState('');

  const makeGroup = async () => {
    if (!gName.trim()) return;
    setGBusy(true); setGErr('');
    try {
      const g = await createGroup({ name: gName, kind: gKind }, me, role);
      setGroupId(g.id); setNewGroup(false); setGName(''); setGKind('functional');
    } catch { setGErr('Could not create that group.'); }
    finally { setGBusy(false); }
  };

  // When the form opens from a template, seed the name, description and
  // activities; department, deadline and people stay for the user to fill.
  const seededFrom = useRef(null);
  useEffect(() => {
    if (open && prefill && seededFrom.current !== prefill) {
      seededFrom.current = prefill;
      setTitle(prefill.title || '');
      setDesc(prefill.description || '');
      setActs(prefill.activities?.length ? [...prefill.activities] : ['']);
      setContribs(prefill.activities?.length ? prefill.activities.map(() => []) : [[]]);
    }
    if (!open) seededFrom.current = null;
  }, [open, prefill]);

  // If the template carries a group, resolve it to one this person can see and
  // pre-select it. If it doesn't exist yet and this person may create groups,
  // open the inline "new group" panel pre-filled. Runs once per prefill: it
  // reacts to the groups subscription loading, with a fallback for the case
  // where there are no groups at all (so the subscription stays null).
  const groupSeededFrom = useRef(null);
  useEffect(() => {
    if (!open) { groupSeededFrom.current = null; return; }
    if (!prefill || !prefill.groupName || groupSeededFrom.current === prefill) return;

    const want = prefill.groupName.trim().toLowerCase();
    const kind = prefill.groupKind === 'project' ? 'project' : 'functional';
    const openCreate = () => { if (canCreateGroup) { setNewGroup(true); setGName(prefill.groupName.trim()); setGKind(kind); } };

    const match = groups.find((g) => (g.name || '').trim().toLowerCase() === want && (g.kind || 'functional') === kind)
               || groups.find((g) => (g.name || '').trim().toLowerCase() === want);
    if (match) { groupSeededFrom.current = prefill; setGroupId(match.id); return; }
    if (groupsRaw) { groupSeededFrom.current = prefill; openCreate(); return; } // groups loaded, none match

    // groupsRaw still null — either loading or genuinely empty. Wait a beat, then
    // fall back to offering creation so an empty database doesn't stall this.
    const t = setTimeout(() => {
      if (groupSeededFrom.current === prefill) return;
      groupSeededFrom.current = prefill; openCreate();
    }, 1200);
    return () => clearTimeout(t);
  }, [open, prefill, groups, groupsRaw, canCreateGroup]);

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

  // Completed-mode: activities with their contributors, empty-title rows dropped.
  const builtActs = useMemo(() => acts.map((t, i) => ({
    title: t.trim(),
    contribs: (contribs[i] || [])
      .filter((c) => c.empId && Number(c.pct) > 0)
      .map((c) => ({ empId: c.empId, pct: Number(c.pct) }))
  })).filter((a) => a.title), [acts, contribs]);

  const completedValid = title.trim() && startD && date && compD && builtActs.length > 0 &&
    builtActs.every((a) => a.contribs.length > 0 && Math.abs(a.contribs.reduce((s, c) => s + c.pct, 0) - 100) <= 0.5);

  const valid = completed ? completedValid : (title.trim() && date && clean.length && sel.length);

  const resetForm = () => {
    setTitle(''); setDesc(''); setDate(''); setActs(['']); setContribs([[]]);
    setSel(origin === 'self' ? [me.empId] : []); setGroupId('');
    setStartD(''); setCompD(''); setCompleted(false); setErr('');
  };

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let id;
      if (completed) {
        id = await createCompletedTask({
          title: title.trim(), description: desc.trim(), department: dept || me.department || '',
          groupId: groupId || null,
          startDate: new Date(startD).setHours(0, 0, 0, 0),
          deadline: new Date(date).setHours(23, 59, 59),
          completedAt: new Date(compD).setHours(23, 59, 59),
          activities: builtActs
        });
      } else {
        const activities = {};
        clean.forEach((t, i) => { activities[`a${i}`] = { title: t, order: i, progress: 0, blocked: false }; });
        const members = {};
        sel.forEach((mid) => {
          const assignee = employees?.[mid];
          // The gate rule lives in one place; self-assigns, own-manager assigns
          // and cross-team admin assigns all resolve here.
          members[mid] = assignee
            ? initialMemberState({ empId: me.empId, role }, assignee)
            : { state: 'pending', at: Date.now() };
        });
        id = await createTask({
          title: title.trim(), description: desc.trim(), department: dept || me.department || '',
          origin, startDate: Date.now(), deadline: new Date(date).setHours(23, 59, 59),
          status: 'active', activities, members, groupId: groupId || null
        }, me);
      }
      resetForm();
      onClose(); onCreated?.(id);
    } catch (e) {
      setErr(e?.message || 'Could not save the task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide
           title={completed ? 'Record a completed task'
                  : prefill ? `From template: ${prefill.title}`
                  : origin === 'self' ? 'Add a task' : 'Create and assign a task'}>
      <div className="space-y-4">
        <Field label="Task">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Migrate the HMIS reporting module to the new schema" />
        </Field>
        <Field label="Description" hint="Optional. What does done look like?">
          <textarea className="field" rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>

        {canRecordCompleted && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-sky/50 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 accent-blue" checked={completed}
                   onChange={(e) => setCompleted(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">This task is already completed</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                Record past work for the history: set the dates and who contributed to each activity. It's saved
                as completed with every activity at 100% — no approval needed.
              </span>
            </span>
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <input className="field" list="depts" value={dept} onChange={(e) => setDept(e.target.value)}
                   placeholder="AI & Quantum Computing" />
            <datalist id="depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          {!completed && (
            <Field label="Deadline" hint="Progress is paced against today ÷ this date.">
              <input type="date" className="field font-mono" value={date} min={toDateInput(Date.now())}
                     onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
        </div>

        {completed && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Start date">
              <input type="date" className="field font-mono" value={startD} max={toDateInput(Date.now())}
                     onChange={(e) => setStartD(e.target.value)} />
            </Field>
            <Field label="Deadline" hint="The date it was due.">
              <input type="date" className="field font-mono" value={date}
                     onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Completed on" hint="After the deadline reads as “late”.">
              <input type="date" className="field font-mono" value={compD} max={toDateInput(Date.now())}
                     onChange={(e) => setCompD(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Group" hint="Organise this task under a functional area or a project. Optional.">
          {!newGroup ? (
            <div className="flex gap-2">
              <select className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">— No group —</option>
                {GROUP_KINDS.map(([k, label]) => {
                  const gs = groups.filter((g) => (g.kind || 'functional') === k);
                  return gs.length ? (
                    <optgroup key={k} label={label}>
                      {gs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
              {canCreateGroup && (
                <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => setNewGroup(true)}>+ New group</button>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-line p-2.5">
              <input className="field" placeholder="New group name (e.g. WAMIS)" value={gName}
                     onChange={(e) => setGName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); makeGroup(); } }} />
              <div className="flex gap-2">
                <select className="field" value={gKind} onChange={(e) => setGKind(e.target.value)}>
                  <option value="functional">Functional area</option>
                  <option value="project">Project</option>
                </select>
                <button type="button" className="btn-primary shrink-0 text-xs" disabled={!gName.trim() || gBusy} onClick={makeGroup}>
                  {gBusy ? 'Creating…' : 'Create'}
                </button>
                <button type="button" className="btn-ghost shrink-0 text-xs"
                        onClick={() => { setNewGroup(false); setGName(''); setGErr(''); }}>Cancel</button>
              </div>
              {role === 'manager' && (
                <p className="text-[11px] text-muted">Only you, your team and admins will see this group.</p>
              )}
              {gErr && <p className="text-[11px] text-bad">{gErr}</p>}
            </div>
          )}
        </Field>

        <div>
          <p className="eyebrow mb-1.5">Activities — the steps that make up the task</p>
          <p className="mb-2 text-[11px] text-muted">
            Progress is the average of these. Four activities means each one is worth a quarter of the task.
          </p>
          <div className="space-y-2">
            {acts.map((a, i) => (
              <div key={i} className={completed ? 'rounded-lg border border-line p-2.5' : ''}>
                <div className="flex gap-2">
                  <span className="grid w-7 shrink-0 place-items-center font-mono text-[11px] text-muted">{i + 1}</span>
                  <input className="field" value={a} placeholder="Freeze the target schema with the DBA"
                         onChange={(e) => setActTitle(i, e.target.value)}
                         onKeyDown={(e) => { if (e.key === 'Enter' && a.trim() && i === acts.length - 1) addAct(); }} />
                  <button className="btn-ghost !px-2.5 text-xs" disabled={acts.length === 1}
                          onClick={() => removeAct(i)} aria-label="Remove activity">×</button>
                </div>

                {completed && a.trim() && (
                  <div className="ml-9 mt-2 space-y-1.5">
                    {(contribs[i] || []).map((c, ci) => (
                      <div key={ci} className="flex items-center gap-2">
                        <select className="field !py-1.5 text-xs" value={c.empId}
                                onChange={(e) => setContrib(i, ci, 'empId', e.target.value)}>
                          <option value="">— contributor —</option>
                          {assignable.map((e) => <option key={e.empId} value={e.empId}>{e.name} — {e.empId}</option>)}
                        </select>
                        <input type="number" min="0" max="100" className="field !w-20 !py-1.5 text-xs font-mono"
                               placeholder="%" value={c.pct}
                               onChange={(e) => setContrib(i, ci, 'pct', e.target.value.replace(/[^\d.]/g, ''))} />
                        <span className="font-mono text-[11px] text-muted">%</span>
                        <button className="btn-ghost !px-2 text-xs" onClick={() => removeContrib(i, ci)} aria-label="Remove contributor">×</button>
                      </div>
                    ))}
                    <div className="flex items-center gap-3">
                      <button className="btn-ghost text-[11px]" onClick={() => addContrib(i)}>+ Add contributor</button>
                      {(contribs[i] || []).length > 0 && (
                        <span className={`font-mono text-[11px] ${Math.abs(actSum(i) - 100) <= 0.5 ? 'text-ok' : 'text-bad'}`}>
                          {actSum(i)}% {Math.abs(actSum(i) - 100) <= 0.5 ? '✓' : 'of 100%'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 text-xs" onClick={addAct}>+ Add activity</button>
          {completed && (
            <p className="mt-2 text-[11px] text-muted">
              Each activity is saved at 100%. Split its 100% among the people who did the work — the shares
              show as their colours on the Pace Bar.
            </p>
          )}
        </div>

        {!completed && (
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
        )}

        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}

        <button className="btn-primary w-full" disabled={!valid || busy} onClick={submit}>
          {busy
            ? (completed ? 'Recording…' : 'Creating…')
            : completed
              ? 'Record completed task'
              : `Create task with ${clean.length} ${clean.length === 1 ? 'activity' : 'activities'}`}
        </button>
      </div>
    </Modal>
  );
}
