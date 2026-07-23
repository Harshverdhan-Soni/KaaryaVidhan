# Turning on push notifications

The notification bell works immediately with no setup — every notice appears
in-app. Push (a banner on the phone or desktop when the app is closed) needs a
few one-off steps.

## 1. Get a Web Push key

Firebase Console → **Project settings** → **Cloud Messaging** tab →
**Web configuration** → **Generate key pair**. Copy the key that appears.

## 2. Add it to `.env`

```
VITE_FCM_VAPID_KEY=BPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Also make sure these are filled in (they already should be):

```
VITE_FB_API_KEY=...
VITE_FB_AUTH_DOMAIN=...
VITE_FB_PROJECT_ID=...
VITE_FB_MESSAGING_SENDER_ID=...
VITE_FB_APP_ID=...
```

The service worker reads these automatically — no file needs editing by hand.

## 3. Deploy the sender function

```
cd functions
npm pkg set version="1.5.0"
cd ..
npx firebase deploy --only functions,database
npm run build
```

Look for **`pushOnNotification`** in the deploy output.

## 4. Switch it on per device

Each person opens the **bell → "Notify me on this device"** and allows the
browser prompt. That stores a token for that device; a person can enable it on
as many devices as they use.

## Notes

- **HTTPS is required.** Netlify already serves over HTTPS, so this is fine.
  Push will not work on `http://localhost` except in Chrome, which treats
  localhost as secure.
- **iOS** only supports web push when the app has been **added to the Home
  Screen** (Safari → Share → Add to Home Screen). Android and desktop work from
  the browser directly.
- If the key is absent the app still runs normally; the bell simply says push is
  not set up.
