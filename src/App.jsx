import { useState } from 'react';
import { useAuthed } from './lib/auth';
import { useDb } from './lib/useDb';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import TaskDetail from './pages/TaskDetail';
import TaskForm from './pages/TaskForm';
import Templates from './pages/Templates';
import { Avatar, Modal, Field } from './components/ui';
import { LogoMark } from './components/Logo';
import { httpsCallable } from 'firebase/functions';
import { fns } from './lib/firebase';

function Header({ me, role, onLogout, onProfile }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <LogoMark size={36} />
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold leading-tight tracking-tight sm:text-base">
            <span className="text-ink">Kaarya</span><span className="text-blue">Vidhan</span>
          </p>
          <p className="hidden font-mono text-[10px] uppercase tracking-[.12em] text-muted sm:block">
            Employees Task Tracker
          </p>
        </div>
        <button className="ml-auto flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sky" onClick={onProfile}>
          <span className="hidden text-right sm:block">
            <span className="block text-xs font-medium leading-tight">{me.name}</span>
            <span className="block font-mono text-[10px] text-muted">
              {me.empId} · {role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : me.designation || 'Employee'}
            </span>
          </span>
          <Avatar emp={me} size={32} ring />
        </button>
        <button className="btn-ghost !px-2.5 text-xs" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

function ProfileModal({ open, onClose, me, role }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const save = async () => {
    try { await httpsCallable(fns, 'setPin')({ empId: me.empId, pin }); setMsg('PIN changed.'); setPin(''); }
    catch { setMsg('Could not change your PIN.'); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Your account">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar emp={me} size={48} ring />
          <div>
            <p className="font-display font-semibold">{me.name}</p>
            <p className="font-mono text-[11px] text-muted">{me.empId} · {me.designation}</p>
            <p className="font-mono text-[11px] text-muted">{me.department}</p>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Your colour is fixed to your Employee ID — it is how your contribution shows up on every
          task you touch. Role: <b className="text-ink">{role}</b>.
        </p>
        <div className="border-t border-line pt-4">
          <Field label="Change your PIN" hint="4 to 6 digits">
            <input className="field font-mono tracking-[.4em]" inputMode="numeric" value={pin}
                   onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          {msg && <p className="mt-2 rounded-lg bg-ok/10 px-3 py-2 text-xs text-ok">{msg}</p>}
          <button className="btn-primary mt-3 w-full" disabled={pin.length < 4} onClick={save}>Change PIN</button>
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const { me, role, loading, logout } = useAuthed();
  const employees = useDb('employees', !!me);
  const [view, setView]     = useState('tasks');
  const [open, setOpen]     = useState(null);   // open task id
  const [form, setForm]     = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [prof, setProf]     = useState(false);
  const live = useDb(open ? `tasks/${open}` : null, !!open);

  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>;
  if (!me) return <Login />;

  const isAdmin = role === 'admin';

  return (
    <div className="min-h-dvh">
      <Header me={me} role={role} onLogout={logout} onProfile={() => setProf(true)} />

      <main className="mx-auto max-w-6xl px-4 py-5">
        {open && live ? (
          <TaskDetail task={{ ...live, id: open }} employees={employees}
                      isAdmin={isAdmin} onClose={() => setOpen(null)} />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              {(isAdmin || role === 'manager') && (
                <div className="inline-flex gap-1 rounded-xl bg-blue/[.07] p-1">
                  {(isAdmin
                    ? [['tasks', 'Tasks'], ['people', 'Employees'], ['templates', 'Templates']]
                    : [['tasks', 'Tasks'], ['templates', 'Templates']]
                  ).map(([v, l]) => (
                    <button key={v} className={`tab ${view === v ? 'tab-on' : ''}`} onClick={() => setView(v)}>{l}</button>
                  ))}
                </div>
              )}
              {view === 'tasks' && (
                <button className="btn-primary ml-auto text-xs" onClick={() => { setPrefill(null); setForm(true); }}>
                  {role === 'employee' ? '+ Add a task' : '+ Create and assign'}
                </button>
              )}
            </div>

            {view === 'people' && isAdmin
              ? <Employees employees={employees} />
              : view === 'templates' && (isAdmin || role === 'manager')
                ? <Templates onUse={(t) => { setPrefill(t); setView('tasks'); setForm(true); }} />
                : <Dashboard role={role} me={me} employees={employees} onOpen={(t) => setOpen(t.id)} />}
          </>
        )}
      </main>

      <TaskForm open={form} onClose={() => { setForm(false); setPrefill(null); }} employees={employees} me={me}
                role={role} prefill={prefill} onCreated={(id) => setOpen(id)} />
      <ProfileModal open={prof} onClose={() => setProf(false)} me={me} role={role} />

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-muted">
          KaaryaVidhan · C-DAC · Ministry of Electronics &amp; Information Technology
        </p>
      </footer>
    </div>
  );
}
