import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAndValidateServiceAccountJson } from '../../server/config/firebase.ts';
import {
  buildAllowedOriginSet,
  isOriginAllowed,
  normalizeOrigin,
} from '../../server/middleware/cors.ts';
import { buildApiUrl, normalizeApiBaseUrl } from '../../src/config/api.ts';

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Firebase Service Account JSON Parsing & Validation', () => {
  const syntheticPrivateKey =
    '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_NON_REAL_TEST_MATERIAL\n-----END PRIVATE KEY-----\n';

  it('parses valid service account JSON and normalizes escaped newlines', () => {
    const escapedKey = syntheticPrivateKey.replace(/\n/g, '\\n');
    const raw = JSON.stringify({
      type: 'service_account',
      project_id: 'carebridge-43267',
      client_email: 'test-runner@carebridge-43267.iam.gserviceaccount.com',
      private_key: escapedKey,
    });

    const parsed = parseAndValidateServiceAccountJson(raw, 'carebridge-43267');
    expect(parsed.projectId).toBe('carebridge-43267');
    expect(parsed.clientEmail).toBe('test-runner@carebridge-43267.iam.gserviceaccount.com');
    expect(parsed.privateKey).toContain('\n');
    expect(parsed.privateKey).not.toContain('\\n');
  });

  it('rejects empty, non-JSON, and non-object inputs without leaking raw input', () => {
    expect(() => parseAndValidateServiceAccountJson('')).toThrow(/empty/i);
    expect(() => parseAndValidateServiceAccountJson('SECRET_TOKEN_SHOULD_NOT_LEAK')).toThrow(
      /valid JSON/i,
    );
    try {
      parseAndValidateServiceAccountJson('SECRET_TOKEN_SHOULD_NOT_LEAK');
    } catch (err) {
      expect((err as Error).message).not.toContain('SECRET_TOKEN_SHOULD_NOT_LEAK');
    }
    expect(() => parseAndValidateServiceAccountJson('["array"]')).toThrow(
      /expected a JSON service account object/i,
    );
  });

  it('rejects missing project_id, invalid client_email, malformed private_key, and project mismatches', () => {
    expect(() =>
      parseAndValidateServiceAccountJson(
        JSON.stringify({
          client_email: 'test@example.com',
          private_key: syntheticPrivateKey,
        }),
      ),
    ).toThrow(/missing project_id/i);

    expect(() =>
      parseAndValidateServiceAccountJson(
        JSON.stringify({
          project_id: 'carebridge-43267',
          client_email: 'not-an-email',
          private_key: syntheticPrivateKey,
        }),
      ),
    ).toThrow(/client_email/i);

    expect(() =>
      parseAndValidateServiceAccountJson(
        JSON.stringify({
          project_id: 'carebridge-43267',
          client_email: 'test@carebridge-43267.iam.gserviceaccount.com',
          private_key: 'not-a-pem-key',
        }),
      ),
    ).toThrow(/private_key/i);

    expect(() =>
      parseAndValidateServiceAccountJson(
        JSON.stringify({
          project_id: 'wrong-project-id',
          client_email: 'test@wrong-project-id.iam.gserviceaccount.com',
          private_key: syntheticPrivateKey,
        }),
        'carebridge-43267',
      ),
    ).toThrow(/mismatch/i);
  });
});

describe('CORS Origin Allowlist Logic', () => {
  it('normalizes valid http/https origins and rejects wildcards or invalid schemes', () => {
    expect(normalizeOrigin('https://carebridge.vercel.app/')).toBe('https://carebridge.vercel.app');
    expect(normalizeOrigin('http://localhost:3000/dashboard')).toBe('http://localhost:3000');
    expect(normalizeOrigin('*')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('not-a-url')).toBeNull();
  });

  it('allows explicit Vercel production origin and excludes localhost in production', () => {
    const allowedSet = buildAllowedOriginSet({
      appUrl: 'https://carebridge-app.vercel.app',
      corsAllowedOrigins: ['https://carebridge.example.com/path'],
      nodeEnv: 'production',
    });

    const config = {
      allowedSet,
      allowVercelPreviews: false,
      vercelPreviewProjectSlug: '',
    };

    expect(isOriginAllowed('https://carebridge-app.vercel.app', config)).toBe(true);
    expect(isOriginAllowed('https://carebridge.example.com', config)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', config)).toBe(false);
    expect(isOriginAllowed('https://evil-attacker.vercel.app', config)).toBe(false);
    expect(isOriginAllowed('https://carebridge-app.vercel.app.evil.com', config)).toBe(false);
  });

  it('scopes Vercel preview URLs strictly to VERCEL_PREVIEW_PROJECT_SLUG when enabled', () => {
    const config = {
      allowedSet: new Set(['https://carebridge-ui.vercel.app']),
      allowVercelPreviews: true,
      vercelPreviewProjectSlug: 'carebridge-ui',
    };

    expect(isOriginAllowed('https://carebridge-ui-git-main-team.vercel.app', config)).toBe(true);
    expect(isOriginAllowed('https://unrelated-app.vercel.app', config)).toBe(false);
  });
});

describe('Frontend API URL Helper & Source Verification', () => {
  it('normalizes VITE_API_BASE_URL cleanly and preserves relative paths when unset', () => {
    expect(normalizeApiBaseUrl('https://carebridge-api.onrender.com///')).toBe(
      'https://carebridge-api.onrender.com',
    );
    expect(buildApiUrl('/api/v1/users/me', 'https://carebridge-api.onrender.com/')).toBe(
      'https://carebridge-api.onrender.com/api/v1/users/me',
    );
    expect(buildApiUrl('/api/v1/users/me', '')).toBe('/api/v1/users/me');
    expect(buildApiUrl('api/translate', 'https://carebridge-api.onrender.com')).toBe(
      'https://carebridge-api.onrender.com/api/translate',
    );
  });

  it('routes every frontend fetch("/api...") call through buildApiUrl and leaks no backend secrets in src/', () => {
    const srcFiles = walkFiles(path.resolve(process.cwd(), 'src'));
    expect(srcFiles.length).toBeGreaterThan(0);

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content, `Direct raw fetch('/api...') found in ${file}`).not.toMatch(
        /fetch\(\s*['"`]\/api/,
      );
      expect(content, `Server secret reference found in frontend file ${file}`).not.toMatch(
        /FIREBASE_SERVICE_ACCOUNT_JSON|SCHEDULER_SECRET|SMTP_PASS|GEMINI_API_KEY|GOOGLE_CLOUD_TTS_API_KEY/,
      );
    }
  });
});
