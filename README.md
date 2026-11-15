# CareBridge

**Better Care. Stronger Connections. Healthier Living.**

CareBridge is a full-stack, accessible, 23-language elderly healthcare and medication coordination platform built for the Catalyst Hackathon 2026. It connects elderly individuals, family members, and authorized caregivers inside one calm, security-hardened workspace.

> **Important Disclaimer**: CareBridge is a healthcare coordination tool. It is **not** a certified medical device, does **not** diagnose conditions, and never prescribes or calculates medication dosages. Always follow instructions from qualified healthcare professionals.

---

## Key Capabilities

1. **Medication Management**
   - Add, edit, deactivate, and reactivate medications with clinician-provided schedules, frequencies, prescriber details, and notes.
   - Daily dose confirmation workflow (`Not confirmed`, `Taken`, `Skipped`, `Missed`) with actor attribution (`updatedByName`), timestamped history, and 7-day adherence analytics.
2. **Family & Caregiver Collaboration**
   - Role-based care circles (`elderly`, `family`, `caregiver`).
   - Single-use, 24-hour expiring invitation codes with granular edit permissions (`canEditMedications`, `canEditAppointments`) and instant access revocation.
   - Immutable audit activity timeline (`activityLogs`).
3. **Doctor Appointment Management**
   - Monthly calendar view and upcoming/history lists with detail modals, visit notes, cancellation/completion workflows, and timezone-aware reminder lead times.
4. **Automated Notification System**
   - In-app alerts plus server-side email delivery via Nodemailer (`EMAIL_TEST_MODE=true` when SMTP is unconfigured, never falsely reporting sent emails).
   - Privacy-safe neutral email subjects and bodies (no diagnoses, medication names, or appointment specifics in email text).
   - 12-hour deduplication cache, exponential backoff retry, per-user notification preferences, and an authenticated Google Cloud Scheduler trigger endpoint (`POST /api/scheduler/reminders`).
5. **Care Intelligence Dashboard**
   - Restrained 3D-inspired layered surfaces using the 5-color CareBridge palette (`#D7CAB7` Pastel Earth, `#71774B` Olive Green, `#383C23` Green Kelp, `#85383E` Soiled Pink, `#3E0911` Dark Burgundy) and `prefers-reduced-motion` support.
   - CSV export and print-ready care summary reports.
6. **23-Language Multilingual & Accessibility Support**
   - English plus all 22 Indian Constitutional Eighth Schedule languages (`as`, `bn`, `brx`, `doi`, `gu`, `hi`, `kn`, `ks`, `kok`, `mai`, `ml`, `mni`, `mr`, `ne`, `or`, `pa`, `sa`, `sat`, `sd`, `ta`, `te`, `ur`), with multi-script support and RTL layout switching (`ur`, `ks`, `sd`).
   - Large Text, High Contrast, Large Touch Buttons (48px+), Simple Navigation, Reduced Motion, and feature-detected Web Speech API voice read-aloud/commands with text fallbacks.
7. **Optional Care Guide Assistant**
   - Server-side Gemini endpoint (`POST /api/assistant`) with strict non-diagnostic, non-prescribing system guardrails.

---

## Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, `i18next` / `react-i18next`
- **Backend**: Node.js, Express, Zod validation, `firebase-admin` ID token verification, `express-rate-limit`, Nodemailer, `@google/genai`
- **Database & Auth**: Firebase Authentication (Google Sign-In) + Cloud Firestore (`firestore.rules` with zero-trust RBAC, PII isolation under `/users/{uid}/private/info`, and atomic invitation redemption)
- **Deployment Target**: Google Cloud Run + Google Cloud Scheduler

---

## Environment Configuration

Copy `.env.example` to `.env` for local overrides (never commit `.env` or secrets):

| Variable | Purpose |
| --- | --- |
| `PORT` | Express server port (`3000` locally, `8080` in Cloud Run) |
| `APP_URL` | Public URL used in privacy-safe email links |
| `GEMINI_API_KEY` | Optional server-side key for Care Guide & note translation helper |
| `SCHEDULER_SECRET` | Shared header secret (`X-Scheduler-Secret`) for scheduler endpoints |
| `SCHEDULER_OIDC_AUDIENCE` | Optional Cloud Run URL audience for Google Cloud Scheduler OIDC Bearer verification |
| `SCHEDULER_OIDC_SERVICE_ACCOUNT` | Optional expected Google Cloud Scheduler service account email |
| `EMAIL_TEST_MODE` | Keep `"true"` unless SMTP credentials are configured |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional SMTP provider settings for live email alerts |

Firebase web configuration is stored in `firebase-applet-config.json` (project `carebridge-43267`, database `ai-studio-7551e125-12ab-4361-aaa8-aa63ba199dd4`).

---

## Modular REST API (`/api/v1` & Internal Scheduler)

All `/api/v1/*` routes verify the caller's Firebase ID token (`Authorization: Bearer <idToken>` with `email_verified === true`) and enforce server-side care group RBAC via Firestore Admin SDK before reading or mutating any record:

- **Users**: `GET /api/v1/users/me`, `PATCH /api/v1/users/me` (rejects self role escalation), `DELETE /api/v1/users/me`
- **Care Groups & Invitations**: `GET /api/v1/care-groups`, `POST /api/v1/care-groups`, `GET /api/v1/care-groups/:id/members`, `POST /api/v1/care-groups/:id/invitations` (SHA-256 `tokenHash` stored), `POST /api/v1/invitations/redeem` (transactional single-use), `PATCH /api/v1/care-groups/:id/members/:uid`, `DELETE /api/v1/care-groups/:id/members/:uid`
- **Medications & Doses**: `GET /api/v1/medications`, `POST /api/v1/medications`, `GET /api/v1/medications/:id`, `PATCH /api/v1/medications/:id`, `DELETE /api/v1/medications/:id`, `POST /api/v1/medications/:id/doses`, `GET /api/v1/medications/:id/history`
- **Appointments**: `GET /api/v1/appointments`, `POST /api/v1/appointments`, `GET /api/v1/appointments/:id`, `PATCH /api/v1/appointments/:id`, `DELETE /api/v1/appointments/:id` (cancels pending reminder jobs)
- **Notifications**: `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`, `POST /api/v1/notifications/preferences`
- **Dashboard Analytics**: `GET /api/v1/dashboard/overview`, `GET /api/v1/dashboard/adherence`, `GET /api/v1/dashboard/activity`
- **Multilingual Voice Assistant**: `GET /api/v1/voice/capabilities`, `POST /api/v1/voice/transcribe` (zero audio retention), `POST /api/v1/voice/converse` (native script dialogue + confirmation workflows), `POST /api/v1/voice/execute-action` (requires `confirmed: true`), `POST /api/v1/voice/synthesize` (`audio/wav` neural TTS with browser fallback)
- **Health & Scheduler**: `GET /health`, `POST /internal/scheduler/process-notifications`, `POST /api/scheduler/reminders`

---

## Running Locally & Testing

```bash
# Install dependencies
npm install

# Run full development server (Express + Vite middleware on port 3000)
npm run dev

# Type-check TypeScript
npm run lint

# Validate Firestore security rules with ESLint security plugin
npm run lint:rules

# Run automated unit, integration, and security rule tests
npm test

# Build production frontend bundle
npm run build

# Run production server
NODE_ENV=production npm start
```

---

## Google Cloud Run & Cloud Scheduler Deployment

1. Build and push the container image using the included `Dockerfile`:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/carebridge
   ```
2. Deploy to Cloud Run (set secrets via Secret Manager or Cloud Run env vars):
   ```bash
   gcloud run deploy carebridge \
     --image gcr.io/YOUR_PROJECT_ID/carebridge \
     --platform managed \
     --region asia-south1 \
     --allow-unauthenticated \
     --set-env-vars NODE_ENV=production,EMAIL_TEST_MODE=true,APP_URL=https://YOUR_SERVICE_URL,SCHEDULER_OIDC_AUDIENCE=https://YOUR_SERVICE_URL
   ```
3. Configure Cloud Scheduler to trigger `POST https://YOUR_SERVICE_URL/internal/scheduler/process-notifications` on your cadence using either OIDC auth (`--oidc-service-account-email` matching `SCHEDULER_OIDC_SERVICE_ACCOUNT`) or header `X-Scheduler-Secret: <SCHEDULER_SECRET>`.

---

## Security Notes

- Every Firestore path defaults to deny (`allow read, write: if false`).
- Single-document writes enforce verified Firebase Auth tokens, strict field allowlists (`hasOnly`), bounded string/array sizes, and server-side timestamps (`request.time`).
- `notificationJobs` and `notificationDeliveryLogs` are locked down to Admin SDK only.
- Review and customize `firestore.rules` for your production project requirements before broad distribution.
