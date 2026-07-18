/**
 * Colour assignment.
 *
 * Two needs:
 *  - A stable per-person colour for avatars etc. (colorFor) — derived from the
 *    Employee ID so it is identical everywhere and survives re-import.
 *  - A GUARANTEED-UNIQUE colour within a single task's group (colorForInTask),
 *    so two people on the same Pace Bar can never share a hue. Collisions there
 *    make contributions impossible to tell apart.
 *
 * The palette is ordered so that ADJACENT entries are strongly contrasting
 * (hue jumps around the wheel), which keeps a small group visually distinct.
 */
export const PALETTE = [
  '#B91C1C', // red
  '#0369A1', // blue
  '#B45309', // amber/brown
  '#166534', // green
  '#7C3AED', // violet
  '#0E7490', // cyan
  '#9D174D', // magenta
  '#3F6212', // olive
  '#C2410C', // orange
  '#5B21B6', // deep purple
  '#0F766E', // teal
  '#A16207'  // gold
];

const hash = (s = '') => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Stable colour for a person, independent of any task. Used for avatars. */
export function colorFor(empId = '') {
  return PALETTE[hash(empId) % PALETTE.length];
}

/**
 * Unique, contrasting colour for a person WITHIN a specific task group.
 * Every member is given a distinct palette entry; if the group is larger than
 * the palette (rare), it wraps but still spreads people out. The mapping is
 * deterministic (members sorted by ID) so a person keeps the same colour as
 * long as the group is unchanged, and only shifts if the roster changes.
 *
 * @param {string} empId       the person to colour
 * @param {string[]} memberIds all member IDs on the task
 */
export function colorForInTask(empId, memberIds = []) {
  // Deterministic order so colours are stable across renders and devices.
  const ordered = [...new Set(memberIds)].sort();
  const idx = ordered.indexOf(empId);
  if (idx === -1) return colorFor(empId);        // not a member — fall back
  // Offset the starting point by a hash of the task's roster so different tasks
  // don't all start at red, but keep unique spacing within this task.
  const offset = hash(ordered.join(',')) % PALETTE.length;
  return PALETTE[(idx + offset) % PALETTE.length];
}

export function initialsOf(name = '') {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '??';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
