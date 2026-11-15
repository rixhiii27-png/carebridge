import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, Lock, Save, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import elderlyAvatar from '../assets/images/avatar_elderly_resident_1794717063448.jpg';
import { PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import {
  getUserPrivateInfo,
  updateCareGroupProfile,
  updateUserPrivateInfo,
} from '../services/firestoreService.ts';

export const CareProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { firebaseUser, profile, activeGroup } = useCareBridge();

  const isGroupOwner = activeGroup?.ownerId === firebaseUser?.uid;

  const [elderlyName, setElderlyName] = useState(activeGroup?.elderlyName || '');
  const [elderlyAge, setElderlyAge] = useState(String(activeGroup?.elderlyAge || 72));
  const [bloodGroup, setBloodGroup] = useState(activeGroup?.bloodGroup || '');
  const [primaryPhysician, setPrimaryPhysician] = useState(activeGroup?.primaryPhysician || '');
  const [primaryClinic, setPrimaryClinic] = useState(activeGroup?.primaryClinic || '');
  const [timezone, setTimezone] = useState(activeGroup?.timezone || 'Asia/Kolkata');
  const [allergiesText, setAllergiesText] = useState((activeGroup?.allergies || []).join(', '));
  const [conditionsText, setConditionsText] = useState((activeGroup?.conditions || []).join(', '));

  // Private PII fields isolated in users/{uid}/private/info
  const [email, setEmail] = useState(firebaseUser?.email || '');
  const [phone, setPhone] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [address, setAddress] = useState('');

  const [busy, setBusy] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeGroup) {
      setElderlyName(activeGroup.elderlyName);
      setElderlyAge(String(activeGroup.elderlyAge));
      setBloodGroup(activeGroup.bloodGroup || '');
      setPrimaryPhysician(activeGroup.primaryPhysician || '');
      setPrimaryClinic(activeGroup.primaryClinic || '');
      setTimezone(activeGroup.timezone);
      setAllergiesText((activeGroup.allergies || []).join(', '));
      setConditionsText((activeGroup.conditions || []).join(', '));
    }
  }, [activeGroup]);

  useEffect(() => {
    if (!firebaseUser) return;
    getUserPrivateInfo(firebaseUser.uid)
      .then((info) => {
        if (info) {
          setEmail(info.email || firebaseUser.email || '');
          setPhone(info.phone || '');
          setEmergencyContact(info.emergencyContact || '');
          setAddress(info.address || '');
        }
      })
      .catch(() => {
        // handled cleanly
      });
  }, [firebaseUser]);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !activeGroup || !isGroupOwner) return;
    setBusy(true);
    setErrorMsg(null);
    setSavedBanner(null);
    try {
      await updateCareGroupProfile(
        activeGroup.id,
        {
          elderlyName,
          elderlyAge: Number(elderlyAge) || 72,
          bloodGroup,
          primaryPhysician,
          primaryClinic,
          timezone,
          allergies: allergiesText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          conditions: conditionsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        activeGroup.memberUids,
      );
      setSavedBanner('Care profile updated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save care profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePrivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setBusy(true);
    setErrorMsg(null);
    setSavedBanner(null);
    try {
      await updateUserPrivateInfo(firebaseUser.uid, {
        email: email || firebaseUser.email || '',
        phone,
        emergencyContact,
        address,
      });
      setSavedBanner('Private contact details saved securely.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save private details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.careProfile')}
        subtitle="Shared resident care summary and strictly isolated personal contact records."
        icon={<UserCheck className="w-6 h-6" />}
      />

      {savedBanner && (
        <div
          role="status"
          className="p-4 rounded-xl bg-[#FAF7F2] border border-[#71774B] text-[15px] font-medium text-[#383C23] flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span>{savedBanner}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911] flex items-center gap-2.5"
        >
          <AlertCircle className="w-5 h-5 text-[#85383E] shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveGroup}
          className="lg:col-span-7 cb-card-3d rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center gap-4 pb-4 border-b border-[#3E0911]/10">
            <img
              src={elderlyAvatar}
              alt={elderlyName || 'Resident'}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover border border-[#3E0911]/15 shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#71774B] shrink-0" />
                Resident Care Summary
              </h2>
              <p className="text-sm text-[#5D4A44] mt-0.5 flex items-center gap-1.5">
                {!isGroupOwner && <Eye className="w-4 h-4 text-[#85383E] shrink-0" />}
                <span>
                  {isGroupOwner
                    ? 'You are the care profile owner and can edit these fields.'
                    : 'View-only for invited members; only the profile owner may modify.'}
                </span>
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('auth.elderlyNameLabel')}
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                required
                value={elderlyName}
                onChange={(e) => setElderlyName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('auth.elderlyAgeLabel')}
              </label>
              <input
                type="number"
                disabled={!isGroupOwner}
                required
                min={1}
                max={130}
                value={elderlyAge}
                onChange={(e) => setElderlyAge(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base tabular-nums text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Blood Group
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                placeholder="O+, A+, B+"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.timezoneLabel')}
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('auth.primaryPhysicianLabel')}
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={primaryPhysician}
                onChange={(e) => setPrimaryPhysician(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.clinicLabel')}
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={primaryClinic}
                onChange={(e) => setPrimaryClinic(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Allergies (comma-separated)
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={allergiesText}
                onChange={(e) => setAllergiesText(e.target.value)}
                placeholder="Penicillin, Sulfa drugs"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Ongoing Conditions (comma-separated)
              </label>
              <input
                type="text"
                disabled={!isGroupOwner}
                value={conditionsText}
                onChange={(e) => setConditionsText(e.target.value)}
                placeholder="Hypertension, Diabetes"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911] disabled:opacity-75"
              />
            </div>
          </div>

          {isGroupOwner && (
            <button
              type="submit"
              disabled={busy}
              className="cb-btn-3d w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {t('common.save')}
            </button>
          )}
        </form>

        {/* Owner-Only Private PII Panel */}
        <form
          onSubmit={handleSavePrivate}
          className="lg:col-span-5 cb-card-3d rounded-2xl p-5 sm:p-6 space-y-5 h-fit"
        >
          <div className="pb-4 border-b border-[#3E0911]/10">
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <Lock className="w-5 h-5 text-[#85383E] shrink-0" />
              Private Contact & Emergency Details
            </h2>
            <p className="text-sm text-[#5D4A44] mt-1">
              Stored in an isolated owner-only subcollection. Other members cannot read these fields.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">Phone</label>
              <input
                type="tel"
                maxLength={32}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Emergency Contact
              </label>
              <input
                type="text"
                maxLength={160}
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="Name & Phone"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                Home Address
              </label>
              <textarea
                rows={2}
                maxLength={250}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base text-[#3E0911]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="cb-btn-3d w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#383C23] hover:bg-[#2A2D1A] text-white text-[15px] font-semibold cursor-pointer disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            Save Private Info
          </button>
        </form>
      </div>
    </div>
  );
};

