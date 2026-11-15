# CareBridge Security Specification & Red-Team Threat Model

## 1. Data Invariants
1. **Default-Deny Baseline**: Every Firestore path not explicitly allowed is denied (`match /{document=**} { allow read, write: if false; }`).
2. **PII Isolation**: User PII (`email`, `phone`, `emergencyContact`, `address`) lives in `/users/{userId}/private/info`, strictly accessible only when `request.auth.uid == userId` and `email_verified == true` for writes.
3. **Master Gate Membership**: Every care group resource (`medications`, `medicationLogs`, `appointments`, `activityLogs`) requires active membership in `/careGroups/{groupId}/members/{request.auth.uid}` for single-document reads/writes, and evaluates `request.auth.uid in resource.data.memberUids` on `list` queries without `get()` inside `allow list`.
4. **Cross-Group & Membership Binding**:
   - `careMemberships` creation is atomically bound (`existsAfter` / `getAfter`) to an active `/careGroups/{groupId}/members/{uid}` document with matching `role`.
   - `notifications` creation verifies that `recipientUid` is in `careGroups/{groupId}.memberUids`, preventing cross-group notification spoofing.
   - `medications`, `medicationLogs`, and `appointments` bind `memberUids` directly to `careGroups/{groupId}.memberUids`.
5. **Role & Granular Edit Enforcement**:
   - Only `elderly` owners or members with `status == 'active'` AND `canEditMedications == true` may create/update/deactivate medications.
   - Only `elderly` owners or members with `status == 'active'` AND `canEditAppointments == true` may create/update/cancel appointments.
   - Only the care group `ownerId` may revoke members or modify member permissions.
6. **Terminal State Locking**:
   - Once an `invitation` reaches `status: 'redeemed'` or `'revoked'`, no further updates are permitted.
   - Once an `appointment` reaches `status: 'cancelled'` or `'completed'`, status cannot be reverted via client SDK.
   - `activityLogs` are append-only: `allow update, delete: if false`.
7. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must match `request.time`; `createdAt` and `ownerId`/`createdBy` are immutable on update.
8. **ID & Payload Bounds**: Every document ID path variable must satisfy `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars), and every string/list field enforces strict type and `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Medication Read**: Read `/medications/{medId}` when `request.auth == null`.
2. **Unverified Email Spoof**: Write `/users/{uid}` when `request.auth.token.email_verified == false`.
3. **PII Blanket Read**: Authenticated non-owner reads `/users/{victimUid}/private/info`.
4. **Shadow Field Injection**: Create `/medications/{medId}` with extra ghost field `isDoctorVerified: true`.
5. **Identity Spoofing on Creation**: Create `/medications/{medId}` with `createdBy: "someone_else"` != `request.auth.uid`.
6. **Unauthorized Group Access**: Non-member creates or reads `/appointments/{apptId}` for another user's `groupId`.
7. **Privilege Escalation on Membership**: Family member updates own `/careGroups/{groupId}/members/{uid}` to set `canEditMedications: true`.
8. **Revoked Member Write**: Revoked caregiver (`status == 'revoked'`) attempts to log a dose in `/medicationLogs/{logId}`.
9. **Terminal State Bypass**: Update `/appointments/{apptId}` after `status == 'cancelled'` back to `'scheduled'`.
10. **Audit Log Tampering**: Update or delete an existing `/activityLogs/{logId}` entry.
11. **ID Poisoning**: Create `/medications/../../etc/passwd` or 500-char invalid ID.
12. **Client Timestamp Forgery**: Create `/medications/{medId}` with a backdated `createdAt` instead of `request.time`.
13. **Cross-Group Notification Injection**: Member of Group A creates `/notifications/{id}` targeting a victim UID not in `careGroups/{groupId}.memberUids`.
14. **Forged CareMembership Role**: User creates `/careMemberships/{id}` without an atomic active `members` doc of matching role.
