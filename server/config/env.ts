import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

export function loadFirebaseConfig(): FirebaseAppletConfig {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(moduleDir, '../../firebase-applet-config.json'),
  ];
  const configPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!configPath) {
    throw new Error('firebase-applet-config.json is missing. Provision Firebase before starting the server.');
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const serverEnv = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  corsAllowedOrigins: parseOriginList(process.env.CORS_ALLOWED_ORIGINS),
  corsAllowVercelPreviews: process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true',
  vercelPreviewProjectSlug: (process.env.VERCEL_PREVIEW_PROJECT_SLUG || '').trim(),
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  googleCloudTtsApiKey: process.env.GOOGLE_CLOUD_TTS_API_KEY || '',
  schedulerSecret: process.env.SCHEDULER_SECRET || '',
  schedulerOidcAudience: process.env.SCHEDULER_OIDC_AUDIENCE || '',
  schedulerOidcServiceAccount: process.env.SCHEDULER_OIDC_SERVICE_ACCOUNT || '',
  emailTestMode: process.env.EMAIL_TEST_MODE !== 'false' || !process.env.SMTP_HOST,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'CareBridge Alerts <no-reply@carebridge.local>',
  },
};
