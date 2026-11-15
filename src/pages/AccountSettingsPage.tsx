import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Lock,
  Settings,
  Shield,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { deleteMyAccountV1 } from '../services/apiV1Client.ts';
import { formatCareBridgeError } from '../services/firebase.ts';
import { updateUserPreferences } from '../services/firestoreService.ts';

export const AccountSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    firebaseUser,
    profile,
    memberships,
    activeGroupId,
    setActiveGroupId,
    medications,
    appointments,
    logout,
  } = useCareBridge();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [timezone, setTimezone] = useState(profile?.timezone || 'Asia/Kolkata');
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setTimezone(profile.timezone || 'Asia/Kolkata');
    }
  }, [profile]);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setErrorMsg(null);
    try {
      await updateUserPreferences(firebaseUser.uid, {
        displayName: displayName.trim(),
        timezone: timezone.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    }
  };

  const handleExportJson = () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      user: { uid: firebaseUser?.uid, displayName: profile?.displayName, role: profile?.role },
      careGroupCount: memberships.length,
      medications,
      appointments,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carebridge-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmDeleteAccount = async () => {
    setDeletingAccount(true);
    setErrorMsg(null);
    try {
      await deleteMyAccountV1();
      await logout();
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
      setDeletingAccount(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.accountSettings')}
        subtitle="Manage your account profile, active care group, and privacy controls."
        icon={<Settings className="w-6 h-6" />}
      />

      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911] flex items-center gap-2.5"
        >
          <AlertCircle className="w-5 h-5 text-[#85383E] shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="p-4 rounded-xl bg-[#FAF7F2] border border-[#71774B] text-[15px] text-[#383C23] font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span>Account settings saved.</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveAccount} className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#3E0911]">Account Profile</h2>

          <div>
            <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
              {t('appointments.timezoneLabel')}
            </label>
            <input
              type="text"
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono text-[#3E0911]"
            />
          </div>

          <div className="text-sm text-[#5D4A44] pt-1">
            Authenticated Email: <strong className="text-[#3E0911]">{firebaseUser?.email}</strong> · Role:{' '}
            <strong className="capitalize text-[#3E0911]">{profile?.role}</strong>
          </div>

          <button
            type="submit"
            className="cb-btn-3d w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer"
          >
            {t('common.save')}
          </button>
        </form>

        <div className="space-y-6">
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-3">
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#71774B]" />
              Active Care Circle
            </h2>
            {memberships.length > 0 && (
              <select
                value={activeGroupId || ''}
                onChange={(e) => setActiveGroupId(e.target.value)}
                aria-label="Active Care Circle"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              >
                {memberships.map((m) => (
                  <option key={m.groupId} value={m.groupId}>
                    {m.elderlyName} ({m.role})
                  </option>
                ))}
              </select>
            )}
          </section>

          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <Lock className="w-5 h-5 text-[#85383E]" />
              {t('common.privacyNotice')}
            </h2>
            <p className="text-sm text-[#5D4A44] leading-relaxed">
              CareBridge uses Firebase Authentication, role-based Firestore security rules, and split PII isolation. This platform supports care coordination and does not replace professional healthcare.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                onClick={handleExportJson}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#71774B]" />
                Download My Care Data (JSON)
              </button>
              <button
                type="button"
                onClick={logout}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#85383E] hover:bg-[#6D2B30] text-white text-sm font-semibold cursor-pointer"
              >
                {t('nav.logout')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#85383E]/40 bg-[#F6EAEC] hover:bg-[#EDD8DC] text-[#3E0911] text-sm font-semibold cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-[#85383E]" />
                Delete Account
              </button>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Your CareBridge Account?"
        description="This permanently deletes your private profile information, notification preferences, and revokes your active care group memberships. This action cannot be undone."
        confirmLabel="Confirm Permanent Deletion"
        tone="danger"
        busy={deletingAccount}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleConfirmDeleteAccount}
      />
    </div>
  );
};

