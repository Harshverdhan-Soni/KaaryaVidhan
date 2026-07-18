import { useState } from 'react';
import { useAuthed } from '../lib/auth';
import { LogoMark } from '../components/Logo';

export default function Login() {
  const { login } = useAuthed();
  const [empId, setEmpId] = useState('');
  const [pin, setPin]     = useState('');
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try { await login(empId, pin); }
    catch (e) {
      const m = e?.message || '';
      setErr(/not-found|no employee/i.test(m) ? 'No account with that Employee ID.'
           : /pin|permission|unauthenticated/i.test(m) ? 'That PIN does not match.'
           : 'Could not sign in. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 w-fit">
            <LogoMark size={56} />
          </div>
          <h1 className="font-display text-[26px] font-bold tracking-tight sm:text-3xl">KaaryaVidhan</h1>
          <p className="mt-1 text-sm text-muted">Employees Task Tracker</p>
        </div>

        <div className="card space-y-4 p-6">
          <label className="block space-y-1.5">
            <span className="eyebrow">Employee ID</span>
            <input className="field font-mono uppercase" placeholder="CDAC001" value={empId} autoFocus
                   onChange={(e) => setEmpId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          <label className="block space-y-1.5">
            <span className="eyebrow">PIN</span>
            <input className="field font-mono tracking-[.4em]" type="password" inputMode="numeric"
                   placeholder="••••" value={pin}
                   onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                   onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>

          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}

          <button className="btn-primary w-full" disabled={!empId || pin.length < 4 || busy} onClick={submit}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-muted">
            Accounts are created by your administrator. If your ID is not recognised,
            ask them to add you from the employee list.
          </p>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[.14em] text-muted">
          C-DAC · Ministry of Electronics &amp; IT
        </p>
      </div>
    </div>
  );
}
