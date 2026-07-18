import PaceBar from './PaceBar';
import { Avatar, Chip } from './ui';
import { colorForInTask } from '../lib/colors';
import { statusOf, fmtDate, livePendingApprovals } from '../lib/progress';

export default function TaskCard({ task, updates, employees, onOpen, showOwner = false }) {
  const st = statusOf(task);
  const members = Object.entries(task.members || {});
  const pending = members.filter(([, m]) => m.state === 'pending').length;
  const denied  = members.filter(([, m]) => m.state === 'denied');
  const awaiting = livePendingApprovals(task).length;
  const acts    = Object.values(task.activities || {});
  const blocked = acts.filter((a) => a.blocked).length;

  return (
    <button onClick={onOpen}
      className="card w-full p-4 text-left transition hover:border-blue-400 hover:shadow-lg
                 focus-visible:border-blue-400 active:scale-[.995]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="eyebrow">{task.origin === 'self' ? 'Self assigned' : 'Assigned'}</span>
            {task.department && <span className="eyebrow text-blue">· {task.department}</span>}
          </div>
          <h3 className="mt-1 font-display font-semibold leading-snug truncate">{task.title}</h3>
        </div>
        {st.alert && <Chip color={st.color} solid>Attention</Chip>}
      </div>

      <div className="mt-3">
        <PaceBar task={task} updates={updates} employees={employees} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        <div className="flex -space-x-1.5">
          {members.slice(0, 5).map(([id]) => <Avatar key={id} emp={employees?.[id]} size={22} ring color={colorForInTask(id, members.map(([mid]) => mid))} />)}
          {members.length > 5 && (
            <span className="inline-flex h-[22px] items-center rounded-full bg-sky px-1.5 font-mono text-[10px] text-muted">
              +{members.length - 5}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted">
          {acts.length} {acts.length === 1 ? 'activity' : 'activities'}
        </span>
        <span className="font-mono text-[11px] text-muted">
          Due {fmtDate(task.deadline)}
          {st.left >= 0 && st.key !== 'completed' && ` · ${st.left}d left`}
        </span>
        {showOwner && employees?.[task.createdBy] && (
          <span className="font-mono text-[11px] text-muted">By {employees[task.createdBy].name}</span>
        )}
        <span className="ml-auto flex gap-1.5">
          {awaiting > 0 && <Chip color="#0B4E8C">{awaiting} awaiting approval</Chip>}
          {pending > 0 && <Chip color="#5A7391">{pending} not answered</Chip>}
          {denied.length > 0 && <Chip color="#E8801A">{denied.length} declined</Chip>}
          {blocked > 0 && <Chip color="#D93025">{blocked} blocked</Chip>}
        </span>
      </div>
    </button>
  );
}
