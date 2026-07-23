# KaaryaVidhan — project handoff

**C-DAC Employees Task Tracker.** Live and in production use.
Read this first; it is the whole context needed to continue work.

---

## 1. What it is

An internal task tracker for C-DAC. Work is assigned to people, broken into
**activities**, and each person records progress against those activities. The
point of the app is that a manager or administrator can see, at a glance, who is
moving work forward and whether it will land on time — without asking anyone.

The name joins *kaarya* (the work) and *vidhan* (the orderly method).

**Signature feature — the Pace Bar.** One horizontal bar per task. Its fill is
the mean of the activity sliders; the fill is subdivided by each contributor's
colour in proportion to how much they moved it. A hairline marks where the
calendar says the task should be today; if the fill sits behind that line the
shortfall is hatched red. This one graphic is the app's whole idea, and most
design decisions defer to it.

---

## 2. Stack and where things live

| | |
|---|---|
| Frontend | Vite + React 18 + Tailwind CSS **v3** |
| Backend | Firebase **Realtime Database** (NOT Firestore) |
| Functions | Cloud Functions **gen 2**, Node 22, ESM |
| Auth | Custom tokens minted by the `login` function; PIN-based |
| Hosting | Netlify, **manual drag-and-drop of `dist/`** — no CI/CD |
| PWA | manifest + service worker; PWABuilder path documented in PACKAGING.md |

**Firebase project:** `kaarya-tracker` (project number `19032276085`)

**Regions — these differ on purpose and must not be "tidied up":**

| Thing | Region |
|---|---|
| Realtime Database instance | `asia-southeast1` |
| Callable functions (9 of them) | `asia-south1` |
| `pushOnNotification` (DB trigger) | `asia-southeast1` |

A database trigger runs through Eventarc and **must be deployed in the region of
the database instance**. Deploying it to `asia-south1` fails with
`cannot create a trigger in region asia-south1`. Callables can live anywhere,
which is why the other nine are in `asia-south1`.

**Local path (Windows):** `D:\My Data backup\Harshverdhan\Projects\KaaryaVidhan\kaarya`

---

## 3. Palette and type

```
ink    #0A2540    blue   #0B4E8C (DEFAULT)   blue-500 #1565A8   azure/blue-400 #2E7BC4
sky    #EAF2FA    line   #D6E3F0             muted    #5A7391
ok     #1F8A4C    warn   #E8801A             bad      #D93025
```

Fonts: **Archivo** (display), **Inter/Calibri** (body), **IBM Plex Mono** (mono).

**Logo:** a white check rising out of a partly-filled azure task bar, on a
C-DAC-blue rounded square — deliberately echoing the Pace Bar. Source of truth is
`src/components/Logo.jsx` (inline SVG for UI) and `public/icons/*` (raster for
favicon/PWA). Both are generated from the same artwork; regenerate icons with
cairosvg if the mark ever changes.

---

## 4. File map

```
src/lib/
  firebase.js   app init; exports db, fns
  auth.jsx      useAuthed(); sign-in via the login callable
  useDb.js      useDb(path)  — live RTDB subscription; useList() variant
  db.js         EVERY mutation lives here. Nothing writes to RTDB elsewhere.
  progress.js   ALL derived logic: pace, status, the gate rules, validation
  colors.js     colorFor (stable per person) + colorForInTask (unique per task)
  excel.js      employee + template workbook parsing / export
  notify.js     in-app notifications + FCM push registration

src/components/
  ui.jsx            Avatar, Chip, Modal, Field, Empty, AsyncButton, DangerConfirm
  PaceBar.jsx       the signature bar
  TaskCard.jsx      dashboard card
  Logo.jsx          LogoMark, Wordmark
  NotificationBell.jsx

src/pages/
  Login.jsx  Dashboard.jsx  Employees.jsx  TaskDetail.jsx  TaskForm.jsx  Templates.jsx

functions/index.js   10 functions (see below)
database.rules.json  security rules — the real permission boundary
```

**Rule of thumb:** business logic belongs in `progress.js` (pure, testable),
writes belong in `db.js`, and permissions belong in `database.rules.json`.
Components should not compute rules inline.

---

## 5. Cloud Functions (10)

`login` · `importEmployees` · `setPin` · `bootstrapAdmin` · `deleteEmployees` ·
`deleteTasks` · `resetApp` · `approveAssignment` · `rejectAssignment` ·
`pushOnNotification`

**Why these are server-side and not client writes** — worth understanding before
moving anything:

- **Deletes and reset** must delete PINs, and `/pins` is `write:false` for
  *everyone* including admins. Only the Admin SDK can touch it. A client-side
  delete would leave orphaned credential hashes, so a "deleted" person could
  still authenticate.
- **Manager approval** verifies server-side that the caller is the *recorded
  approver* for that member, so a manager cannot approve for someone who is not
  their report, even by tampering with the request.
- **Destructive actions re-verify the caller's PIN on the server**, so an
  unattended open session cannot be used to wipe data.

PIN hashing: `sha256("kaarya:{empId}:{pin}")`, stored at `/pins`. Login throttles
at 5 failures / 15 minutes via `/_gate`.

---

## 6. Roles and the two approval gates

### Roles
- **Admin** — bootstrapped account. Manages staff, sees every task in three
  streams (assigned by me / by managers / self-assigned), can edit, extend,
  reassign, delete, reset.
- **Manager** — *derived automatically*: you become a manager because other
  people name you as their Reporting Authority. Assigns to own reports,
  approves cross-team requests, monitors the team.
- **Employee** — accepts/declines assigned tasks, records progress, leaves
  remarks, flags blockers, can raise own tasks.

### Gate 1 — assignment (per member)

```
self-assign, own-manager assign, admin→own report, admin→managerless
    pending → accepted / denied

admin assigns someone reporting to a DIFFERENT manager
    awaiting_manager → (manager approves) → pending → accepted / denied
                    └─ (manager rejects) → member removed, back to admin
```

The rule lives in **one place**: `initialMemberState(assigner, assignee)` in
`progress.js`. Do not re-implement it at call sites.

**Important caveat:** the gate keys off `managerId`, which is only set when a
reporting-authority name resolved to a real account at import. If it did not
resolve, the person counts as managerless and admin assignments reach them
directly. The approval chain is only as good as the reporting data.

### Gate 2 — activity completion validation

Reaching 100% on an activity is a **claim**, not completion. The activity shows
*Awaiting approval*; the **task creator or any admin** approves it or sends it
back with a note. A task is marked complete **only** when every activity is both
100% and approved — `approveActivity()` in `db.js` is the sole place completion
is ever set. Changing progress on an approved activity re-opens it for
validation and un-completes the task.

### Progress-edit permission (deliberately strict)

`canEdit = mine?.state === 'accepted'` — role-blind. The creator gets no special
rights; an admin or manager who is only *monitoring* cannot edit. An admin who
assigned an activity to themselves **can**, because they are an accepted member.
This is enforced identically in the database rule, so the UI and the server
cannot disagree.

Sliders are also **locked behind an explicit "Update progress" button** to stop
accidental drags. A locked slider keeps the contributor's colour at 0.55 opacity
with `pointer-events:none` — deliberately *not* the native `disabled` attribute,
which forces the browser's grey rendering and hides who moved the work.

---

## 7. Notifications

Two independent halves:

1. **In-app** — rows under `/notifications/{empId}`. Always works, no setup. The
   header bell reads it live.
2. **Push** — `pushOnNotification` is a database trigger that mirrors every
   in-app notice out to that person's registered devices. Because it is a
   trigger rather than per-call-site code, the in-app notice and the push can
   never disagree.

Notices fire on: task assigned, manager approval needed, activity ready for
validation, activity approved or sent back, accept/decline.

**Push requires a VAPID key** (`VITE_FCM_VAPID_KEY`) — see `PUSH-SETUP.md`.
Without it everything still works; the bell simply says push is not set up.
On iOS, web push only works if the app is added to the Home Screen.

---

## 8. Deploying

```powershell
# frontend only (most changes)
npm run build
# then drag dist/ onto Netlify

# rules changed
npx firebase deploy --only database

# functions changed  — VERSION BUMP IS MANDATORY
cd functions
npm pkg set version="1.6.0"      # any unused number
cd ..
npx firebase deploy --only functions
```

**The version-bump gotcha:** Firebase skips deploying functions whose source
hash is unchanged. If you edit a function and it reports `Skipped (No changes
detected)`, bump `functions/package.json` version to force it. This has bitten
this project repeatedly.

### `.env` (root, never committed)

```
VITE_FB_API_KEY=            VITE_FB_AUTH_DOMAIN=
VITE_FB_DATABASE_URL=https://kaarya-tracker-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_FB_PROJECT_ID=kaarya-tracker
VITE_FB_STORAGE_BUCKET=     VITE_FB_MESSAGING_SENDER_ID=19032276085
VITE_FB_APP_ID=             VITE_FN_REGION=asia-south1
VITE_FCM_VAPID_KEY=         # optional, enables push
```

Vite bakes `.env` in **at build time**. After editing it you must rebuild, and a
running `npm run dev` must be restarted. Several "the app can't see the
database" incidents traced back to a stale build.

---

## 9. Hard-won lessons — do not relearn these

- **IAM:** the Cloud Build service account is
  `19032276085-compute@developer.gserviceaccount.com` — the `-compute@developer`
  row, *not* `@cloudbuild`, `@cloudservices` or `@appspot`. They all start with
  the same project number and grants repeatedly landed on the wrong row. It
  needs **Editor**. Also: the "Policy was out of date" dialog will silently
  **remove** roles — always reload the IAM page before editing.
- **Region:** database triggers must match the database region (see §2).
- **Rules constrain design:** a non-admin who completes a task cannot edit other
  members' rows, which is why "clear pending approvals on completion" is handled
  at *read* time via `livePendingApprovals()` rather than by deleting rows.
- **`Object.values(null)` throws.** Firebase returns `null` for a missing path,
  not `undefined`, so a default parameter `= {}` does not catch it. Always
  `Object.values(x || {})`.
- **Optimistic UI:** accept/decline, progress save, and add-members all apply
  locally the instant the write resolves, then drop the override when the server
  agrees. Waiting on the sync round-trip made buttons look dead. These overrides
  never grant permission — the rules are still the boundary.
- **Colours:** `colorForInTask` distributes the palette across a task's current
  roster so no two members share a colour. Consequence: **adding a member
  reshuffles colours on that task.** That is the accepted trade for guaranteed
  distinctness.

---

## 10. Data model

```
/employees/{empId}   empId, name, designation, department, reportingTo,
                     managerId, role, active, createdAt, lastLogin
/pins/{empId}        sha256 hash (read:false, write:false — Admin SDK only)
/_gate/{empId}       login throttle
/tasks/{taskId}      title, description, department, startDate, deadline,
                     origin('assigned'|'self'), createdBy, status, completedAt,
                     activities/{actId}{ title, progress, updatedBy, updatedAt,
                                         blocked, approvedAt, approvedBy, reworkNote },
                     members/{empId}{ state, approver, at, reason },
                     rounds/, rejections/
/updates/{taskId}    progress deltas — the Pace Bar's source. Never re-derive.
/comments/{taskId}/{actId}
/audit/{taskId}
/templates/{uid}     private per-user task templates
/notifications/{empId}
/fcmTokens/{empId}
```

---

## 11. Current state

**Everything below is built, tested and deployed.**

Employee import (Excel, dry-run preview) · PIN management · task create/assign ·
Pace Bar · accept/decline with confirmations · progress sliders (locked, colour
preserved) · remarks · blocked flags · manager assignment gate + Approvals inbox
· activity completion validation · add-employee mid-task · reassign after
deadline · self-assign for edit rights · templates (in-app + Excel import) ·
delete/reset with phrase+PIN · notifications (in-app + push) · PWA · full
branding.

**Deliverables produced alongside the app:**
`KaaryaVidhan-User-Manual.docx` / `.pdf` (16pp, 3 role sections, C-DAC branded),
`KaaryaVidhan-Sample-Employees.xlsx` (14 people, 4 managers),
`KaaryaVidhan-Sample-Templates.xlsx` (10 templates).

### Known trade-offs and open items

| Item | Note |
|---|---|
| Push not yet live | needs `VITE_FCM_VAPID_KEY`; see PUSH-SETUP.md |
| Colours reshuffle when a task's roster changes | accepted trade for uniqueness |
| Stale `awaiting_manager` rows persist on completed tasks | ignored at read time; a Cloud Function could physically remove them |
| Templates are private per user | no shared org library (a deliberate choice) |
| Role is not manually editable | derived from the reporting graph, recomputed on import |
| GitHub repo | `https://github.com/Harshverdhan-Soni/KaaryaVidhan` — confirm the push happened; `.gitignore` must exclude `.env` |
| `firebase-functions` v6 | deploy warns a newer major exists; upgrading is a breaking change, not yet done |

---

## 12. Test accounts

`CDAC001` is the bootstrapped admin (PIN was `1234` — change it). The two sample
workbooks recreate a 14-person organisation with four managers, enough to
exercise every flow: own-team assignment, cross-team approval, and
self-assignment.

---

## 13. Working style for whoever picks this up

- Ship in phases; test locally; deploy manually.
- Put pure logic in `progress.js` and unit-test it with a throwaway `node`
  script before wiring UI — the gate rules and permission matrices were all
  caught this way.
- When changing anything permission-related, change the **rule and the client
  check together** and verify they agree on every case.
- Prefer honest assessment over optimistic framing.
