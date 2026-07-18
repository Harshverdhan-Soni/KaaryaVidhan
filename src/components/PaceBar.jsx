import { colorForInTask } from '../lib/colors';
import { contributions, statusOf } from '../lib/progress';

/**
 * THE PACE BAR.
 *
 * One track answers three questions at once:
 *   how far along  → the length of the fill
 *   who moved it   → the fill is cut into each person's colour by their share
 *                     of contributed progress, so a passenger shows as a sliver
 *   are we losing  → a hairline marks where the calendar says we should be;
 *                     if the fill sits behind it, the shortfall hatches red
 *
 * Nothing else in the interface needs to explain the state of a task.
 */
export default function PaceBar({ task, updates, employees, height = 14, showMarker = true, showLegend = false }) {
  const st = statusOf(task);
  const parts = contributions(updates, task);
  const memberIds = Object.keys(task.members || {});
  const actual = st.actual, expected = st.expected;
  const behind = actual < expected - 0.5 && st.key !== 'completed';

  return (
    <div className="space-y-2">
      <div className="relative w-full rounded-full bg-blue/[.09] overflow-hidden" style={{ height }}>
        {/* the shortfall: only drawn when the work is behind the calendar */}
        {behind && showMarker && (
          <div className="absolute inset-y-0 pace-gap"
               style={{ left: `${actual}%`, width: `${Math.min(expected, 100) - actual}%` }} />
        )}

        {/* the fill, cut by contributor */}
        <div className="absolute inset-y-0 left-0 flex" style={{ width: `${Math.min(actual, 100)}%` }}>
          {parts.length === 0 && actual > 0 && <div className="h-full w-full bg-blue-400" />}
          {parts.map((p, i) => (
            <div key={p.empId}
                 title={`${employees?.[p.empId]?.name || p.empId} — ${p.pctOfTask.toFixed(0)}% of this task`}
                 style={{
                   width: `${p.share * 100}%`,
                   background: colorForInTask(p.empId, memberIds),
                   // hairline between neighbours, so two warm colours never read as one block
                   boxShadow: i < parts.length - 1 ? 'inset -1px 0 0 rgba(255,255,255,.65)' : 'none'
                 }}
                 className="h-full first:rounded-l-full transition-[width] duration-500" />
          ))}
        </div>

        {/* where today says we should be */}
        {showMarker && expected > 0 && expected < 100 && st.key !== 'completed' && (
          // the halo keeps the marker readable whether it lands on bare track or
          // on top of a saturated contributor segment
          <div className="absolute inset-y-0 w-[2px] bg-ink"
               style={{ left: `${expected}%`, boxShadow: '0 0 0 1.5px rgba(255,255,255,.92)' }} />
        )}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs font-semibold" style={{ color: st.color }}>
          {actual.toFixed(0)}%
          {showMarker && st.key !== 'completed' && (
            <span className="ml-1.5 font-normal text-muted">of {expected.toFixed(0)}% expected today</span>
          )}
        </span>
        <span className="eyebrow" style={{ color: st.color }}>{st.label}</span>
      </div>

      {showLegend && parts.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
          {parts.map((p) => (
            <span key={p.empId} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <i className="h-2 w-2 rounded-full" style={{ background: colorForInTask(p.empId, memberIds) }} />
              {employees?.[p.empId]?.name?.split(' ')[0] || p.empId}
              <b className="font-mono font-medium text-ink">{Math.round(p.share * 100)}%</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
