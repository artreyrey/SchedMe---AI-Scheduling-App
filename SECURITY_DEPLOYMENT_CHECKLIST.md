# SchedMe production security checklist

These settings are intentionally not automated because they change project-wide cloud security or depend on the final production hostname. Complete them in the Firebase and Google Cloud consoles before inviting users.

## Firebase App Check

- Register the production web origin with a reCAPTCHA Enterprise provider and set its site key as `VITE_FIREBASE_RECAPTCHA_ENTERPRISE_KEY` in the production environment.
- In **Firebase Console → App Check → APIs**, enforce App Check for **Firebase AI Logic** and **Cloud Firestore** after confirming production requests show valid App Check metrics.
- Enable replay protection for Firebase AI Logic. The app requests limited-use App Check tokens for AI calls.
- Keep local App Check debug tokens private, register only developer machines, and never place a debug token in source control or production environment variables.

## Authentication and AI limits

- In **Firebase Console → AI Services → AI Logic → Settings**, enforce **Authenticated users** mode.
- In **Google Cloud Console → Firebase AI Logic API → Quotas & System Limits**, set a per-user generate-content limit appropriate for the app. Start at **10 requests per minute per region**, matching SchedMe's local guide, then adjust from real usage.
- Confirm **Email/Password** and **Google** are the only intended Firebase Authentication providers.
- Add `schedme.vercel.app` to Firebase Authentication's authorized domains and to the email-verification continue URL allowlist.

## API key and hosting

- Restrict the production browser API key to the `https://schedme.vercel.app/*` HTTP referrer. Keep Firebase's API restrictions and verify every API used by Authentication, Firestore, App Check, Analytics, and Firebase AI Logic remains allowed.
- Keep separate development and production environment values. Never commit `.env` files.
- Deploy `firestore.rules`; the current rules require a matching user ID, a verified email token, and approved document schemas.
- Deploy the Vercel configuration, then verify the CSP, HSTS, `nosniff`, frame, referrer, and permissions headers on the live origin.

## Release smoke test

- Create and verify a new password account, then create, edit, move, complete, reopen, categorize, and delete test tasks.
- Confirm an unverified password account cannot open user data and receives a new verification prompt when signing in.
- Test Google sign-in, password reset, sign-out, session-only sign-in, and **Remember me on this device**.
- Confirm AI commands work with App Check enforcement and that invalid or exhausted requests fail with user-safe messages.
- Run `npm test`, `npm run test:rules`, `npm run build`, and `npm audit` before every security release.
