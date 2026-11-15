import { getAuthenticatedIdToken } from './firestoreService.ts';

async function v1Fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthenticatedIdToken();
  if (!token) {
    throw new Error('Verified authentication session is required.');
  }

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  const data = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function deleteMyAccountV1(): Promise<{ deleted: true; uid: string }> {
  return v1Fetch('/users/me', { method: 'DELETE' });
}

export async function fetchDashboardAdherenceV1(
  groupId: string,
  period: 'daily' | 'weekly' | 'monthly' = 'weekly',
) {
  return v1Fetch<{
    groupId: string;
    period: string;
    summary: {
      taken: number;
      skipped: number;
      missed: number;
      notConfirmed: number;
      totalTracked: number;
      adherencePercent: number;
    };
  }>(`/dashboard/adherence?groupId=${encodeURIComponent(groupId)}&period=${period}`);
}

export async function updateNotificationPrefsV1(patch: Record<string, unknown>) {
  return v1Fetch('/notifications/preferences', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}
