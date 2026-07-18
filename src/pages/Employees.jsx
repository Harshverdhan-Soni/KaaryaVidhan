import { useState, useMemo, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { fns } from '../lib/firebase';
import { useAuthed } from '../lib/auth';
import { Avatar, Chip, Modal, Field, Empty, AsyncButton, DangerConfirm } from '../components/ui';
import { parseEmployeeWorkbook, linkManagers, downloadTemplate, exportRows } from '../lib/excel';
import { updateEmployee } from '../lib/db';
import { colorFor } from '../lib/colors';

export default function Employees({ employees }) {
  const { me } = useAuthed();
  const [q, setQ]           = useState('');
  const [dept, setDept]     = useState('all');
  const [imp, setImp]       = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [editEmp, setEditEmp] = useState(null);
  const [sel, setSel]       = useState([]);          // selected empIds for bulk delete
  const [delOpen, setDelOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const all = Object.values(employees || {});
  const depts = useMemo(() => [...new Set(all.map((e) => e.department).filter(Boolean))].sort(), [employees]);
  const list = all
    .filter((e) => dept === 'all' || e.department === dept)
    .filter((e) => !q || `${e.name} ${e.empId} ${e.designation} ${e.department}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  // You can never select yourself for deletion — the account you're signed into.
  const selectable = list.filter((e) => e.empId !== me.empId);
  const allSelected = selectable.length > 0 && selectable.every((e) => sel.includes(e.empId));
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleAll = () => setSel(allSelected ? [] : selectable.map((e) => e.empId));

  const doDelete = async (pin) => {
    await httpsCallable(fns, 'deleteEmployees')({ empIds: sel, pin });
    setSel([]);
  };
  const doReset = async (pin) => {
    await httpsCallable(fns, 'resetApp')({ pin, confirm: 'RESET' });
    setSel([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field max-w-[13rem]" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="all">Every department</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="ml-auto flex flex-wrap gap-2">
          <AsyncButton className="btn-ghost text-xs" onClick={() => exportRows(list,
            [['Employee ID', (r) => r.empId], ['Employee Name', (r) => r.name], ['Designation', (r) => r.designation],
             ['Department', (r) => r.department], ['Reporting Authority Name', (r) => r.reportingTo],
             ['Role', (r) => r.role]], 'kaarya-employees.xlsx')}>Export</AsyncButton>
          <button className="btn-primary text-xs" onClick={() => setImp(true)}>Import from Excel</button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="font-mono text-[11px] text-muted">{list.length} of {all.length} employees</p>
        {selectable.length > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input type="checkbox" className="accent-blue" checked={allSelected} onChange={toggleAll} />
            Select all
          </label>
        )}
        {sel.length > 0 && (
          <button className="btn-danger !py-1.5 text-xs" onClick={() => setDelOpen(true)}>
            Delete {sel.length} selected
          </button>
        )}
        <button className="ml-auto text-[11px] font-medium text-bad hover:underline" onClick={() => setResetOpen(true)}>
          Reset app…
        </button>
      </div>

      {list.length === 0 ? (
        <Empty title="No employees yet. Import your staff list to create accounts."
               action={<button className="btn-primary text-xs" onClick={() => setImp(true)}>Import from Excel</button>} />
      ) : (
        <div className="card divide-y divide-line">
          {list.map((e) => {
            const isMe = e.empId === me.empId;
            return (
              <div key={e.empId} className={`flex items-center gap-3 p-3.5 ${sel.includes(e.empId) ? 'bg-sky' : ''}`}>
                <input type="checkbox" className="accent-blue disabled:opacity-25" disabled={isMe}
                       checked={sel.includes(e.empId)} onChange={() => toggle(e.empId)}
                       title={isMe ? 'You cannot delete your own account' : ''} />
                <Avatar emp={e} size={36} ring />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}{isMe && <span className="ml-1.5 text-[11px] text-muted">(you)</span>}</p>
                  <p className="truncate font-mono text-[11px] text-muted">
                    {e.empId} · {e.designation || '—'} · {e.department || '—'}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="eyebrow">Reports to</p>
                  <p className="font-mono text-[11px]">{employees?.[e.managerId]?.name || e.reportingTo || '—'}</p>
                </div>
                {e.role !== 'employee' && <Chip color="#0B4E8C">{e.role === 'admin' ? 'Admin' : 'Manager'}</Chip>}
                <button className="btn-ghost !px-2.5 text-[11px]" onClick={() => setEditEmp(e)}>Edit</button>
                <button className="btn-ghost !px-2.5 text-[11px]" onClick={() => setPinFor(e)}>PIN</button>
              </div>
            );
          })}
        </div>
      )}

      <ImportModal open={imp} onClose={() => setImp(false)} existing={employees} />
      <PinModal emp={pinFor} onClose={() => setPinFor(null)} />
      <EditEmployeeModal emp={editEmp} onClose={() => setEditEmp(null)} me={me} depts={depts} employees={employees} />

      <DangerConfirm
        open={delOpen} onClose={() => setDelOpen(false)}
        title={`Delete ${sel.length} ${sel.length === 1 ? 'employee' : 'employees'}`}
        body={`This removes ${sel.length === 1 ? 'the account' : 'these accounts'} and ${sel.length === 1 ? 'its' : 'their'} PIN, and takes ${sel.length === 1 ? 'them' : 'them'} off any task ${sel.length === 1 ? 'they are' : 'they are'} on. The tasks themselves are kept. This cannot be undone.`}
        phrase="DELETE" confirmLabel={`Delete ${sel.length}`} onConfirm={doDelete} />

      <DangerConfirm
        open={resetOpen} onClose={() => setResetOpen(false)}
        title="Reset the whole app"
        body="This deletes EVERY employee, every PIN, and every task, comment and history record — wiping the app back to empty. Only your own admin account is kept, so you stay signed in. There is no undo."
        phrase="RESET" confirmLabel="Erase everything except me" onConfirm={doReset} />
    </div>
  );
}

/* ------------------------------ edit employee ----------------------------- */

function EditEmployeeModal({ emp, onClose, me, depts, employees }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  // Seed local state when a new employee is opened.
  useMemo(() => {
    if (emp) setF({ name: emp.name || '', designation: emp.designation || '',
                    department: emp.department || '', reportingTo: emp.reportingTo || '' });
  }, [emp]);

  // Everyone except this person — nobody reports to themselves.
  const others = useMemo(() => Object.values(employees || {})
    .filter((e) => e.empId !== emp?.empId)
    .sort((a, b) => a.name.localeCompare(b.name)), [employees, emp]);

  if (!emp || !f) return null;

  // The stored value is a name; it may not correspond to anyone still listed.
  const currentIsKnown = others.some((e) => e.name === f.reportingTo);

  const save = async () => {
    if (!f.name.trim()) { setErr('A name is required.'); return; }
    setBusy(true); setErr('');
    try { await updateEmployee(emp.empId, f, me); onClose(); }
    catch { setErr('Could not save those changes.'); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Edit — ${emp.name}`}>
      <div className="space-y-4">
        <p className="font-mono text-[11px] text-muted">
          {emp.empId}{emp.role === 'admin' && ' · Admin'}{emp.role === 'manager' && ' · Manager'}
        </p>
        <Field label="Name">
          <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Designation">
          <input className="field" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
        </Field>
        <Field label="Department">
          <input className="field" list="edit-depts" value={f.department}
                 onChange={(e) => setF({ ...f, department: e.target.value })} />
          <datalist id="edit-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Reporting authority" hint="Pick the person this employee reports to. This links the manager's view of their team.">
          <select className="field" value={f.reportingTo}
                  onChange={(e) => setF({ ...f, reportingTo: e.target.value })}>
            <option value="">— No reporting authority —</option>
            {/* Keep an unmatched stored value visible rather than silently losing it. */}
            {f.reportingTo && !currentIsKnown && (
              <option value={f.reportingTo}>{f.reportingTo} (not in directory)</option>
            )}
            {others.map((e) => (
              <option key={e.empId} value={e.name}>
                {e.name} — {e.empId}{e.department ? ` · ${e.department}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[11px] text-muted">
          Employee ID and role can't be edited here. Role follows the reporting graph — someone becomes a
          manager when others report to them — and is recalculated on the next Excel import.
        </p>
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}
        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

/* --------------------------------- import --------------------------------- */

function ImportModal({ open, onClose, existing }) {
  const [stage, setStage] = useState('pick');   // pick → review → done
  const [res, setRes]     = useState(null);
  const [mode, setMode]   = useState('merge');
  const [out, setOut]     = useState(null);
  const [err, setErr]     = useState('');
  const fileRef = useRef();

  const reset = () => { setStage('pick'); setRes(null); setOut(null); setErr(''); };
  const close = () => { reset(); onClose(); };

  const pick = async (file) => {
    if (!file) return;
    setErr('');
    try {
      const parsed = await parseEmployeeWorkbook(file);
      const { rows, unresolved } = linkManagers(parsed.rows);
      setRes({ ...parsed, rows, unresolved });
      setStage('review');
    } catch {
      setErr('That file could not be read. Save it as .xlsx or .csv and try again.');
    }
  };

  const commit = async () => {
    setStage('working');
    try {
      const call = httpsCallable(fns, 'importEmployees');
      const { data } = await call({ rows: res.rows, mode });
      setOut(data); setStage('done');
    } catch (e) {
      setErr(e?.message || 'The import did not complete.');
      setStage('review');
    }
  };

  return (
    <Modal open={open} onClose={close} wide title="Import employees">
      {stage === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Upload your staff list. KaaryaVidhan reads five columns — Employee ID, Employee Name, Designation,
            Department and Reporting Authority Name — and matches the header names loosely, so
            “Dept” or “Reports To” will be understood.
          </p>
          <div className="rounded-xl border-2 border-dashed border-line p-8 text-center">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                   onChange={(e) => pick(e.target.files[0])} />
            <button className="btn-primary" onClick={() => fileRef.current.click()}>Choose file</button>
            <p className="mt-2 text-[11px] text-muted">.xlsx, .xls or .csv · first sheet is read</p>
          </div>
          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}
          <AsyncButton className="text-xs font-medium text-blue hover:text-ink" onClick={downloadTemplate}>
            Download a template with the right columns
          </AsyncButton>
        </div>
      )}

      {stage === 'review' && res && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[['Ready to import', res.rows.length, '#1F8A4C'],
              ['Rows skipped', res.errors.length, res.errors.length ? '#D93025' : '#5A7391'],
              ['Managers unmatched', res.unresolved.length, res.unresolved.length ? '#E8801A' : '#5A7391']]
              .map(([k, v, c]) => (
                <div key={k} className="card p-3">
                  <p className="font-mono text-2xl font-semibold" style={{ color: c }}>{v}</p>
                  <p className="eyebrow mt-0.5">{k}</p>
                </div>
              ))}
          </div>

          {res.missing.length > 0 && (
            <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">
              These columns are missing and are required: {res.missing.join(', ')}.
            </p>
          )}

          {res.errors.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Rows that will not be imported</p>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {res.errors.map((e, i) => (
                  <p key={i} className="px-3 py-1.5 text-[11px]">
                    <span className="font-mono text-muted">Row {e.row}</span> — {e.problem}
                  </p>
                ))}
              </div>
            </div>
          )}

          {res.unresolved.length > 0 && (
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">
              {res.unresolved.length} rows name a reporting authority who is not in this file
              ({[...new Set(res.unresolved.map((r) => r.reportingTo))].slice(0, 4).join(', ')}
              {res.unresolved.length > 4 ? '…' : ''}). They import fine — the name is kept, but no
              manager view is linked until that person exists.
            </p>
          )}

          <div>
            <p className="eyebrow mb-1.5">Preview — first 6 rows</p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-sky">
                  <tr>{['', 'ID', 'Name', 'Designation', 'Department', 'Reports to', 'Role'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-1.5 font-mono uppercase tracking-wider text-muted">{h}</th>))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {res.rows.slice(0, 6).map((r) => (
                    <tr key={r.empId}>
                      <td className="px-2.5 py-1.5">
                        <i className="block h-3 w-3 rounded-full" style={{ background: colorFor(r.empId) }}
                           title="Colour assigned from the Employee ID" />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono">{r.empId}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        {r.name}{existing?.[r.empId] && <span className="ml-1 text-warn">· exists</span>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{r.designation || '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{r.department || '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{r.reportingTo || '—'}</td>
                      <td className="px-2.5 py-1.5">{r.role === 'manager' ? <Chip color="#0B4E8C">Manager</Chip> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Anyone named as someone else's reporting authority becomes a manager and can see their
              reports' tasks. Colours are fixed from the Employee ID and will not change on re-import.
            </p>
          </div>

          <Field label="If an Employee ID already exists">
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="merge">Update their details, keep their PIN and tasks</option>
              <option value="skip">Leave them untouched, import only new people</option>
            </select>
          </Field>

          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-xs" onClick={reset}>Choose a different file</button>
            <button className="btn-primary flex-[2]" disabled={!res.rows.length || res.missing.length} onClick={commit}>
              Import {res.rows.length} employees
            </button>
          </div>
        </div>
      )}

      {stage === 'working' && <p className="py-8 text-center text-sm text-muted">Creating accounts…</p>}

      {stage === 'done' && out && (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{out.created}</b> accounts created, <b>{out.updated}</b> updated, <b>{out.skipped}</b> skipped.
          </p>
          {out.pins?.length > 0 && (
            <>
              <p className="text-xs text-muted">
                New accounts get a starting PIN. Hand these out, and ask people to change theirs after
                the first sign-in. This list is shown once.
              </p>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {out.pins.map((p) => (
                  <div key={p.empId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-mono">{p.empId}</span>
                    <span className="truncate px-2 text-muted">{p.name}</span>
                    <span className="font-mono font-semibold tracking-widest">{p.pin}</span>
                  </div>
                ))}
              </div>
              <AsyncButton className="btn-ghost w-full text-xs" onClick={() => exportRows(out.pins,
                [['Employee ID', (r) => r.empId], ['Employee Name', (r) => r.name], ['Starting PIN', (r) => r.pin]],
                'kaarya-starting-pins.xlsx')}>Download the PIN list</AsyncButton>
            </>
          )}
          <button className="btn-primary w-full" onClick={close}>Done</button>
        </div>
      )}
    </Modal>
  );
}

function PinModal({ emp, onClose }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  if (!emp) return null;
  const save = async () => {
    try {
      await httpsCallable(fns, 'setPin')({ empId: emp.empId, pin });
      setMsg(`PIN reset for ${emp.name}.`); setPin('');
    } catch { setMsg('Could not reset that PIN.'); }
  };
  return (
    <Modal open onClose={onClose} title={`Reset PIN — ${emp.name}`}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          You cannot read someone's PIN, only replace it. Give the new one to {emp.name.split(' ')[0]} directly.
        </p>
        <Field label="New PIN" hint="4 to 6 digits">
          <input className="field font-mono tracking-[.4em]" inputMode="numeric" value={pin}
                 onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        {msg && <p className="rounded-lg bg-ok/10 px-3 py-2 text-xs text-ok">{msg}</p>}
        <button className="btn-primary w-full" disabled={pin.length < 4} onClick={save}>Reset PIN</button>
      </div>
    </Modal>
  );
}
