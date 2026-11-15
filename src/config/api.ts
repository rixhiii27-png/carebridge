const rawConfiguredBase =
  (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || '';

export function normalizeApiBaseUrl(rawBase: string): string {
  return rawBase.trim().replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeApiBaseUrl(rawConfiguredBase);

export function buildApiUrl(path: string, baseOverride?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = baseOverride !== undefined ? normalizeApiBaseUrl(baseOverride) : API_BASE_URL;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
