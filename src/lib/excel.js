/**
 * SheetJS is ~700 kB and only three screens ever touch it — the admin's import,
 * and the two export buttons. It is loaded the moment one of those is used and
 * not a moment before, so an employee opening the app on a phone never pays for
 * a spreadsheet library they will never open.
 */
const sheetjs = () => import('xlsx');

/** Header aliases — real spreadsheets never use the exact name you asked for. */
const FIELDS = {
  empId:       ['employee id', 'emp id', 'empid', 'id', 'employee code', 'staff id'],
  name:        ['employee name', 'name', 'full name', 'employee'],
  designation: ['designation', 'title', 'post', 'grade'],
  department:  ['department', 'dept', 'group', 'division'],
  reportingTo: ['reporting authority name', 'reporting authority', 'reporting to', 'manager', 'supervisor', 'reports to']
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_./-]+/g, ' ');

function mapHeaders(row) {
  const map = {};
  for (const key of Object.keys(row)) {
    const n = norm(key);
    for (const [field, aliases] of Object.entries(FIELDS)) {
      if (aliases.includes(n)) map[field] = key;
    }
  }
  return map;
}

/**
 * Parses the workbook and reports what it found *and* what it could not use.
 * Nothing is written until the admin has read this. A silent import that drops
 * three rows is worse than no import.
 */
export async function parseEmployeeWorkbook(file) {
  const XLSX = await sheetjs();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!raw.length) return { rows: [], errors: [{ row: '—', problem: 'The first sheet has no data rows.' }], missing: [] };

  const map = mapHeaders(raw[0]);
  const missing = Object.keys(FIELDS).filter((f) => !map[f] && f !== 'reportingTo');

  const rows = [], errors = [], seen = new Set();

  raw.forEach((r, i) => {
    const line = i + 2; // sheet row number, header is row 1
    const rec = {
      empId:       String(r[map.empId] ?? '').trim(),
      name:        String(r[map.name] ?? '').trim(),
      designation: String(r[map.designation] ?? '').trim(),
      department:  String(r[map.department] ?? '').trim(),
      reportingTo: String(r[map.reportingTo] ?? '').trim()
    };
    if (!rec.empId && !rec.name) return; // blank spacer row, ignore quietly
    if (!rec.empId)            return errors.push({ row: line, problem: 'Employee ID is empty.' });
    if (!rec.name)             return errors.push({ row: line, problem: `Employee ID ${rec.empId} has no name.` });
    if (!/^[A-Za-z0-9_-]+$/.test(rec.empId))
      return errors.push({ row: line, problem: `Employee ID "${rec.empId}" uses characters that cannot be an account key. Use letters, digits, hyphen or underscore.` });
    if (seen.has(rec.empId))   return errors.push({ row: line, problem: `Employee ID ${rec.empId} appears more than once in this file.` });
    seen.add(rec.empId);
    rows.push(rec);
  });

  return { rows, errors, missing };
}

/** Resolves "Reporting Authority Name" text to an actual account. */
export function linkManagers(rows) {
  const byName = new Map(rows.map((r) => [norm(r.name), r.empId]));
  const unresolved = [];
  const linked = rows.map((r) => {
    if (!r.reportingTo) return { ...r, managerId: null };
    const id = byName.get(norm(r.reportingTo));
    if (!id) unresolved.push(r);
    return { ...r, managerId: id && id !== r.empId ? id : null };
  });
  const managerIds = new Set(linked.map((r) => r.managerId).filter(Boolean));
  return {
    rows: linked.map((r) => ({ ...r, role: managerIds.has(r.empId) ? 'manager' : 'employee' })),
    unresolved
  };
}

export async function exportRows(rows, columns, filename) {
  const XLSX = await sheetjs();
  const data = rows.map((r) => Object.fromEntries(columns.map(([label, get]) => [label, get(r)])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  XLSX.writeFile(wb, filename);
}

export async function downloadTemplate() {
  const XLSX = await sheetjs();
  const ws = XLSX.utils.json_to_sheet([
    { 'Employee ID': 'CDAC001', 'Employee Name': 'Asha Barman', 'Designation': 'Project Engineer',
      'Department': 'AI & Quantum Computing', 'Reporting Authority Name': 'Rakesh Dutta' },
    { 'Employee ID': 'CDAC002', 'Employee Name': 'Rakesh Dutta', 'Designation': 'Senior Director',
      'Department': 'AI & Quantum Computing', 'Reporting Authority Name': '' }
  ]);
  ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 26 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, 'kaarya-employee-template.xlsx');
}

/* --------------------------- task template import -------------------------- */

const TPL_FIELDS = {
  title:       ['task name', 'template name', 'title', 'task', 'name'],
  description: ['description', 'desc', 'details'],
  activities:  ['activities', 'activity', 'steps', 'checklist', 'sub tasks', 'subtasks']
};

function mapTplHeaders(row) {
  const map = {};
  for (const key of Object.keys(row)) {
    const n = norm(key);
    for (const [field, aliases] of Object.entries(TPL_FIELDS)) {
      if (aliases.includes(n)) map[field] = key;
    }
  }
  return map;
}

/**
 * Parse a template workbook. One row per template. Activities live in a single
 * cell separated by | or ; or newlines, OR spread across columns named
 * Activity 1, Activity 2, … — both are understood. Reports errors as a dry run.
 */
export async function parseTemplateWorkbook(file) {
  const XLSX = await sheetjs();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!raw.length) return { rows: [], errors: [{ row: '—', problem: 'The first sheet has no data rows.' }] };

  const map = mapTplHeaders(raw[0]);
  // any column literally called "Activity 1", "Activity 2", … becomes an activity slot
  const actCols = Object.keys(raw[0]).filter((k) => /^activity\s*\d+$/i.test(norm(k)));

  const rows = [], errors = [];
  raw.forEach((r, i) => {
    const line = i + 2;
    const title = String(r[map.title] ?? '').trim();
    if (!title) { if (Object.values(r).some((v) => String(v).trim())) errors.push({ row: line, problem: 'Template has no task name.' }); return; }

    let activities = [];
    if (map.activities && String(r[map.activities]).trim()) {
      activities = String(r[map.activities]).split(/[|;\n]+/).map((s) => s.trim()).filter(Boolean);
    }
    for (const c of actCols) { const v = String(r[c] ?? '').trim(); if (v) activities.push(v); }

    if (!activities.length) return errors.push({ row: line, problem: `"${title}" has no activities. Add an Activities column, or Activity 1, Activity 2… columns.` });

    rows.push({ title, description: String(r[map.description] ?? '').trim(), activities });
  });

  return { rows, errors };
}

export async function downloadTemplateWorkbook() {
  const XLSX = await sheetjs();
  const ws = XLSX.utils.json_to_sheet([
    { 'Task Name': 'Onboard a new hire', 'Description': 'Standard onboarding checklist',
      'Activities': 'Create accounts | Assign workstation | Orientation session | First-week review' },
    { 'Task Name': 'Publish a tender notice', 'Description': '',
      'Activities': 'Draft notice; Legal review; Upload to portal; Circulate internally' }
  ]);
  ws['!cols'] = [{ wch: 26 }, { wch: 32 }, { wch: 60 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Templates');
  XLSX.writeFile(wb, 'kaarya-task-templates.xlsx');
}
