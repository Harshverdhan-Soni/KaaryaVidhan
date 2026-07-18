import { useEffect, useState } from 'react';
import { colorFor, initialsOf } from '../lib/colors';

export function Avatar({ emp, size = 28, ring = false, color }) {
  const c = color || colorFor(emp?.empId || '');
  return (
    <span
      title={`${emp?.name || 'Unknown'} · ${emp?.empId || ''}`}
      style={{ background: c, width: size, height: size, boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 3.5px ${c}` : 'none' }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold text-white"
    >
      <span style={{ fontSize: size * 0.36 }}>{initialsOf(emp?.name)}</span>
    </span>
  );
}

export function Chip({ color = '#5A7391', children, solid = false }) {
  return (
    <span className="chip" style={solid
      ? { background: color, color: '#fff' }
      : { background: `${color}18`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}>
      {children}
    </span>
  );
}

export function Empty({ title, action }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm text-muted">{title}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto
                       rounded-b-none sm:rounded-b-xl`}>
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-white/95
                        backdrop-blur px-5 py-3.5 rounded-t-xl">
          <h3 className="font-display font-semibold">{title}</h3>
          <button className="text-muted hover:text-ink text-xl leading-none" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

/**
 * The guard on anything destructive. The user must type an exact phrase AND
 * re-enter their PIN; the PIN is checked server-side by the calling function,
 * so an unlocked session left open cannot be used to wipe data. onConfirm
 * receives the typed pin and should call the relevant Cloud Function.
 */
export function DangerConfirm({ open, onClose, title, body, phrase, confirmLabel, onConfirm }) {
  const [typed, setTyped] = useState('');
  const [pin, setPin]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  useEffect(() => { if (open) { setTyped(''); setPin(''); setErr(''); setBusy(false); } }, [open]);

  const ready = typed.trim() === phrase && pin.length >= 4;
  const run = async () => {
    setBusy(true); setErr('');
    try { await onConfirm(pin); onClose(); }
    catch (e) {
      const m = e?.message || '';
      setErr(/pin/i.test(m) ? 'That PIN is not correct.'
           : /last admin/i.test(m) ? m
           : /own account/i.test(m) ? m
           : 'Could not complete that action.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="rounded-lg bg-bad/10 px-3 py-2.5 text-xs leading-relaxed text-bad">{body}</div>
        <label className="block space-y-1.5">
          <span className="eyebrow">Type <b className="font-mono text-bad">{phrase}</b> to confirm</span>
          <input className="field font-mono" value={typed} autoFocus
                 onChange={(e) => setTyped(e.target.value)} placeholder={phrase} />
        </label>
        <label className="block space-y-1.5">
          <span className="eyebrow">Re-enter your PIN</span>
          <input className="field font-mono tracking-[.4em]" type="password" inputMode="numeric" value={pin}
                 onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </label>
        {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}
        <button className="btn-danger w-full" disabled={!ready || busy} onClick={run}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * For actions that must fetch code before they can run — the spreadsheet
 * exports. Without this the button looks broken for the second SheetJS takes
 * to arrive on a slow connection.
 */
export function AsyncButton({ onClick, busyLabel = 'Preparing…', children, ...rest }) {
  const [busy, setBusy] = useState(false);
  return (
    <button {...rest} disabled={busy || rest.disabled}
      onClick={async () => {
        setBusy(true);
        try { await onClick(); } finally { setBusy(false); }
      }}>
      {busy ? busyLabel : children}
    </button>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-blue/[.07] p-1">
      {options.map(([v, label, count]) => (
        <button key={v} className={`tab ${value === v ? 'tab-on' : ''}`} onClick={() => onChange(v)}>
          {label}
          {count > 0 && <span className="ml-1.5 font-mono text-[10px] text-muted">{count}</span>}
        </button>
      ))}
    </div>
  );
}
