import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

describe('Firestore Security Rules Structural Invariants (security_spec.md)', () => {
  it('enforces a global default-deny catch-all rule', () => {
    expect(rulesContent).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
  });

  it('defines strict ID validation, verified-email enforcement, and active-member gates', () => {
    expect(rulesContent).toContain("function isValidId(id)");
    expect(rulesContent).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
    expect(rulesContent).toContain('request.auth.token.email_verified == true');
    expect(rulesContent).toContain('function isActiveMember(groupId)');
    expect(rulesContent).toContain("getMember(groupId).status == 'active'");
  });

  it('isolates PII under /users/{userId}/private/{docId} to strict owner access only', () => {
    expect(rulesContent).toMatch(/match \/private\/\{docId\}[\s\S]*allow get: if isValidId\(userId\) && docId == 'info' && isOwner\(userId\)/);
    expect(rulesContent).toMatch(/match \/private\/\{docId\}[\s\S]*allow list: if false;/);
    expect(rulesContent).toMatch(/match \/users\/\{userId\}[\s\S]*allow list: if false;/);
  });

  it('enforces strict schema field allowlists (hasOnly) across core collections', () => {
    const requiredValidators = [
      'isValidUserProfile',
      'isValidUserPrivateInfo',
      'isValidCareGroup',
      'isValidCareMember',
      'isValidInvitation',
      'isValidMedication',
      'isValidMedicationLog',
      'isValidAppointment',
      'isValidNotification',
      'isValidNotificationPref',
      'isValidActivityLog',
    ];

    for (const fnName of requiredValidators) {
      expect(rulesContent).toContain(`function ${fnName}(data)`);
    }

    const hasOnlyMatches = rulesContent.match(/\.keys\(\)\.hasOnly\(/g) ?? [];
    expect(hasOnlyMatches.length).toBeGreaterThanOrEqual(11);
  });

  it('enforces terminal state locking on appointments & invitations and immutability on activityLogs', () => {
    expect(rulesContent).toMatch(/match \/appointments\/\{apptId\}[\s\S]*existing\(\)\.status == 'scheduled'/);
    expect(rulesContent).toMatch(/match \/invitations\/\{inviteId\}[\s\S]*existing\(\)\.status == 'pending'/);
    expect(rulesContent).toMatch(/match \/activityLogs\/\{logId\}[\s\S]*allow update, delete: if false;/);
  });

  it('prevents get()/exists() inside allow list rules to keep queries scalable and safe', () => {
    const listLines = rulesContent
      .split('\n')
      .filter((line) => line.trim().startsWith('allow list:'));

    expect(listLines.length).toBeGreaterThanOrEqual(8);
    for (const line of listLines) {
      expect(line).not.toContain('get(');
      expect(line).not.toContain('exists(');
      expect(line).not.toContain('isActiveMember(');
      expect(line).not.toContain('isGroupOwner(');
    }
  });

  it('supports atomic care group creation & invite redemption via existsAfter/getAfter in activityLogs and careMemberships', () => {
    expect(rulesContent).toContain('function isActiveMemberOrPendingBatchMember(groupId)');
    expect(rulesContent).toMatch(/isActiveMemberOrPendingBatchMember[\s\S]*existsAfter\(/);
    expect(rulesContent).toMatch(/match \/careMemberships\/\{membershipId\}[\s\S]*existsAfter\(.*members/);
  });

  it('binds notifications recipients and medication/appointment memberUids to the target care group', () => {
    expect(rulesContent).toContain(
      'incoming().recipientUid in get(/databases/$(database)/documents/careGroups/$(incoming().groupId)).data.memberUids',
    );
    expect(rulesContent).toMatch(/match \/medications\/\{medId\}[\s\S]*incoming\(\)\.memberUids == get\(/);
    expect(rulesContent).toMatch(/match \/appointments\/\{apptId\}[\s\S]*incoming\(\)\.memberUids == get\(/);
  });

  it('enforces server-side active group membership and email restriction on notification dispatch', () => {
    const controllerPath = path.resolve(process.cwd(), 'server/controllers/apiController.ts');
    const controllerContent = fs.readFileSync(controllerPath, 'utf-8');
    expect(controllerContent).toContain('isActiveGroupMemberAdmin(parsed.data.groupId, req.user.uid)');
    expect(controllerContent).toContain('const verifiedRecipient = req.user.email;');
    expect(controllerContent).toContain('recipientEmail: verifiedRecipient');
  });

  it('guards allow get rules against null resource evaluations on missing or pre-create documents', () => {
    expect(rulesContent).toMatch(/match \/careGroups\/\{groupId\}[\s\S]*resource != null && existing\(\)\.ownerId/);
    expect(rulesContent).toMatch(/match \/medicationLogs\/\{logId\}[\s\S]*resource == null \|\| isActiveMember/);
    expect(rulesContent).toMatch(/match \/invitations\/\{inviteId\}[\s\S]*resource == null \|\|/);
  });
});
