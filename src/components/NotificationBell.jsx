import { useState, useEffect, useRef } from 'react';
import { useDb } from '../lib/useDb';
import { markRead, markAllRead, clearAll, registerPush } from '../lib/notify';
import { fmtDateTime } from '../lib/progress';

const TYPE_COLOUR = {
  assigned:  '#0B4E8C',
  approval:  '#E8801A',
  validate:  '#0B4E8C',
  accepted:  '#1F8A4C',
  completed: '#1F8A4C',
  rejected:  '#D93025',
  reassigned:'#E8801A'
};

/**
 * The bell. Reads /notifications/{me} live, shows an unread count, and lets the
 * person jump straight to the task a notice is about. Push registration is
 * offered here too, because this is where someone thinks about being notified.
 */
export default function NotificationBell({ me, onOpenTask }) {
  const raw = useDb(`notifications/${me.empId}`);
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState('');
  const boxRef = useRef();

  const list = Object.values(raw || {}).sort((a, b) => b.at - a.at);
  const unread = list.filter((n) => !n.read).length;

  // Close when clicking away.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const enablePush = async () => {
    setPushState('working');
    setPushState(await registerPush(me.empId));
  };

  return (
    <div className="relative" ref={boxRef}>
      <button className="relative grid h-9 w-9 place-items-center rounded-lg hover:bg-sky"
              onClick={() => setOpen((v) => !v)} aria-label="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A2540" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 font-mono text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* On a narrow screen the panel is anchored to the viewport, not to the
              bell — anchoring to the bell pushes it off the left edge and it gets
              clipped. A dim backdrop makes it read as a sheet on mobile. */}
          <div className="fixed inset-0 z-40 bg-ink/20 sm:hidden" onClick={() => setOpen(false)} />
          <div className="fixed left-3 right-3 top-[4.25rem] z-50 max-h-[75vh] overflow-hidden rounded-xl border border-line bg-white shadow-xl
                          sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[22rem]">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {list.length > 0 && (
              <div className="flex gap-2">
                {unread > 0 && (
                  <button className="text-[11px] font-medium text-blue hover:underline"
                          onClick={() => markAllRead(me.empId)}>Mark all read</button>
                )}
                <button className="text-[11px] text-muted hover:text-bad"
                        onClick={() => clearAll(me.empId)}>Clear</button>
              </div>
            )}
          </div>

          <div className="max-h-[calc(75vh-7rem)] overflow-y-auto sm:max-h-80">
            {list.length === 0 && (
              <p className="px-3.5 py-8 text-center text-xs text-muted">
                Nothing yet. You'll be told when a task needs you.
              </p>
            )}
            {list.map((n) => (
              <button key={n.id}
                      className={`block w-full border-b border-line px-3.5 py-2.5 text-left last:border-0 hover:bg-sky ${n.read ? '' : 'bg-blue/[.03]'}`}
                      onClick={() => {
                        markRead(me.empId, n.id);
                        if (n.taskId && onOpenTask) { onOpenTask(n.taskId); setOpen(false); }
                      }}>
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: n.read ? '#D6E3F0' : (TYPE_COLOUR[n.type] || '#0B4E8C') }} />
                  <div className="min-w-0">
                    <p className={`text-xs leading-snug ${n.read ? 'text-muted' : 'font-medium text-ink'}`}>{n.title}</p>
                    {n.body && <p className="mt-0.5 text-[11px] leading-snug text-muted">{n.body}</p>}
                    <p className="mt-0.5 font-mono text-[10px] text-muted">{fmtDateTime(n.at)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-line px-3.5 py-2.5">
            {pushState === 'enabled' ? (
              <p className="text-[11px] text-ok">✓ Push notifications are on for this device.</p>
            ) : pushState === 'denied' ? (
              <p className="text-[11px] text-muted">Push was blocked. Allow notifications in your browser settings to turn it on.</p>
            ) : pushState === 'not-configured' ? (
              <p className="text-[11px] text-muted">Push is not set up for this installation yet.</p>
            ) : pushState === 'unsupported' ? (
              <p className="text-[11px] text-muted">This browser can't do push notifications.</p>
            ) : (
              <button className="text-[11px] font-medium text-blue hover:underline"
                      disabled={pushState === 'working'} onClick={enablePush}>
                {pushState === 'working' ? 'Enabling…' : 'Notify me on this device'}
              </button>
            )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
