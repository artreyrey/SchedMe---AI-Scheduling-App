SchedMe v1.0.1
SchedMe is an AI-assisted personal scheduling app that turns thoughts and natural-language requests into a practical weekly plan. It combines conversational planning with direct calendar controls, so users can choose the fastest way to organize their time.

Live app: https://schedme.vercel.app

Features
Schedule in natural language, including requests such as Schedule dinner tomorrow from 8-9pm.
Use compact commands such as Make thesis / Monday / 2-3pm and Monday-2-3pm.
Capture unfinished ideas in What's on my mind and schedule them later.
Work through unscheduled tasks one at a time, ordered by urgency and age.
Detect overlapping events and offer safe alternatives instead of silently overwriting tasks.
Move, reschedule, unschedule, cancel, complete, skip, or undo tasks through the assistant.
Create and edit calendar blocks manually with custom start times, end times, titles, completion state, and colors.
Drag calendar tasks between days and time sections while preserving their duration.
Show animated pickup, floating preview, destination highlighting, and confirmation feedback during drag-and-drop.
Organize tasks into urgent, important, not urgent, and free-form lists.
Save conversation history, the current scheduling step, interaction style, and assistant preferences.
Greet the user only once per day instead of repeating introductory prompts.
Choose persistent Light, Dark, Pink, Berry Sunset, Matcha, or Night themes.
Sign in with email/password or Google and synchronize personal data with Firebase.
Use a responsive, glass-inspired interface with reduced-motion accessibility support.
What gives SchedMe an edge
SchedMe uses AI for understanding and conversation, while deterministic application logic performs important calendar operations. A schedule is only reported as saved after Firebase confirms the write. This reduces hallucinated actions and makes scheduling behavior more predictable.

The app also minimizes repetitive questions. A complete task, day, and time request is executed immediately, a fresh named request overrides stale conversational state, and the assistant asks only for information that is actually missing. Users can switch freely between chat, compact commands, calendar forms, and drag-and-drop editing.

Conflict checks, preserved task priorities, owner-scoped Firestore data, persistent preferences, and multiple visual themes make SchedMe useful as a personal planning workspace rather than only a chatbot.

Technology
React 19
Vite 8
Tailwind CSS 4
Firebase Authentication
Cloud Firestore
Firebase AI Logic with Gemini
Firebase App Check with reCAPTCHA Enterprise
Vercel hosting
Local development
Requirements:

Node.js 20.19+ or 22.12+
npm
A Firebase web project
Install dependencies and start the development server:

npm install
npm run dev
Copy .env.example to .env and supply the Firebase values for your own project. The example file contains variable names only and is safe to commit.

Environment variables
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_GEMINI_MODEL=gemini-3.5-flash-lite
VITE_FIREBASE_RECAPTCHA_ENTERPRISE_KEY=
Variables prefixed with VITE_ are embedded in the browser bundle. Firebase web configuration identifies the Firebase project but does not replace authorization. Protect user data with Firebase Authentication, restrictive Firestore rules, App Check, API restrictions, and usage quotas.

Never place Firebase Admin credentials, service-account JSON, private keys, unrestricted server API keys, or production secrets in a VITE_ variable or commit them to the repository.

Testing and production build
npm test
npm run build
npm run preview
The automated tests cover scheduling formats, task creation, conflicts, cancellation, completion, conversation behavior, calendar editing, drag-and-drop placement, and saved themes.

Deployment
The production app is deployed on Vercel at schedme.vercel.app. Configure the required environment variables in the Vercel project settings and publish the included Firestore rules before using production data.

Security notes
.env files, logs, private keys, service-account files, local hosting state, and editor metadata are excluded through .gitignore.
.env.example intentionally contains no credentials.
User tasks, conversations, and preferences are stored beneath the authenticated user's Firestore records.
firestore.rules should be reviewed and deployed whenever the data model changes.
Rotate any credential immediately if it is ever committed, shared publicly, or exposed in build logs.
