import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

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
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('firebase-applet-config.json is missing. Provision Firebase before starting the server.');
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

export const serverEnv = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
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
