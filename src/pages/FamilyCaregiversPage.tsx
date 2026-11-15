import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  History,
  KeyRound,
  Pencil,
  Shield,
  ShieldAlert,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import {
  createInvitationCode,
  fetchMyInvitations,
  redeemInvitationCode,
  revokeInvitation,
  updateMemberPermissionsOrRevoke,
} from '../services/firestoreService.ts';
import type { CareMember, Invitation } from '../types/carebridge.ts';

export const FamilyCaregiversPage: React.FC = () => {
  const { t } = useTranslation();
  const { firebaseUser, profile, activeGroup, members, refreshMembers } = useCareBridge();

  const isOwner = activeGroup?.ownerId === firebaseUser?.uid;

  const [targetRole, setTargetRole] = useState<'family' | 'caregiver'>('family');
  const [canEditMedications, setCanEditMedications] = useState(false);
  const [canEditAppointments, setCanEditAppointments] = useState(true);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [pendingRevokeMember, setPendingRevokeMember] = useState<CareMember | null>(null);
  const [pendingRevokeInviteCode, setPendingRevokeInviteCode] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const list = await fetchMyInvitations(firebaseUser.uid);
      setInvitations(list);
    } catch {
      // handled cleanly
    }
  }, [firebaseUser]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !activeGroup || !isOwner) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const created = await createInvitationCode({
        groupId: activeGroup.id,
        elderlyName: activeGroup.elderlyName,
        createdBy: firebaseUser.uid,
        targetRole,
        canEditMedications,
        canEditAppointments,
      });
      setInvitations((prev) => [created, ...prev]);
      setSuccessMsg(`Invitation code ${created.code} generated (valid for 24 hours).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create invitation.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRevokeInvite = async (code: string) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await revokeInvitation(code);
      await loadInvites();
      setSuccessMsg(`Invitation code ${code} revoked.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not revoke invitation.');
    } finally {
      setBusy(false);
      setPendingRevokeInviteCode(null);
    }
  };

  const handleUpdateMember = async (
    member: CareMember,
    patch: { canEditMedications: boolean; canEditAppointments: boolean; status: 'active' | 'revoked' },
  ) => {
    if (!firebaseUser || !profile || !activeGroup || !isOwner) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateMemberPermissionsOrRevoke({
        groupId: activeGroup.id,
        targetUid: member.uid,
        targetName: member.displayName,
        canEditMedications: patch.canEditMedications,
        canEditAppointments: patch.canEditAppointments,
        status: patch.status,
        actor: { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        currentMemberUids: activeGroup.memberUids,
      });
      await refreshMembers();
      setSuccessMsg(
        patch.status === 'revoked'
          ? `Access revoked for ${member.displayName}.`
          : `Updated permissions for ${member.displayName}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Permission update failed.');
    } finally {
      setBusy(false);
      setPendingRevokeMember(null);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await redeemInvitationCode({
        code: joinCode,
        uid: firebaseUser.uid,
        displayName: profile.displayName,
        relationship: relationship || profile.role,
      });
      setJoinCode('');
      setRelationship('');
      setSuccessMsg('Successfully joined the care circle!');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid or expired invitation code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('caregivers.title')}
        subtitle={t('caregivers.subtitle')}
        icon={<Users className="w-6 h-6" />}
        actions={
          <Link
            to="/activity"
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] whitespace-nowrap"
          >
            <History className="w-4 h-4 text-[#71774B]" />
            Care Activity Log
          </Link>
        }
      />

      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911] flex items-center gap-2.5"
        >
          <ShieldAlert className="w-5 h-5 text-[#85383E] shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div
          role="status"
          className="p-4 rounded-xl bg-[#FAF7F2] border border-[#71774B] text-[15px] text-[#383C23] font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Care Circle Members */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#71774B]" />
            {t('caregivers.activeMembers')}
          </h2>
          <span className="text-sm font-semibold text-[#5D4A44] tabular-nums">
            {members.filter((m) => m.status === 'active').length} active
          </span>
        </div>

        <div className="divide-y divide-[#3E0911]/10">
          {members.map((member) => {
            const isMemberOwner = member.uid === activeGroup?.ownerId;
            return (
              <div
                key={member.uid}
                className="py-4 first:pt-0 last:pb-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-base text-[#3E0911]">{member.displayName}</span>
                    <span className="text-sm font-semibold text-[#5D4A44] capitalize">
                      · {isMemberOwner ? 'Primary Owner' : member.role}
                      {member.relationship ? ` (${member.relationship})` : ''}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-semibold ${
                        member.status === 'active' ? 'text-[#71774B]' : 'text-[#85383E]'
                      }`}
                    >
                      {member.status === 'active' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                      )}
                      {member.status === 'active'
                        ? t('caregivers.activeBadge')
                        : t('caregivers.revokedBadge')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#5D4A44]">
                    <span className="inline-flex items-center gap-1.5">
                      {member.canEditMedications ? (
                        <Pencil className="w-3.5 h-3.5 text-[#71774B]" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-[#5D4A44]" />
                      )}
                      Medications:{' '}
                      <strong className="text-[#3E0911]">
                        {member.canEditMedications ? 'Can Edit' : 'View Only'}
                      </strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {member.canEditAppointments ? (
                        <Pencil className="w-3.5 h-3.5 text-[#71774B]" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-[#5D4A44]" />
                      )}
                      Appointments:{' '}
                      <strong className="text-[#3E0911]">
                        {member.canEditAppointments ? 'Can Edit' : 'View Only'}
                      </strong>
                    </span>
                  </div>
                </div>

                {isOwner && !isMemberOwner && member.status === 'active' && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        handleUpdateMember(member, {
                          canEditMedications: !member.canEditMedications,
                          canEditAppointments: member.canEditAppointments,
                          status: 'active',
                        })
                      }
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      {member.canEditMedications ? 'Set Meds View-Only' : 'Allow Med Edit'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        handleUpdateMember(member, {
                          canEditMedications: member.canEditMedications,
                          canEditAppointments: !member.canEditAppointments,
                          status: 'active',
                        })
                      }
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      {member.canEditAppointments ? 'Set Appts View-Only' : 'Allow Appt Edit'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPendingRevokeMember(member)}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#F6EAEC] hover:bg-[#EDD8DC] border border-[#85383E]/30 text-[#85383E] text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      <UserMinus className="w-4 h-4" />
                      {t('caregivers.revokeAccess')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Generate Single-Use Expiring Invite */}
        {isOwner && (
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[#71774B]" />
              {t('caregivers.generateInvite')}
            </h2>

            <form onSubmit={handleGenerateInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                  {t('caregivers.targetRole')}
                </label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as 'family' | 'caregiver')}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
                >
                  <option value="family">{t('auth.roleFamily')}</option>
                  <option value="caregiver">{t('auth.roleCaregiver')}</option>
                </select>
              </div>

              <label className="min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 text-[15px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={canEditMedications}
                  onChange={(e) => setCanEditMedications(e.target.checked)}
                  className="w-5 h-5 accent-[#71774B] shrink-0"
                />
                <span>{t('caregivers.allowMedEdit')}</span>
              </label>

              <label className="min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 text-[15px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={canEditAppointments}
                  onChange={(e) => setCanEditAppointments(e.target.checked)}
                  className="w-5 h-5 accent-[#71774B] shrink-0"
                />
                <span>{t('caregivers.allowApptEdit')}</span>
              </label>

              <p className="text-sm text-[#5D4A44]">{t('caregivers.expiresIn')}</p>

              <button
                type="submit"
                disabled={busy}
                className="cb-btn-3d w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer disabled:opacity-60"
              >
                {t('caregivers.generateInvite')}
              </button>
            </form>

            {invitations.length > 0 && (
              <div className="pt-4 border-t border-[#3E0911]/10 space-y-2.5">
                <h3 className="text-sm font-bold text-[#3E0911]">Recent Invitation Codes</h3>
                {invitations.slice(0, 6).map((inv) => (
                  <div
                    key={inv.code}
                    className="p-3.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div>
                      <span className="font-mono font-bold text-base text-[#3E0911] tracking-wide">
                        {inv.code}
                      </span>
                      <div className="text-sm text-[#5D4A44] mt-0.5 capitalize">
                        {inv.targetRole} · {inv.status}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {inv.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopy(inv.code)}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {copiedCode === inv.code ? (
                              <>
                                <Check className="w-4 h-4 text-[#71774B]" />
                                {t('caregivers.copied')}
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                {t('caregivers.copyCode')}
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingRevokeInviteCode(inv.code)}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#F6EAEC] text-sm font-semibold text-[#85383E] hover:bg-[#EDD8DC] cursor-pointer"
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Join an Existing Care Group */}
        <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4 h-fit">
          <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#71774B]" />
            {t('caregivers.joinTitle')}
          </h2>

          <form onSubmit={handleJoinGroup} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('caregivers.enterCode')}
              </label>
              <input
                type="text"
                required
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CB-XXXX-XXXX"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono uppercase text-[#3E0911]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('auth.relationshipLabel')}
              </label>
              <input
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Son / Visiting Nurse"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !joinCode.trim()}
              className="cb-btn-3d w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-xl bg-[#383C23] hover:bg-[#2A2D1A] text-white text-[15px] font-semibold cursor-pointer disabled:opacity-60"
            >
              {t('auth.joinCareGroup')}
            </button>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRevokeMember)}
        title={`Revoke access for ${pendingRevokeMember?.displayName || 'member'}?`}
        description="This member will immediately lose access to medications, appointments, and care notes in this care circle. You can send a new invite later if needed."
        confirmLabel={t('caregivers.revokeAccess')}
        tone="danger"
        busy={busy}
        onCancel={() => setPendingRevokeMember(null)}
        onConfirm={() => {
          if (pendingRevokeMember) {
            handleUpdateMember(pendingRevokeMember, {
              canEditMedications: false,
              canEditAppointments: false,
              status: 'revoked',
            });
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingRevokeInviteCode)}
        title={`Revoke invitation ${pendingRevokeInviteCode || ''}?`}
        description="Anyone with this invitation code will no longer be able to join the care circle."
        confirmLabel="Revoke Invitation"
        tone="danger"
        busy={busy}
        onCancel={() => setPendingRevokeInviteCode(null)}
        onConfirm={() => {
          if (pendingRevokeInviteCode) {
            handleRevokeInvite(pendingRevokeInviteCode);
          }
        }}
      />
    </div>
  );
};

