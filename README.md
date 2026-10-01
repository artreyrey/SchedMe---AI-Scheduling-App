# SchedMe

SchedMe is an AI-powered personal scheduling application. The project is being built in phases; this first phase establishes the React, Vite, and Tailwind CSS foundation.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

Add the Firebase web app configuration values to the project root `.env` file. `.env` is ignored by Git. The `.env.example` file lists the required variable names without credentials. Configure the same `VITE_FIREBASE_*` variables in Vercel before deploying. These values are used by the Firebase client SDK and will be present in the browser bundle, so Firebase Authentication and Firestore security rules must enforce data access when those services are added.
