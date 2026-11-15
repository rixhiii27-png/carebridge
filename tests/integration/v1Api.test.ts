import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server.ts';
import { setBackendOverridesForTests } from '../../server/config/backendContext.ts';
import { serverEnv } from '../../server/config/env.ts';
import { setAuthVerifiersForTests } from '../../server/middleware/auth.ts';
import { InMemoryFirestore } from '../helpers/inMemoryFirestore.ts';

describe('/api/v1 & Internal Scheduler HTTP Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let memDb: InMemoryFirestore;

  const TOKENS: Record<string, { uid: string; email: string; email_verified: boolean; name: string }> = {
    'tok-elder': { uid: 'elder_uid', email: 'elder@carebridge.local', email_verified: true, name: 'Elder User' },
    'tok-cg': { uid: 'cg_uid', email: 'caregiver@carebridge.local', email_verified: true, name: 'Caregiver User' },
    'tok-outsider': { uid: 'outsider_uid', email: 'outsider@carebridge.local', email_verified: true, name: 'Outsider' },
    'tok-unverified': { uid: 'unv_uid', email: 'unv@carebridge.local', email_verified: false, name: 'Unverified' },
  };

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    memDb = new InMemoryFirestore();
    setBackendOverridesForTests({
      db: memDb.asFirestore(),
      auth: {
        revokeRefreshTokens: async () => undefined,
      } as unknown as import('firebase-admin/auth').Auth,
    });
    setAuthVerifiersForTests({
      tokenVerifier: async (token) => {
        const claims = TOKENS[token];
        if (!claims) throw new Error('Invalid token');
        return claims;
      },
      oidcVerifier: async (token, expectedAudience) => ({
        valid: token === 'valid-oidc-token' && expectedAudience === 'https://carebridge.test',
        email: 'scheduler@carebridge.iam.gserviceaccount.com',
        emailVerified: true,
        audience: expectedAudience,
      }),
    });

    await memDb.doc('users/elder_uid').set({
      uid: 'elder_uid',
      displayName: 'Elder User',
      role: 'elderly',
      preferredLanguage: 'en',
      timezone: 'Asia/Kolkata',
    });
    await memDb.doc('users/cg_uid').set({
      uid: 'cg_uid',
      displayName: 'Caregiver User',
      role: 'caregiver',
      preferredLanguage: 'hi',
      timezone: 'Asia/Kolkata',
    });
  });

  afterAll(async () => {
    setBackendOverridesForTests({ db: null, auth: null });
    setAuthVerifiersForTests({ tokenVerifier: null, oidcVerifier: null });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('enforces 401/403 authentication & blocks self role escalation on PATCH /api/v1/users/me', async () => {
    const unauth = await fetch(`${baseUrl}/api/v1/users/me`);
    expect(unauth.status).toBe(401);

    const unverified = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { Authorization: 'Bearer tok-unverified' },
    });
    expect(unverified.status).toBe(403);

    const escalate = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-cg',
      },
      body: JSON.stringify({ role: 'elderly', displayName: 'Escalated' }),
    });
    expect(escalate.status).toBe(403);
    const escBody = (await escalate.json()) as { code: string };
    expect(escBody.code).toBe('ROLE_ESCALATION_FORBIDDEN');
  });

  it('executes full end-to-end care circle, medication, appointment, analytics, and revocation flows', async () => {
    // 1. Create care group as elder
    const grpRes = await fetch(`${baseUrl}/api/v1/care-groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-elder',
      },
      body: JSON.stringify({
        elderlyName: 'Raghavan Iyer',
        elderlyAge: 76,
        ownerRole: 'elderly',
        timezone: 'Asia/Kolkata',
      }),
    });
    expect(grpRes.status).toBe(201);
    const grpData = (await grpRes.json()) as { group: { id: string } };
    const groupId = grpData.group.id;

    // 2. Elder creates medication
    const medRes = await fetch(`${baseUrl}/api/v1/medications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-elder',
      },
      body: JSON.stringify({
        groupId,
        name: 'Metformin',
        dosage: '500 mg',
        scheduleTimes: ['08:00', '20:00'],
        frequency: 'twice_daily',
        startDate: '2026-01-01',
      }),
    });
    expect(medRes.status).toBe(201);
    const medData = (await medRes.json()) as { medication: { id: string } };
    const medId = medData.medication.id;

    // 3. Log dose & fetch history
    const todayKey = new Date().toISOString().slice(0, 10);
    const doseRes = await fetch(`${baseUrl}/api/v1/medications/${medId}/doses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-elder',
      },
      body: JSON.stringify({
        scheduledDate: todayKey,
        scheduledTime: '08:00',
        status: 'taken',
      }),
    });
    expect(doseRes.status).toBe(200);

    const histRes = await fetch(`${baseUrl}/api/v1/medications/${medId}/history`, {
      headers: { Authorization: 'Bearer tok-elder' },
    });
    expect(histRes.status).toBe(200);
    const histBody = (await histRes.json()) as { total: number };
    expect(histBody.total).toBe(1);

    // 4. Invitation creation (view-only caregiver) + redemption
    const invRes = await fetch(`${baseUrl}/api/v1/care-groups/${groupId}/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-elder',
      },
      body: JSON.stringify({
        targetRole: 'caregiver',
        canEditMedications: false,
        canEditAppointments: true,
        invitedEmail: 'caregiver@carebridge.local',
      }),
    });
    expect(invRes.status).toBe(201);
    const invBody = (await invRes.json()) as { invitation: { token: string } };

    const redeemRes = await fetch(`${baseUrl}/api/v1/invitations/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-cg',
      },
      body: JSON.stringify({ token: invBody.invitation.token, relationship: 'Visiting Nurse' }),
    });
    expect(redeemRes.status).toBe(200);

    // 5. Caregiver WITHOUT med edit permission cannot edit medication (403), CAN create appointment (201)
    const cgMedFail = await fetch(`${baseUrl}/api/v1/medications/${medId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-cg',
      },
      body: JSON.stringify({ dosage: '1000 mg' }),
    });
    expect(cgMedFail.status).toBe(403);

    const apptRes = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-cg',
      },
      body: JSON.stringify({
        groupId,
        doctorName: 'Dr. Nair',
        clinicName: 'Sankara Clinic',
        appointmentDate: '2099-05-10',
        appointmentTime: '11:00',
        timezone: 'Asia/Kolkata',
        reminderMinutesBefore: 90,
      }),
    });
    expect(apptRes.status).toBe(201);
    const apptBody = (await apptRes.json()) as { appointment: { id: string } };

    // 6. Outsider cross-group isolation (403)
    const outsiderRes = await fetch(`${baseUrl}/api/v1/dashboard/overview?groupId=${groupId}`, {
      headers: { Authorization: 'Bearer tok-outsider' },
    });
    expect(outsiderRes.status).toBe(403);

    // 7. Caregiver can view adherence & overview while active
    const adherenceRes = await fetch(
      `${baseUrl}/api/v1/dashboard/adherence?groupId=${groupId}&period=weekly`,
      { headers: { Authorization: 'Bearer tok-cg' } },
    );
    expect(adherenceRes.status).toBe(200);

    // 8. Cancel appointment & verify cancellation
    const cancelRes = await fetch(`${baseUrl}/api/v1/appointments/${apptBody.appointment.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-elder' },
    });
    expect(cancelRes.status).toBe(200);
    const cancelData = (await cancelRes.json()) as { appointment: { status: string } };
    expect(cancelData.appointment.status).toBe('cancelled');

    // 9. Revoke caregiver -> immediate 403 on dashboard overview
    const revokeRes = await fetch(`${baseUrl}/api/v1/care-groups/${groupId}/members/cg_uid`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-elder' },
    });
    expect(revokeRes.status).toBe(200);

    const revokedRead = await fetch(`${baseUrl}/api/v1/dashboard/overview?groupId=${groupId}`, {
      headers: { Authorization: 'Bearer tok-cg' },
    });
    expect(revokedRead.status).toBe(403);
  });

  it('verifies Cloud Scheduler OIDC Bearer and X-Scheduler-Secret authentication on /internal/scheduler/process-notifications', async () => {
    const prevSecret = serverEnv.schedulerSecret;
    const prevAud = serverEnv.schedulerOidcAudience;
    serverEnv.schedulerSecret = 'super-secret-scheduler-key';
    serverEnv.schedulerOidcAudience = 'https://carebridge.test';

    try {
      const noCreds = await fetch(`${baseUrl}/internal/scheduler/process-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(noCreds.status).toBe(401);

      const badOidc = await fetch(`${baseUrl}/internal/scheduler/process-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer bad-oidc-token',
        },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(badOidc.status).toBe(403);

      const validOidc = await fetch(`${baseUrl}/internal/scheduler/process-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-oidc-token',
        },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(validOidc.status).toBe(200);
      const oidcData = (await validOidc.json()) as { ok: boolean; summary: { dryRun: boolean } };
      expect(oidcData.ok).toBe(true);
      expect(oidcData.summary.dryRun).toBe(true);

      const validSecret = await fetch(`${baseUrl}/internal/scheduler/process-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scheduler-Secret': 'super-secret-scheduler-key',
        },
        body: JSON.stringify({ dryRun: false }),
      });
      expect(validSecret.status).toBe(200);
    } finally {
      serverEnv.schedulerSecret = prevSecret;
      serverEnv.schedulerOidcAudience = prevAud;
    }
  });
});
