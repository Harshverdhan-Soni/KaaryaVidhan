# Kaarya — Employees Task Tracker

C-DAC internal task tracker. Vite + React 18 + Tailwind v3 + Firebase Realtime Database,
with Cloud Functions handling sign-in. Installable as a PWA.

---

## The idea in one component

Everything hangs off **the Pace Bar**. One track per task answers three questions at once:

- **How far along** — the length of the fill (the mean of every activity's 0–100 slider)
- **Who moved it** — the fill is cut into each person's colour by their share of contributed
  progress, so a passenger shows up as a sliver
- **Are we losing** — a hairline marks where the calendar says the task should be today
  (days elapsed ÷ days allotted). If the fill sits behind it, the shortfall hatches red.

Colours come from a hash of the Employee ID, so a person's colour is the same on every device,
survives a re-import, and never reshuffles.

## Roles

| Role | How you get it | What you see |
|---|---|---|
| **Admin** | Set once at bootstrap; never demoted by an import | Everything. "Assigned by me" vs "Self assigned", every department, extend, reassign, import, PIN resets, export |
| **Manager** | Derived — somebody names you as their Reporting Authority | Your own tasks, plus read-only view of your direct reports' tasks |
| **Employee** | Default | Your own tasks. You can create your own and pull colleagues in |

Roles are computed **server-side** in `importEmployees` and travel in the auth token, so the
database rules can trust them. The client cannot assert who it is.

## Setup

**1. Firebase project**

Create one, then enable:
- **Realtime Database** (not Firestore — the whole app is written against RTDB)
- **Authentication → Sign-in method → Anonymous is not needed**; custom tokens work without it
- **Cloud Functions** (Blaze plan required)

**2. Fill `.env`**

```bash
cp .env.example .env
```
Paste your web app config. `VITE_FB_DATABASE_URL` must be the RTDB URL
(`https://<project>-default-rtdb.<region>.firebasedatabase.app`), not the project URL.

**3. Point the CLI at the project**

Edit `.firebaserc` and replace `kaarya-tracker` with your project ID.

**4. Deploy the backend**

```bash
cd functions && npm install && cd ..
npx firebase login
npx firebase deploy --only functions,database
```
Functions deploy to `asia-south1`. If you change that, change `VITE_FN_REGION` to match.

**5. Grant the token-creator role — login fails without this**

`login` mints a custom token, which means it has to *sign* a JWT. Gen 2 functions run as
the **Compute Engine default service account**, which cannot sign by default. Skip this
and login fails with a `signBlob` permission error that reads like a bug in the code.

Google Cloud Console → **IAM & Admin → IAM** → find
`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` → Edit → Add another role →
**Service Account Token Creator** → Save. Give it a couple of minutes to propagate.

**6. Create the first admin**

There is no admin yet, so there is nobody who can make one. `bootstrapAdmin` exists for exactly
this, and is closed unless a secret is set:

```bash
npx firebase functions:config:set   # (gen 2 uses env vars, see below)
```
Set `BOOTSTRAP_SECRET` on the function — easiest via the Google Cloud console
(Cloud Run → `bootstrapadmin` → Edit → Variables), or add it to `functions/.env`:

```
BOOTSTRAP_SECRET=some-long-random-string
```
Redeploy, then call it once from the browser console on your deployed site:

```js
const { getFunctions, httpsCallable } = await import('firebase/functions');
await httpsCallable(getFunctions(undefined,'asia-south1'),'bootstrapAdmin')({
  secret: 'some-long-random-string',
  empId: 'CDAC001', name: 'Harshverdhan Soni', pin: '1234',
  department: 'AI & Quantum Computing', designation: 'Technical Assistant'
});
```

**Then remove `BOOTSTRAP_SECRET` and redeploy.** The function refuses to run without it.

**7. Build and ship**

```bash
npm install
npm run build
```
Drag `dist/` onto Netlify. `public/_redirects` is already in place for SPA routing.

## Day one

1. Sign in as the admin.
2. **Employees → Import from Excel.** Five columns: Employee ID, Employee Name, Designation,
   Department, Reporting Authority Name. Header matching is loose — "Dept" and "Reports To" work.
3. The import shows a **dry run first**: how many rows are ready, which rows will be skipped
   and why, and which reporting authorities it could not match to a person. Nothing is written
   until you accept it.
4. New accounts get a 4-digit starting PIN, **shown once**. Download the list and hand them out.
5. Create a task, break it into activities, assign people, set a deadline.

## How PINs are handled

- PINs are SHA-256 hashed with the Employee ID as salt, stored under `/pins`, which is
  `".read": false, ".write": false` — **no client can touch it, ever.** Only the Admin SDK.
- `login` verifies the hash server-side and mints a custom token carrying `role` and `department`.
- Five wrong attempts buys a 15-minute wait (`/_gate`, also fully locked).
- Nobody can *read* a PIN, including the admin. An admin can only replace one.

## Data model

```
/employees/{empId}   name, designation, department, reportingTo, managerId, role, active
/pins/{empId}        sha256 — server only
/tasks/{taskId}      title, description, department, origin, startDate, deadline, status,
                     members/{empId}: {state, reason}, activities/{actId}: {title, progress, blocked},
                     extensions/, rounds/
/updates/{taskId}    the contribution ledger — every slider move: {actId, empId, from, to, delta, at}
/comments/{taskId}/{actId}
/audit/{taskId}      who did what, when
```

**`/updates` is the important one.** Progress is a value, but contribution is a *history* — the
Pace Bar renders deltas, not the current value. Pulling a slider backwards earns no credit,
and re-deriving contribution from current values would be wrong.

## Things worth knowing

- **Progress is the mean of the activities.** Four activities means each is worth a quarter.
  Weighting is not implemented; add more activities to the heavier parts instead.
- **Reassigning** files the old team, their answers and the old deadline as a "round" on the
  record rather than overwriting them, and optionally resets progress to zero.
- **Extending** keeps the original date visible on the task forever.
- **SheetJS is loaded on demand, not on first paint.** First load is 545 kB (136 kB
  gzipped); the 429 kB spreadsheet chunk arrives only when someone opens the import screen
  or clicks an export — which is only ever the admin. Everyone else never pays for it.
- **Android packaging** — see `PACKAGING.md`. Short version: Kaarya already installs from
  the browser via Add to Home screen, and for an internal staff tool that is usually the
  right answer. The Play route is documented there if you need it.
