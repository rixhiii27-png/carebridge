import crypto from 'node:crypto';

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

export function generateDocId(prefix: string): string {
  const rand = crypto.randomBytes(6).toString('hex');
  const ts = Date.now().toString(36);
  return sanitizeId(`${prefix}_${ts}_${rand}`);
}

export function generateSecureInviteToken(): {
  plaintextToken: string;
  tokenHash: string;
  code: string;
} {
  const rawHex = crypto.randomBytes(16).toString('hex');
  const tokenHash = hashToken(rawHex);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let seg1 = '';
  let seg2 = '';
  for (let i = 0; i < 4; i++) {
    seg1 += alphabet[crypto.randomInt(0, alphabet.length)];
    seg2 += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return {
    plaintextToken: rawHex,
    tokenHash,
    code: `CB-${seg1}-${seg2}`,
  };
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function clampStr(val: string | undefined, maxLen: number): string | undefined {
  if (val === undefined) return undefined;
  const trimmed = val.trim();
  return trimmed.slice(0, maxLen);
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatTimezoneDateKey(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatTimezoneTimeKey(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

export function shiftDateKeyDays(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function clampPagination(limitRaw?: number, offsetRaw?: number): {
  limit: number;
  offset: number;
} {
  const limit = Math.max(1, Math.min(100, Math.round(limitRaw ?? 25)));
  const offset = Math.max(0, Math.min(5000, Math.round(offsetRaw ?? 0)));
  return { limit, offset };
}
