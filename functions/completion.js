/**
 * Pure helpers for recording an already-completed ("backdated") task. No
 * firebase imports, so they can be unit-tested directly with node.
 *
 * The Pace Bar renders each contributor's colour and share purely from the
 * /updates ledger, so a completed task must ship with a synthesised ledger:
 * for every activity, its contributors are laid end-to-end across the 0→100
 * range and each person's `delta` is their share of that activity's 100%.
 */

/** Round to 2 dp to tame floating-point drift in percentage maths. */
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Validate the activities + per-activity contribution payload.
 * @param activities [{ title, contribs: [{ empId, pct }] }]
 * @param validIds   Set (or array) of employee ids that actually exist
 * @returns { ok:true } | { ok:false, error }
 *
 * Rules: at least one activity; every activity has a title and at least one
 * contributor; every contributor is a known employee with pct>0; and each
 * activity's percentages sum to 100 (±0.5 tolerance for rounding).
 */
export function validateCompleted(activities, validIds) {
  if (!Array.isArray(activities) || activities.length === 0)
    return { ok: false, error: 'Add at least one activity.' };
  const ids = validIds instanceof Set ? validIds : new Set(validIds || []);

  for (let i = 0; i < activities.length; i++) {
    const a = activities[i] || {};
    const title = String(a.title || '').trim();
    if (!title) return { ok: false, error: `Activity ${i + 1} has no title.` };

    const contribs = Array.isArray(a.contribs) ? a.contribs : [];
    if (contribs.length === 0) return { ok: false, error: `"${title}" has no contributors.` };

    let sum = 0;
    const seen = new Set();
    for (const c of contribs) {
      const empId = String(c?.empId || '').trim();
      const pct = Number(c?.pct);
      if (!empId) return { ok: false, error: `"${title}" has a contributor with no name.` };
      if (seen.has(empId)) return { ok: false, error: `"${title}" lists ${empId} twice.` };
      seen.add(empId);
      if (ids.size && !ids.has(empId)) return { ok: false, error: `"${title}" names an unknown contributor (${empId}).` };
      if (!(pct > 0)) return { ok: false, error: `"${title}": ${empId} needs a percentage above 0.` };
      sum += pct;
    }
    if (Math.abs(sum - 100) > 0.5)
      return { ok: false, error: `"${title}" percentages add up to ${r2(sum)}%, not 100%.` };
  }
  return { ok: true };
}

/**
 * Build the /updates ledger rows for a completed task. `actIds[i]` is the id
 * assigned to activities[i]. Each row is { actId, empId, from, to, delta, at }.
 */
export function buildLedger(activities, actIds, at) {
  const rows = [];
  activities.forEach((a, i) => {
    const actId = actIds[i];
    let cursor = 0;
    for (const c of (a.contribs || [])) {
      const pct = Number(c.pct) || 0;
      const empId = String(c.empId || '').trim();
      if (!empId || pct <= 0) continue;
      const from = r2(cursor);
      const to = r2(Math.min(100, cursor + pct));
      if (to <= from) continue;
      rows.push({ actId, empId, from, to, delta: r2(to - from), at });
      cursor = to;
    }
  });
  return rows;
}
