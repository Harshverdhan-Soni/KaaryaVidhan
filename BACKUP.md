# Backing up KaaryaVidhan

Git version-controls the **code and the security rules** (`database.rules.json`,
`functions/`, the React app). It does **not** hold the live Realtime Database
data — every employee, task, `/updates` ledger entry, group, PIN hash and
notification lives in the `kaarya-tracker` RTDB instance (`asia-southeast1`) on
Google's servers. Checking out an old commit rolls back the code, not the data,
and the destructive actions in the app (`resetApp`, `deleteEmployees`,
`deleteTasks`) wipe real data with **no undo**. So the database needs its own
backups, separate from Git. There are three ways, below.

> Every backup contains PIN hashes and all staff data. Keep backups secure and
> never commit them. `.gitignore` already excludes `backups/` and service-account
> key files.

---

## 1. Automated daily backups (recommended — hands-off)

The project is on the Blaze plan, so Firebase can back the database up for you
every day, server-side, including the security rules and protected nodes like
`/pins`.

1. Firebase Console → **Realtime Database** → **Backups** tab.
2. Run the in-console setup. It writes a daily JSON to a Cloud Storage bucket.
3. Optional but recommended: leave Gzip on, and enable the 30-day lifecycle so
   old backups auto-delete.

The feature itself is free; you pay only standard Cloud Storage rates for the
stored files. The same tab has a **Start a manual backup** button — click it
right before anything risky (a rules deploy, a reset).

## 2. Manual export, any time

Firebase Console → **Realtime Database** → **Data** → ⋮ menu → **Export JSON**.
Downloads the current tree on demand.

## 3. Local timestamped snapshots (this repo)

`scripts/backup-db.ps1` (and `scripts/backup-db.bat`, which just calls it) dump
the whole database to `backups/kaarya-YYYYMMDD-HHmmss.json` using the Firebase
CLI. Because the CLI runs as your Owner login, it bypasses the security rules and
captures `/pins` too. The script warns you if `/pins` is missing (which means you
weren't signed in as an Owner).

Run it from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
```

or just double-click `scripts\backup-db.bat`.

**Prerequisite:** be logged in to the CLI once — `npx firebase login`.

**Schedule it (Windows Task Scheduler):**

1. Task Scheduler → **Create Basic Task** → name it "KaaryaVidhan DB backup".
2. Trigger: Daily, pick a time.
3. Action: **Start a program**.
   - Program/script: `cmd.exe`
   - Add arguments: `/c "D:\My Data backup\Harshverdhan\Projects\KaaryaVidhan\kaarya\scripts\backup-db.bat"`
4. Finish. (When scheduled it runs silently; the window only pauses on a manual
   double-click.)

---

## Restoring

Any of these produces a JSON of the full tree. To restore:

Firebase Console → **Realtime Database** → **Data** tab → ⋮ → **Import JSON** →
choose the backup file.

Importing at the root **replaces** the whole database, so restore into a test
project first if you only need to recover part of the data, then copy across what
you need.
