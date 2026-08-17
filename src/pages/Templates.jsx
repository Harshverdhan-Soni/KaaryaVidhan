import { useState, useMemo, useRef, useEffect } from 'react';
import { useAuthed } from '../lib/auth';
import { useDb } from '../lib/useDb';
import { Modal, Field, Empty, AsyncButton, Chip, ViewToggle, Pager } from '../components/ui';
import { saveTemplate, deleteTemplate, createGroup } from '../lib/db';
import { parseTemplateWorkbook, downloadTemplateWorkbook } from '../lib/excel';
import { visibleGroups } from '../lib/progress';

/**
 * Private, per-user library of reusable task shapes: a name, an optional
 * description and a list of activities. Picking one opens the normal
 * create-and-assign form pre-filled, leaving department/deadline/people blank.
 */
export default function Templates({ onUse, layout = 'cards', onLayout }) {
  const { me, role } = useAuthed();
  const raw = useDb(`templates/${me.empId}`);
  const groupsRaw = useDb('groups');
  const visGroups = useMemo(() => visibleGroups(groupsRaw, me, role), [groupsRaw, me, role]);
  const groupNames = useMemo(() => [...new Set(visGroups.map((g) => g.name))], [visGroups]);
  const [q, setQ]         = useState('');
  const [fType, setFType] = useState('all');   // all | functional | project
  const [fName, setFName] = useState('all');   // all | __none__ | <group name>
  const [builder, setBuilder] = useState(null); // { mode:'new'|'edit'|'copy', template } | null
  const [imp, setImp]     = useState(false);
  const [page, setPage]   = useState(0);
  const pageSize = layout === 'list' ? 20 : 12;

  const all = useMemo(() => Object.values(raw || {}), [raw]);
  // Group names actually used across this person's templates, for the filter.
  const usedGroupNames = useMemo(
    () => [...new Set(all.map((t) => t.groupName).filter(Boolean))].sort(), [all]);

  const list = useMemo(() => all
    .filter((t) => fType === 'all' || t.groupKind === fType)
    .filter((t) => fName === 'all' || (fName === '__none__' ? !t.groupName : t.groupName === fName))
    .filter((t) => !q || `${t.title} ${t.description || ''} ${t.groupName || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt),
    [all, q, fType, fName]);

  useEffect(() => { setPage(0); }, [q, fType, fName, layout]);
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = list.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder="Search name, description or group" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field !w-auto !py-2 text-xs" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="all">All types</option>
          <option value="functional">Functional area</option>
          <option value="project">Project</option>
        </select>
        <select className="field !w-auto !py-2 text-xs" value={fName} onChange={(e) => setFName(e.target.value)}>
          <option value="all">All groups</option>
          <option value="__none__">No group</option>
          {usedGroupNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <ViewToggle value={layout} onChange={onLayout} />
          <button className="btn-ghost text-xs" onClick={() => setImp(true)}>Import from Excel</button>
          <button className="btn-primary text-xs" onClick={() => setBuilder({ mode: 'new', template: null })}>+ New template</button>
        </span>
      </div>

      <p className="font-mono text-[11px] text-muted">
        {list.length} of {all.length} {all.length === 1 ? 'template' : 'templates'} · only you can see these
      </p>

      {all.length === 0 ? (
        <Empty title="No templates yet. Build one, or import a set from Excel, to reuse a task's activities without retyping them."
               action={<div className="flex justify-center gap-2">
                 <button className="btn-ghost text-xs" onClick={() => setImp(true)}>Import from Excel</button>
                 <button className="btn-primary text-xs" onClick={() => setBuilder({ mode: 'new', template: null })}>+ New template</button>
               </div>} />
      ) : list.length === 0 ? (
        <Empty title="No templates match these filters."
               action={<button className="btn-ghost text-xs"
                        onClick={() => { setQ(''); setFType('all'); setFName('all'); }}>Clear filters</button>} />
      ) : layout === 'list' ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="border-b border-line bg-sky/60">
                <tr>
                  {['Template', 'Group', 'Activities', ''].map((c, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-muted">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageItems.map((t) => (
                  <tr key={t.id} className="align-top hover:bg-sky/40">
                    <td className="px-3 py-2.5">
                      <p className="max-w-[16rem] truncate font-medium">{t.title}</p>
                      {t.description && <p className="max-w-[18rem] truncate text-[11px] text-muted">{t.description}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.groupName ? <Chip color="#0B4E8C">{t.groupName}{t.groupKind === 'project' ? ' · Project' : ''}</Chip> : <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-muted">{t.activities.length}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2.5 whitespace-nowrap text-[11px]">
                        <button className="btn-primary !px-2.5 !py-1 text-[11px]" onClick={() => onUse(t)}>Use</button>
                        <button className="text-muted hover:text-blue" onClick={() => setBuilder({ mode: 'edit', template: t })}>Edit</button>
                        <button className="text-muted hover:text-blue" onClick={() => setBuilder({ mode: 'copy', template: t })}>Copy</button>
                        <button className="text-muted hover:text-bad"
                                onClick={() => { if (confirm(`Delete template "${t.title}"?`)) deleteTemplate(me.empId, t.id); }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={safePage} total={list.length} pageSize={pageSize} onPage={setPage} />
        </>
      ) : (
        <>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {pageItems.map((t) => (
            <div key={t.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display font-semibold leading-snug">{t.title}</h3>
                <span className="flex shrink-0 gap-2 text-[11px]">
                  <button className="text-muted hover:text-blue" onClick={() => setBuilder({ mode: 'edit', template: t })}>Edit</button>
                  <button className="text-muted hover:text-blue" onClick={() => setBuilder({ mode: 'copy', template: t })}>Copy</button>
                  <button className="text-muted hover:text-bad"
                          onClick={() => { if (confirm(`Delete template "${t.title}"?`)) deleteTemplate(me.empId, t.id); }}>Delete</button>
                </span>
              </div>
              {t.description && <p className="mt-1 text-xs leading-relaxed text-muted line-clamp-2">{t.description}</p>}
              {t.groupName && (
                <span className="mt-2"><Chip color="#0B4E8C">{t.groupName}{t.groupKind === 'project' ? ' · Project' : ''}</Chip></span>
              )}
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
        <Pager page={safePage} total={list.length} pageSize={pageSize} onPage={setPage} />
        </>
      )}

      <BuildModal open={!!builder} onClose={() => setBuilder(null)} me={me} groupNames={groupNames}
                  mode={builder?.mode || 'new'} template={builder?.template || null} />
      <ImportModal open={imp} onClose={() => setImp(false)} me={me} role={role} groups={visGroups} />
    </div>
  );
}

/* ------------------------------ build in-app ------------------------------ */

function BuildModal({ open, onClose, me, groupNames = [], mode = 'new', template = null }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc]   = useState('');
  const [acts, setActs]   = useState(['']);
  const [gName, setGName] = useState('');
  const [gKind, setGKind] = useState('functional');
  const [busy, setBusy]   = useState(false);

  // Seed the fields each time the modal opens. Copy pre-fills "(copy)" onto the
  // name so the person is nudged to rename it; edit keeps the name as-is.
  useEffect(() => {
    if (!open) return;
    const s = template || {};
    setTitle(mode === 'copy' ? `${s.title || ''} (copy)` : (s.title || ''));
    setDesc(s.description || '');
    setActs(s.activities?.length ? [...s.activities] : ['']);
    setGName(s.groupName || '');
    setGKind(s.groupKind === 'project' ? 'project' : 'functional');
    setBusy(false);
  }, [open, template, mode]);

  const clean = acts.map((a) => a.trim()).filter(Boolean);
  const valid = title.trim() && clean.length;

  const save = async () => {
    setBusy(true);
    const payload = { title, description: desc, activities: clean, groupName: gName, groupKind: gKind };
    if (mode === 'edit' && template) {
      await saveTemplate(me.empId, { ...payload, createdAt: template.createdAt }, template.id);
    } else {
      await saveTemplate(me.empId, payload);   // new, or copy → fresh id
    }
    setBusy(false);
    onClose();
  };

  const heading = mode === 'edit' ? 'Edit template' : mode === 'copy' ? 'Copy template' : 'New task template';
  const cta = mode === 'edit' ? 'Save changes' : mode === 'copy' ? 'Save as new template'
            : `Save template with ${clean.length} ${clean.length === 1 ? 'activity' : 'activities'}`;

  return (
    <Modal open={open} onClose={onClose} wide title={heading}>
      <div className="space-y-4">
        <Field label="Task name" hint={mode === 'copy' ? 'Give the copy its own name.' : undefined}>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Onboard a new hire" />
        </Field>
        <Field label="Description" hint="Optional.">
          <textarea className="field" rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Group type">
            <select className="field" value={gKind} onChange={(e) => setGKind(e.target.value)}>
              <option value="functional">Functional area</option>
              <option value="project">Project</option>
            </select>
          </Field>
          <Field label="Group name" hint="Optional. Applied when this template is used.">
            <input className="field" list="tpl-group-names" value={gName}
                   onChange={(e) => setGName(e.target.value)} placeholder="e.g. Software or WAMIS" />
            <datalist id="tpl-group-names">{groupNames.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
        </div>
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
          {busy ? 'Saving…' : cta}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ import Excel ------------------------------ */

function ImportModal({ open, onClose, me, role, groups = [] }) {
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
    // Auto-create any groups named in the sheet that don't already exist, so an
    // Excel import needs no manual "Create" step. Deduped by name + kind against
    // the groups this person can already see (admins/managers only reach here).
    if (role === 'admin' || role === 'manager') {
      const wanted = new Map();
      for (const t of res.rows) {
        const name = (t.groupName || '').trim();
        if (!name) continue;
        const kind = t.groupKind === 'project' ? 'project' : 'functional';
        wanted.set(`${name.toLowerCase()}|${kind}`, { name, kind });
      }
      for (const g of wanted.values()) {
        const exists = groups.some((x) =>
          (x.name || '').trim().toLowerCase() === g.name.toLowerCase() && (x.kind || 'functional') === g.kind);
        if (!exists) { try { await createGroup(g, me, role); } catch (e) { console.warn('group auto-create failed', e); } }
      }
    }
    for (const t of res.rows) await saveTemplate(me.empId, t);
    setOut(res.rows.length); setStage('done');
  };

  return (
    <Modal open={open} onClose={close} wide title="Import task templates">
      {stage === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Upload a workbook of templates. One row per template, with a Task Name, an optional
            Description, an optional Group Type (Functional or Project) and Group Name, and activities —
            either in a single Activities cell (separated by <b>|</b> or <b> ;</b>) or across columns
            named Activity 1, Activity 2, and so on. Any Group Name that doesn't exist yet is created
            automatically on import.
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
                    <p className="text-xs font-medium">
                      {t.title}
                      {t.groupName && <span className="ml-1.5 font-normal text-blue">· {t.groupName}{t.groupKind === 'project' ? ' (Project)' : ''}</span>}
                    </p>
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
