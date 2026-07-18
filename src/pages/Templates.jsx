import { useState, useMemo, useRef } from 'react';
import { useAuthed } from '../lib/auth';
import { useDb } from '../lib/useDb';
import { Modal, Field, Empty, AsyncButton } from '../components/ui';
import { saveTemplate, deleteTemplate } from '../lib/db';
import { parseTemplateWorkbook, downloadTemplateWorkbook } from '../lib/excel';

/**
 * Private, per-user library of reusable task shapes: a name, an optional
 * description and a list of activities. Picking one opens the normal
 * create-and-assign form pre-filled, leaving department/deadline/people blank.
 */
export default function Templates({ onUse }) {
  const { me } = useAuthed();
  const raw = useDb(`templates/${me.empId}`);
  const [q, setQ]         = useState('');
  const [build, setBuild] = useState(false);
  const [imp, setImp]     = useState(false);

  const list = useMemo(() => Object.values(raw || {})
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q.toLowerCase())),
    [raw, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder="Search your templates" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => setImp(true)}>Import from Excel</button>
          <button className="btn-primary text-xs" onClick={() => setBuild(true)}>+ New template</button>
        </span>
      </div>

      <p className="font-mono text-[11px] text-muted">
        {list.length} {list.length === 1 ? 'template' : 'templates'} · only you can see these
      </p>

      {list.length === 0 ? (
        <Empty title="No templates yet. Build one, or import a set from Excel, to reuse a task's activities without retyping them."
               action={<div className="flex justify-center gap-2">
                 <button className="btn-ghost text-xs" onClick={() => setImp(true)}>Import from Excel</button>
                 <button className="btn-primary text-xs" onClick={() => setBuild(true)}>+ New template</button>
               </div>} />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((t) => (
            <div key={t.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display font-semibold leading-snug">{t.title}</h3>
                <button className="text-[11px] text-muted hover:text-bad shrink-0"
                        onClick={() => { if (confirm(`Delete template "${t.title}"?`)) deleteTemplate(me.empId, t.id); }}>
                  Delete
                </button>
              </div>
              {t.description && <p className="mt-1 text-xs leading-relaxed text-muted line-clamp-2">{t.description}</p>}
              <p className="eyebrow mt-3">{t.activities.length} {t.activities.length === 1 ? 'activity' : 'activities'}</p>
              <ul className="mt-1 space-y-0.5">
                {t.activities.slice(0, 4).map((a, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="h-1 w-1 rounded-full bg-blue-400" /> <span className="truncate">{a}</span>
                  </li>
                ))}
                {t.activities.length > 4 && <li className="text-[11px] text-muted">+{t.activities.length - 4} more</li>}
              </ul>
              <button className="btn-primary mt-4 text-xs" onClick={() => onUse(t)}>Use this template</button>
            </div>
          ))}
        </div>
      )}

      <BuildModal open={build} onClose={() => setBuild(false)} me={me} />
      <ImportModal open={imp} onClose={() => setImp(false)} me={me} />
    </div>
  );
}

/* ------------------------------ build in-app ------------------------------ */

function BuildModal({ open, onClose, me }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc]   = useState('');
  const [acts, setActs]   = useState(['']);
  const [busy, setBusy]   = useState(false);

  const clean = acts.map((a) => a.trim()).filter(Boolean);
  const valid = title.trim() && clean.length;

  const save = async () => {
    setBusy(true);
    await saveTemplate(me.empId, { title, description: desc, activities: clean });
    setBusy(false);
    setTitle(''); setDesc(''); setActs(['']); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} wide title="New task template">
      <div className="space-y-4">
        <Field label="Task name">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Onboard a new hire" />
        </Field>
        <Field label="Description" hint="Optional.">
          <textarea className="field" rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <div>
          <p className="eyebrow mb-1.5">Activities</p>
          <div className="space-y-2">
            {acts.map((a, i) => (
              <div key={i} className="flex gap-2">
                <span className="grid w-7 shrink-0 place-items-center font-mono text-[11px] text-muted">{i + 1}</span>
                <input className="field" value={a} placeholder="Create accounts"
                       onChange={(e) => setActs(acts.map((x, j) => (j === i ? e.target.value : x)))}
                       onKeyDown={(e) => { if (e.key === 'Enter' && a.trim() && i === acts.length - 1) setActs([...acts, '']); }} />
                <button className="btn-ghost !px-2.5 text-xs" disabled={acts.length === 1}
                        onClick={() => setActs(acts.filter((_, j) => j !== i))} aria-label="Remove">×</button>
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 text-xs" onClick={() => setActs([...acts, ''])}>+ Add activity</button>
        </div>
        <button className="btn-primary w-full" disabled={!valid || busy} onClick={save}>
          {busy ? 'Saving…' : `Save template with ${clean.length} ${clean.length === 1 ? 'activity' : 'activities'}`}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ import Excel ------------------------------ */

function ImportModal({ open, onClose, me }) {
  const [stage, setStage] = useState('pick');   // pick → review → done
  const [res, setRes]     = useState(null);
  const [out, setOut]     = useState(0);
  const [err, setErr]     = useState('');
  const fileRef = useRef();

  const reset = () => { setStage('pick'); setRes(null); setOut(0); setErr(''); };
  const close = () => { reset(); onClose(); };

  const pick = async (file) => {
    if (!file) return;
    setErr('');
    try { const parsed = await parseTemplateWorkbook(file); setRes(parsed); setStage('review'); }
    catch { setErr('That file could not be read. Save it as .xlsx or .csv and try again.'); }
  };

  const commit = async () => {
    setStage('working');
    for (const t of res.rows) await saveTemplate(me.empId, t);
    setOut(res.rows.length); setStage('done');
  };

  return (
    <Modal open={open} onClose={close} wide title="Import task templates">
      {stage === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Upload a workbook of templates. One row per template, with a Task Name, an optional
            Description, and activities — either in a single Activities cell (separated by <b>|</b> or
            <b> ;</b>) or across columns named Activity 1, Activity 2, and so on.
          </p>
          <div className="rounded-xl border-2 border-dashed border-line p-8 text-center">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                   onChange={(e) => pick(e.target.files[0])} />
            <button className="btn-primary" onClick={() => fileRef.current.click()}>Choose file</button>
            <p className="mt-2 text-[11px] text-muted">.xlsx, .xls or .csv · first sheet is read</p>
          </div>
          {err && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}
          <AsyncButton className="text-xs font-medium text-blue hover:text-ink" onClick={downloadTemplateWorkbook}>
            Download a template file with the right columns
          </AsyncButton>
        </div>
      )}

      {stage === 'review' && res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['Ready to import', res.rows.length, '#1F8A4C'],
              ['Rows skipped', res.errors.length, res.errors.length ? '#D93025' : '#5A7391']].map(([k, v, c]) => (
                <div key={k} className="card p-3">
                  <p className="font-mono text-2xl font-semibold" style={{ color: c }}>{v}</p>
                  <p className="eyebrow mt-0.5">{k}</p>
                </div>
              ))}
          </div>
          {res.errors.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Rows that will not be imported</p>
              <div className="max-h-36 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {res.errors.map((e, i) => (
                  <p key={i} className="px-3 py-1.5 text-[11px]"><span className="font-mono text-muted">Row {e.row}</span> — {e.problem}</p>
                ))}
              </div>
            </div>
          )}
          {res.rows.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Preview — first 5</p>
              <div className="space-y-1.5">
                {res.rows.slice(0, 5).map((t, i) => (
                  <div key={i} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-xs font-medium">{t.title}</p>
                    <p className="font-mono text-[10px] text-muted">{t.activities.length} activities · {t.activities.slice(0, 3).join(' · ')}{t.activities.length > 3 ? '…' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 text-xs" onClick={reset}>Choose a different file</button>
            <button className="btn-primary flex-[2]" disabled={!res.rows.length} onClick={commit}>
              Import {res.rows.length} templates
            </button>
          </div>
        </div>
      )}

      {stage === 'working' && <p className="py-8 text-center text-sm text-muted">Saving templates…</p>}

      {stage === 'done' && (
        <div className="space-y-4">
          <p className="text-sm"><b>{out}</b> {out === 1 ? 'template' : 'templates'} imported.</p>
          <button className="btn-primary w-full" onClick={close}>Done</button>
        </div>
      )}
    </Modal>
  );
}
