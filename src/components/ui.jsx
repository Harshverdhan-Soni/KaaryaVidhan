import { useEffect, useState } from 'react';
import { colorFor, initialsOf } from '../lib/colors';

/** Light / dark toggle. Persists the choice and flips the .dark class live. */
export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('kv-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', next ? '#0D1421' : '#0B4E8C');
  };
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Light theme' : 'Dark theme'}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-sky">
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

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
  if (solid) return <span className="chip" style={{ background: color, color: '#fff' }}>{children}</span>;
  // Soft chip: colours are mixed in CSS (see .chip-soft) so dark-ish hues like
  // the group blue stay legible on the dark theme.
  return <span className="chip chip-soft" style={{ '--chip-c': color }}>{children}</span>;
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto
                       rounded-b-none sm:rounded-b-xl`}>
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-surface/95
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

/** Compact Cards / List switch for a collection view. */
export function ViewToggle({ value, onChange }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-blue/[.07] p-1">
      {[['cards', 'Cards'], ['list', 'List']].map(([v, l]) => (
        <button key={v} type="button" className={`tab ${value === v ? 'tab-on' : ''}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

/**
 * Pagination control. Renders nothing when everything fits on one page.
 * `page` is zero-based; `onPage` receives the new zero-based page.
 */
export function Pager({ page, total, pageSize, onPage }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="font-mono text-[11px] text-muted">{from}–{to} of {total}</p>
      <div className="flex items-center gap-1.5">
        <button className="btn-ghost !px-2.5 text-xs" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span className="font-mono text-[11px] text-muted">{page + 1} / {pageCount}</span>
        <button className="btn-ghost !px-2.5 text-xs" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
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
