/**
 * Every employee carries one colour for the life of their account.
 * It is derived from the Employee ID, so it is identical on every device,
 * survives a re-import, and never reshuffles. Twelve hues, all chosen to
 * stay legible as a solid fill against white and against C-DAC blue.
 */
export const PALETTE = [
  '#C2410C', '#0F766E', '#7C3AED', '#B91C1C', '#166534', '#A16207',
  '#0369A1', '#9D174D', '#3F6212', '#5B21B6', '#0E7490', '#92400E'
];

export function colorFor(empId = '') {
  let h = 0;
  for (let i = 0; i < empId.length; i++) h = (h * 31 + empId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialsOf(name = '') {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '??';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
