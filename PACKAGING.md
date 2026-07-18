# Packaging Kaarya for Android

Kaarya is already installable. On any phone, **Chrome → ⋮ → Add to Home screen** gives
staff a real app icon, a standalone window with no browser chrome, and offline shell
caching. No store, no review, no signing keys, no waiting.

Everything below is only worth doing if you specifically need a Play Store listing.
Read the next section before you start — for an internal staff tool, the honest answer
is usually that you don't.

---

## Choosing the channel first

Kaarya is an internal C-DAC staff tracker. There is no self-signup, accounts exist only
because an admin imported a spreadsheet, and the login is an Employee ID plus a PIN.
That shapes which channel actually fits.

| Channel | What it costs you | Fits Kaarya? |
|---|---|---|
| **Add to Home screen** (PWA) | Nothing. Works today. | **Yes** — this is the default answer |
| **Play internal testing track** | ₹2,000 one-time Play Console fee, testers added by email address, up to 100 | Yes, if you want managed updates |
| **Play closed testing** | Same, plus a tester list per group | Yes, for a larger rollout |
| **Play production (public listing)** | Full review | **Probably not** — see below |

**Why a public Play listing is a poor fit.** Google's review team has to be able to open
the app. Behind a PIN wall with no signup, they cannot — so Play requires you to supply
**working demo credentials** in the review notes. Handing a live account on a government
staff system to an external reviewer is a decision that is not yours or mine to make
casually; it needs whoever owns the system to sign off. On top of that, publicly listing
an internal MeitY tool is likely to need institutional approval regardless of what the
technology permits.

**Internal testing has none of that problem** — no review, no demo account, no public
listing. If you want Play, that's the track to use.

---

## If you're proceeding: pick the package name carefully

**The package name is permanent.** Once an AAB is uploaded under it, that name is bound
to your Play account forever. It cannot be renamed, and the name cannot be reused.

Convention is reverse-DNS of a domain **you actually control**:

- Sparshcraft used `in.sparshcraft.twa` — correct, because you own `sparshcraft.in`.
- `in.cdac.kaarya` reverses `cdac.in`, which **C-DAC owns and you personally do not.**
  Do not publish under it without the institution's sign-off; it asserts you speak for
  that domain.
- `app.netlify.kaarya` is wrong for the same reason — Netlify owns `netlify.app`.

If Kaarya lives at a `*.netlify.app` subdomain and you're publishing this yourself, use
a domain you own. If C-DAC is publishing it institutionally, the package name should be
issued by them along with a `cdac.in` subdomain to host it on.

Note this is separate from Digital Asset Links, which cares about the **domain you're
hosting on**, not the package name. Verification will pass on `kaarya.netlify.app` — the
package-name question is about authority, not about whether it technically works.

---

## Steps

### 1. Deploy the site first

Digital Asset Links is verified by fetching a file over HTTPS from your live domain, so
the site must be up before Android will trust the app.

```bash
npm run build
```

Drag `dist/` to Netlify. Confirm the file is reachable:

```
https://<your-domain>/.well-known/assetlinks.json
```

It must return **JSON**, not your app's HTML. `public/.well-known/assetlinks.json` is
already in the project and Vite copies it into `dist/` — verified. Your `_redirects`
catch-all doesn't shadow it, because Netlify only rewrites paths that don't match a real
file unless the rule is forced with `!`.

### 2. Generate the Android package

Go to **https://www.pwabuilder.com**, enter your deployed URL, and let it read the
manifest. `public/manifest.webmanifest` already has what it needs: name, short name,
`display: standalone`, `theme_color: #0B4E8C`, and 192/512 icons including a maskable
512.

**Package for stores → Android → Options:**

| Field | Value |
|---|---|
| Package ID | your chosen package name (permanent — see above) |
| App name | Kaarya |
| Short name | Kaarya |
| Theme colour | `#0B4E8C` |
| Nav bar colour | `#0B4E8C` |
| Signing key | **Create new** |

Download the zip. It contains `app-release-bundle.aab` and a `signing-key-keystore`
plus `signing_key_info.txt`.

**Back up the keystore and its passwords somewhere you will still have them in three
years.** Lose it and you cannot ship an update — the app is orphaned and has to be
republished under a new package name.

### 3. First fingerprint — the one PWABuilder gives you

`signing_key_info.txt` contains a SHA-256 fingerprint. Put it in
`public/.well-known/assetlinks.json` as the first entry and replace the package name:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "your.package.name",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:…  ← from signing_key_info.txt"
      ]
    }
  }
]
```

Rebuild, redeploy.

### 4. Upload to Play

Play Console → create the app → **Testing → Internal testing** (not Production) →
upload the `.aab`.

### 5. Second fingerprint — the one that catches people out ← this is the step

Play **re-signs your app with its own key.** The fingerprint from step 3 is now not the
one users' devices will see, so Digital Asset Links fails, verification breaks, and the
app opens showing a browser address bar instead of running standalone.

After upload: **Play Console → Test and release → Setup → App signing** → copy the
**SHA-256 certificate fingerprint** under *App signing key certificate*.

Add it as a **second entry** in the same array — keep both:

```json
"sha256_cert_fingerprints": [
  "AA:BB:…  ← PWABuilder upload key",
  "11:22:…  ← Play App Signing key"
]
```

Rebuild, redeploy. Both must be present: the upload key covers the AAB you built, the
Play key covers what actually lands on the phone.

### 6. Verify

Install from the internal testing link on a real device. **If you see a URL bar at the
top, asset links failed** — it's almost always step 5, or `assetlinks.json` not being
served as JSON. Check with:

```
https://developers.google.com/digital-asset-links/tools/generator
```

---

## Updating later

Every release: bump `versionCode` in PWABuilder, rebuild the AAB with **the same
keystore**, upload. Web content updates need no store release at all — the TWA loads
your live site, so a Netlify drag-and-drop reaches everyone immediately. Only the
wrapper needs a store update.
