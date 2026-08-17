import PaceBar from './PaceBar';
import { Chip } from './ui';
import { statusOf, fmtDate, livePendingApprovals } from '../lib/progress';

/**
 * List (row) view of tasks — the tabular alternative to the card grid. The
 * Progress column reuses the Pace Bar, so it tells exactly the same story as a
 * card, just denser. A whole row is clickable to open the task.
 */
export default function TaskTable({ tasks, updates, employees, groupsRaw, showOwner = false, onOpen }) {
  const cols = ['Task', 'Progress', 'Due', ...(showOwner ? ['By'] : [])];
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-line bg-sky/60">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-muted">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => {
            const st = statusOf(t);
            const g = groupsRaw?.[t.groupId];
            const acts = Object.keys(t.activities || {}).length;
            const awaiting = livePendingApprovals(t).length;
            return (
              <tr key={t.id} onClick={() => onOpen(t)} className="cursor-pointer align-top hover:bg-sky/40">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="max-w-[15rem] truncate font-medium">{t.title}</p>
                    {g && <Chip color="#0B4E8C">{g.name}</Chip>}
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">
                    {acts} {acts === 1 ? 'activity' : 'activities'}
                    {awaiting > 0 && ` · ${awaiting} awaiting approval`}
                  </p>
                </td>
                <td className="w-[42%] min-w-[12rem] px-3 py-2.5">
                  <PaceBar task={t} updates={updates?.[t.id]} employees={employees} height={10} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-muted">
                  {fmtDate(t.deadline)}
                  {st.key !== 'completed' && st.left >= 0 ? ` · ${st.left}d` : ''}
                </td>
                {showOwner && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-muted">
                    {employees?.[t.createdBy]?.name || t.createdBy}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
