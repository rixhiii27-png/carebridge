import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileBarChart2,
  Pill,
  ShieldCheck,
  SkipForward,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import elderlyAvatar from '../assets/images/avatar_elderly_resident_1794717063448.jpg';
import caregiverAvatar from '../assets/images/avatar_family_caregiver_1794717064846.jpg';
import { ConfirmDialog, ReadAloudButton } from '../components/common/AccessibleWidgets.tsx';
import { AdherenceChart } from '../components/dashboard/AdherenceChart.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getLanguageMeta } from '../i18n/languages.ts';
import { formatCareBridgeError, getTodayDateKey } from '../services/firebase.ts';
import { markNotificationRead, recordDoseStatus } from '../services/firestoreService.ts';
import type { DoseStatus } from '../types/carebridge.ts';

interface TodayDoseSlot {
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: string;
  instructions?: string;
  status: DoseStatus;
  updatedByName?: string;
}

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    firebaseUser,
    profile,
    activeGroup,
    members,
    medications,
    medicationLogs,
    appointments,
    notifications,
    activityLogs,
    languageCode,
    searchQuery,
    retrySync,
  } = useCareBridge();

  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [pendingSkipSlot, setPendingSkipSlot] = useState<TodayDoseSlot | null>(null);

  const localeTag = getLanguageMeta(languageCode).bcp47;
  const todayStr = getTodayDateKey(activeGroup?.timezone);

  const todayDoses = useMemo<TodayDoseSlot[]>(() => {
    const activeMeds = medications.filter((m) => m.active);
    const q = searchQuery.trim().toLowerCase();
    const slots: TodayDoseSlot[] = [];

    for (const med of activeMeds) {
      if (
        q &&
        !med.name.toLowerCase().includes(q) &&
        !(med.prescriberName || '').toLowerCase().includes(q)
      ) {
        continue;
      }
      for (const time of med.scheduleTimes) {
        const log = medicationLogs.find(
          (l) =>
            l.medicationId === med.id &&
            l.scheduledDate === todayStr &&
            l.scheduledTime === time,
        );
        slots.push({
          medicationId: med.id,
          medicationName: med.name,
          dosage: med.dosage,
          scheduledTime: time,
          instructions: med.instructions,
          status: log?.status ?? 'not_confirmed',
          updatedByName: log?.updatedByName,
        });
      }
    }

    slots.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    return slots;
  }, [medications, medicationLogs, todayStr, searchQuery]);

  const upcomingAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appointments
      .filter((a) => a.status === 'scheduled' && a.appointmentDate >= todayStr)
      .filter(
        (a) =>
          !q ||
          a.doctorName.toLowerCase().includes(q) ||
          a.clinicName.toLowerCase().includes(q),
      )
      .slice(0, 4);
  }, [appointments, todayStr, searchQuery]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read).slice(0, 4),
    [notifications],
  );

  const takenCount = todayDoses.filter((d) => d.status === 'taken').length;
  const unconfirmedCount = todayDoses.filter((d) => d.status === 'not_confirmed').length;
  const nextPendingDose = todayDoses.find((d) => d.status === 'not_confirmed') || null;
  const nextAppointment = upcomingAppointments[0] || null;

  const formattedDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(localeTag, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: activeGroup?.timezone || undefined,
      }).format(new Date());
    } catch {
      return todayStr;
    }
  }, [localeTag, todayStr, activeGroup?.timezone]);

  const handleLogDose = async (slot: TodayDoseSlot, status: DoseStatus) => {
    if (!firebaseUser || !activeGroup || !profile) return;
    const key = `${slot.medicationId}_${slot.scheduledTime}`;
    setBusySlot(key);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      await recordDoseStatus({
        groupId: activeGroup.id,
        memberUids: activeGroup.memberUids,
        medicationId: slot.medicationId,
        medicationName: slot.medicationName,
        scheduledDate: todayStr,
        scheduledTime: slot.scheduledTime,
        status,
        actor: {
          uid: firebaseUser.uid,
          name: profile.displayName,
          role: profile.role,
        },
      });
      setFeedbackMsg(
        status === 'taken'
          ? `Recorded ${slot.medicationName} (${slot.scheduledTime}) as taken.`
          : `Recorded ${slot.medicationName} (${slot.scheduledTime}) as skipped.`,
      );
      setTimeout(() => setFeedbackMsg(null), 4000);
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusySlot(null);
      setPendingSkipSlot(null);
    }
  };

  const renderStatusIndicator = (status: DoseStatus) => {
    switch (status) {
      case 'taken':
        return (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#383C23]">
            <CheckCircle2 className="w-4 h-4 text-[#71774B] shrink-0" />
            <span>{t('medications.statusTaken')}</span>
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5D4A44]">
            <SkipForward className="w-4 h-4 text-[#5D4A44] shrink-0" />
            <span>{t('medications.statusSkipped')}</span>
          </span>
        );
      case 'missed':
        return (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E]">
            <AlertCircle className="w-4 h-4 text-[#85383E] shrink-0" />
            <span>{t('medications.statusMissed')}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E]">
            <Clock className="w-4 h-4 text-[#85383E] shrink-0" />
            <span>Due · {t('medications.statusNotConfirmed')}</span>
          </span>
        );
    }
  };

  if (!activeGroup) {
    return (
      <div className="cb-card-3d rounded-2xl p-8 text-center space-y-4">
        <h2 className="text-xl font-bold text-[#3E0911]">{t('common.loading')}</h2>
        <p className="text-[15px] text-[#5D4A44]">Syncing your active Care Circle record...</p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={retrySync}
            className="cb-btn-3d min-h-[44px] px-5 py-2.5 rounded-xl bg-[#71774B] text-white text-sm font-semibold cursor-pointer"
          >
            Retry Sync
          </button>
          <Link
            to="/account"
            className="min-h-[44px] inline-flex items-center px-5 py-2.5 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] text-sm font-semibold text-[#3E0911]"
          >
            Select Care Circle
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911] flex items-center gap-2.5"
        >
          <AlertCircle className="w-5 h-5 text-[#85383E] shrink-0" />
          <span className="min-w-0 break-words">{errorMsg}</span>
        </div>
      )}

      {feedbackMsg && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-white border border-[#71774B] text-[15px] text-[#383C23] font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span className="min-w-0 break-words">{feedbackMsg}</span>
        </div>
      )}

      {/* A. Top Context Hero: Resident Greeting, Date, Clinical Context & Audio Readout */}
      <section className="cb-hero-3d rounded-3xl p-5 sm:p-6 lg:p-7">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 sm:gap-5 min-w-0">
            <img
              src={elderlyAvatar}
              alt={activeGroup.elderlyName}
              referrerPolicy="no-referrer"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border border-[#3E0911]/15 shadow-sm shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#5D4A44] mb-1 break-words">
                {formattedDate} · {activeGroup.timezone}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#3E0911] leading-tight break-words">
                {t('dashboard.greeting')}, {activeGroup.elderlyName}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[#5D4A44] mt-2">
                <span>
                  {t('auth.elderlyAgeLabel')}:{' '}
                  <strong className="text-[#3E0911] tabular-nums">{activeGroup.elderlyAge}</strong>
                </span>
                {activeGroup.bloodGroup && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Blood Group:{' '}
                      <strong className="text-[#3E0911]">{activeGroup.bloodGroup}</strong>
                    </span>
                  </>
                )}
                {activeGroup.primaryPhysician && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('auth.primaryPhysicianLabel')}:{' '}
                      <strong className="text-[#3E0911]">{activeGroup.primaryPhysician}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <ReadAloudButton
              label={t('dashboard.readAloud')}
              text={`${t('dashboard.greeting')} ${activeGroup.elderlyName}. ${t('dashboard.scheduledDoses')}: ${todayDoses.length}. ${t('dashboard.confirmedTaken')}: ${takenCount}. ${t('dashboard.unconfirmedDoses')}: ${unconfirmedCount}.`}
            />
            <Link
              to="/accessibility"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 text-[#71774B]" />
              Accessibility
            </Link>
            <Link
              to="/profile"
              className="min-h-[44px] inline-flex items-center px-4 py-2 rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] transition-colors whitespace-nowrap"
            >
              {t('nav.careProfile')}
            </Link>
          </div>
        </div>

        {/* Clinical Context Strip */}
        {((activeGroup.allergies && activeGroup.allergies.length > 0) ||
          (activeGroup.conditions && activeGroup.conditions.length > 0)) && (
          <div className="grid sm:grid-cols-2 gap-3 mt-5 pt-5 border-t border-[#3E0911]/10">
            <div className="p-3.5 rounded-2xl bg-[#F6EAEC]/70 border border-[#85383E]/25">
              <div className="text-xs font-bold uppercase tracking-wider text-[#85383E] mb-1">
                Known Allergies
              </div>
              <div className="text-sm font-semibold text-[#3E0911]">
                {activeGroup.allergies && activeGroup.allergies.length > 0
                  ? activeGroup.allergies.join(' · ')
                  : 'No allergies recorded'}
              </div>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#FAF7F2] border border-[#71774B]/25">
              <div className="text-xs font-bold uppercase tracking-wider text-[#383C23] mb-1">
                Health Focus &amp; Conditions
              </div>
              <div className="text-sm font-semibold text-[#3E0911]">
                {activeGroup.conditions && activeGroup.conditions.length > 0
                  ? activeGroup.conditions.join(' · ')
                  : 'General elderly wellness'}
              </div>
            </div>
          </div>
        )}

        {/* Priority Guidance Banner: Answers "What needs attention today?" & "What is next?" */}
        <div
          className={`mt-5 p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            unconfirmedCount > 0 || unreadNotifications.length > 0
              ? 'bg-[#F6EAEC]/75 border-[#85383E]/25'
              : 'bg-[#FAF7F2] border-[#71774B]/30'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {unconfirmedCount > 0 ? (
              <Clock className="w-5 h-5 text-[#85383E] shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0 mt-0.5" />
            )}
            <div className="text-[15px] text-[#3E0911] min-w-0 flex-1 break-words">
              {nextPendingDose ? (
                <span>
                  <strong>Next dose:</strong> {nextPendingDose.medicationName} ({nextPendingDose.dosage}) at{' '}
                  <span className="font-mono tabular-nums font-bold">
                    {nextPendingDose.scheduledTime}
                  </span>
                  {unconfirmedCount > 1
                    ? ` · ${unconfirmedCount} doses still awaiting confirmation today.`
                    : '.'}
                </span>
              ) : todayDoses.length > 0 ? (
                <span>
                  <strong>All {todayDoses.length} scheduled doses</strong> for today have been recorded.
                </span>
              ) : (
                <span>No medications scheduled for today yet.</span>
              )}
              {nextAppointment && (
                <div className="text-sm text-[#5D4A44] mt-0.5">
                  Next visit: <strong>{nextAppointment.doctorName}</strong> on{' '}
                  <span className="font-mono tabular-nums">
                    {nextAppointment.appointmentDate} · {nextAppointment.appointmentTime}
                  </span>
                </div>
              )}
            </div>
          </div>
          {nextPendingDose && (
            <button
              type="button"
              disabled={busySlot === `${nextPendingDose.medicationId}_${nextPendingDose.scheduledTime}`}
              onClick={() => handleLogDose(nextPendingDose, 'taken')}
              className="cb-btn-3d min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Check className="w-4 h-4" />
              Confirm Next Dose
            </button>
          )}
        </div>

        {/* Today's Care Overview Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-5 pt-5 border-t border-[#3E0911]/10">
          <div className="cb-stat-tile-3d p-4 rounded-2xl">
            <div className="text-sm font-medium text-[#5D4A44]">{t('dashboard.scheduledDoses')}</div>
            <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#3E0911] mt-1">
              {todayDoses.length}
            </div>
          </div>
          <div className="cb-stat-tile-3d p-4 rounded-2xl">
            <div className="text-sm font-medium text-[#5D4A44]">{t('dashboard.confirmedTaken')}</div>
            <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#71774B] mt-1">
              {takenCount}
            </div>
          </div>
          <div className="cb-stat-tile-3d p-4 rounded-2xl">
            <div className="text-sm font-medium text-[#5D4A44]">
              {t('dashboard.unconfirmedDoses')}
            </div>
            <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#85383E] mt-1">
              {unconfirmedCount}
            </div>
          </div>
          <div className="cb-stat-tile-3d p-4 rounded-2xl">
            <div className="text-sm font-medium text-[#5D4A44]">{t('dashboard.upcomingVisits')}</div>
            <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-[#3E0911] mt-1">
              {upcomingAppointments.length}
            </div>
          </div>
        </div>
      </section>

      {/* Quick Actions Bar (Thumb & Desktop Friendly) */}
      <section
        aria-label="Quick care actions"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
      >
        <Link
          to="/medications"
          className="cb-card-3d cb-card-interactive rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-h-[68px] h-full min-w-0"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#71774B]/15 text-[#383C23] flex items-center justify-center shrink-0">
            <Pill className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[15px] text-[#3E0911] leading-snug break-words">
              {t('nav.medications')}
            </div>
            <div className="text-xs text-[#5D4A44] leading-snug break-words">
              Doses &amp; schedules
            </div>
          </div>
        </Link>

        <Link
          to="/appointments"
          className="cb-card-3d cb-card-interactive rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-h-[68px] h-full min-w-0"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#E5DDD0] text-[#3E0911] flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[15px] text-[#3E0911] leading-snug break-words">
              {t('nav.appointments')}
            </div>
            <div className="text-xs text-[#5D4A44] leading-snug break-words">Doctor visits</div>
          </div>
        </Link>

        <Link
          to="/family"
          className="cb-card-3d cb-card-interactive rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-h-[68px] h-full min-w-0"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#71774B]/15 text-[#383C23] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[15px] text-[#3E0911] leading-snug break-words">
              Care Circle
            </div>
            <div className="text-xs text-[#5D4A44] leading-snug break-words">
              Family &amp; helpers
            </div>
          </div>
        </Link>

        <Link
          to="/reports"
          className="cb-card-3d cb-card-interactive rounded-2xl p-3.5 sm:p-4 flex items-center gap-3 min-h-[68px] h-full min-w-0"
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#F6EAEC] text-[#85383E] flex items-center justify-center shrink-0">
            <FileBarChart2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[15px] text-[#3E0911] leading-snug break-words">
              Care Summary
            </div>
            <div className="text-xs text-[#5D4A44] leading-snug break-words">7-day insights</div>
          </div>
        </Link>
      </section>

      {/* Main 12-Column Structured Dashboard Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left/Center 7 Columns: Today's Medication Schedule + Adherence Overview */}
        <div className="xl:col-span-7 space-y-6 min-w-0">
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-5">
              <div className="flex items-center gap-2.5 min-w-0">
                <Pill className="w-5 h-5 text-[#71774B] shrink-0" />
                <h2 className="font-display text-xl font-bold text-[#3E0911] leading-snug break-words">
                  {t('dashboard.medicationSchedule')}
                </h2>
              </div>
              <Link
                to="/medications"
                className="min-h-[44px] inline-flex items-center gap-1 text-sm font-semibold text-[#71774B] hover:underline whitespace-nowrap shrink-0"
              >
                <span>{t('nav.medications')}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {todayDoses.length === 0 ? (
              <div className="py-8 text-center text-[15px] text-[#5D4A44]">
                <p className="mb-4">{t('dashboard.noMedicationsToday')}</p>
                <Link
                  to="/medications"
                  className="cb-btn-3d min-h-[48px] inline-flex items-center px-5 py-2.5 rounded-xl bg-[#71774B] text-white text-sm font-semibold"
                >
                  {t('medications.addMedication')}
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-[#3E0911]/10">
                {todayDoses.map((slot) => {
                  const slotKey = `${slot.medicationId}_${slot.scheduledTime}`;
                  const isBusy = busySlot === slotKey;
                  return (
                    <div
                      key={slotKey}
                      className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-center justify-between gap-3.5 sm:gap-4"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-[#5D4A44]">
                          <span className="inline-flex items-center gap-1.5 font-mono tabular-nums font-bold text-[#3E0911]">
                            <Clock className="w-4 h-4 text-[#71774B] shrink-0" />
                            {slot.scheduledTime}
                          </span>
                          <span aria-hidden="true">·</span>
                          {renderStatusIndicator(slot.status)}
                        </div>
                        <div className="font-bold text-base sm:text-lg text-[#3E0911] break-words">
                          {slot.medicationName}{' '}
                          <span className="font-normal text-[15px] text-[#5D4A44]">
                            — {slot.dosage}
                          </span>
                        </div>
                        {slot.instructions && (
                          <p className="text-sm text-[#5D4A44] break-words">{slot.instructions}</p>
                        )}
                        {slot.updatedByName && slot.status !== 'not_confirmed' && (
                          <p className="text-xs text-[#5D4A44] break-words">
                            {t('medications.updatedBy')} {slot.updatedByName}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <ReadAloudButton
                          compact
                          label={t('dashboard.readAloud')}
                          text={`${slot.scheduledTime}: ${slot.medicationName}, ${slot.dosage}. ${slot.instructions || ''}`}
                        />
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleLogDose(slot, 'taken')}
                          className={`cb-btn-3d min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer whitespace-nowrap ${
                            slot.status === 'taken'
                              ? 'bg-[#383C23] text-white'
                              : 'bg-[#71774B] hover:bg-[#5E633D] text-white'
                          }`}
                        >
                          <Check className="w-4 h-4 shrink-0" />
                          {t('medications.markTaken')}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setPendingSkipSlot(slot)}
                          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap"
                        >
                          <SkipForward className="w-4 h-4 shrink-0" />
                          {t('medications.markSkipped')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <AdherenceChart
            medications={medications}
            logs={medicationLogs}
            localeTag={localeTag}
            timezone={activeGroup.timezone}
          />
        </div>

        {/* Right 5 Columns: Appointments, Notifications, Caregivers, Timeline */}
        <div className="xl:col-span-5 space-y-6 min-w-0">
          {/* Upcoming Appointments */}
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <Stethoscope className="w-5 h-5 text-[#71774B] shrink-0" />
                <h2 className="font-display text-xl font-bold text-[#3E0911] leading-snug break-words">
                  {t('dashboard.upcomingAppointments')}
                </h2>
              </div>
              <Link
                to="/appointments"
                className="min-h-[44px] inline-flex items-center gap-1 text-sm font-semibold text-[#71774B] hover:underline whitespace-nowrap shrink-0"
              >
                <span>{t('nav.appointments')}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {upcomingAppointments.length === 0 ? (
              <p className="text-[15px] text-[#5D4A44] py-3">
                {t('dashboard.noAppointmentsUpcoming')}
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingAppointments.map((apt) => (
                  <div
                    key={apt.id}
                    className="p-4 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 space-y-1 min-w-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-[#5D4A44]">
                      <span className="inline-flex items-center gap-1.5 font-mono tabular-nums font-bold text-[#383C23]">
                        <Calendar className="w-4 h-4 text-[#71774B] shrink-0" />
                        {apt.appointmentDate} · {apt.appointmentTime}
                      </span>
                      <span className="break-words">{apt.timezone}</span>
                    </div>
                    <div className="font-bold text-base text-[#3E0911] break-words">
                      {apt.doctorName}
                    </div>
                    <div className="text-sm text-[#5D4A44] break-words">
                      {apt.clinicName}
                      {apt.specialty ? ` · ${apt.specialty}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Important Notifications */}
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bell className="w-5 h-5 text-[#85383E] shrink-0" />
                <h2 className="font-display text-xl font-bold text-[#3E0911] leading-snug break-words">
                  {t('dashboard.importantNotifications')}
                </h2>
              </div>
              <Link
                to="/notifications"
                className="min-h-[44px] inline-flex items-center gap-1 text-sm font-semibold text-[#71774B] hover:underline whitespace-nowrap shrink-0"
              >
                <span>{t('nav.notifications')}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {unreadNotifications.length === 0 ? (
              <p className="text-[15px] text-[#5D4A44] py-2">{t('dashboard.noNotifications')}</p>
            ) : (
              <div className="space-y-3">
                {unreadNotifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-4 rounded-xl bg-[#F6EAEC] border border-[#85383E]/25 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-[#3E0911] break-words">{n.title}</div>
                      <div className="text-sm text-[#5D4A44] mt-1 leading-snug break-words">
                        {n.message}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => markNotificationRead(n.id)}
                      className="min-h-[44px] px-3 rounded-lg bg-white border border-[#85383E]/25 text-xs font-semibold text-[#85383E] hover:bg-[#FAF7F2] shrink-0 self-start cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Family & Caregiver Activity */}
          <section className="cb-card-3d rounded-2xl p-5 sm:p-6 w-full min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <Users className="w-5 h-5 text-[#71774B] shrink-0" />
                <h2 className="font-display text-xl font-bold text-[#3E0911] leading-snug break-words">
                  {t('dashboard.familyActivity')}
                </h2>
              </div>
              <Link
                to="/family"
                className="min-h-[44px] inline-flex items-center gap-1 text-sm font-semibold text-[#71774B] hover:underline whitespace-nowrap shrink-0"
              >
                <span>{t('nav.familyCaregivers')}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex items-start sm:items-center gap-3.5 p-3.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 mb-4">
              <img
                src={caregiverAvatar}
                alt="Care circle coordinator"
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-xl object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-[#3E0911]">
                  {members.filter((m) => m.status === 'active').length}{' '}
                  {t('caregivers.activeMembers')}
                </div>
                <div className="text-sm text-[#5D4A44] leading-snug break-words">
                  {members
                    .filter((m) => m.status === 'active')
                    .map((m) => m.displayName)
                    .join(' · ') || profile?.displayName}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-[#5D4A44] flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-[#71774B] shrink-0" />
                <span>{t('dashboard.recentTimeline')}</span>
              </h3>
              <Link
                to="/activity"
                className="text-xs font-semibold text-[#71774B] hover:underline whitespace-nowrap shrink-0"
              >
                Full log →
              </Link>
            </div>

            {activityLogs.length === 0 ? (
              <p className="text-sm text-[#5D4A44]">{t('dashboard.noActivityYet')}</p>
            ) : (
              <ul className="space-y-3">
                {activityLogs.slice(0, 5).map((item) => (
                  <li
                    key={item.id}
                    className="text-sm pb-3 border-b border-[#3E0911]/10 last:border-b-0 last:pb-0 min-w-0"
                  >
                    <div className="font-semibold text-[#3E0911] break-words">{item.summary}</div>
                    <div className="text-xs text-[#5D4A44] mt-0.5 break-words">
                      {item.actorName} ({item.actorRole})
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingSkipSlot)}
        title="Skip scheduled dose?"
        description={
          pendingSkipSlot
            ? `Are you sure you want to record ${pendingSkipSlot.medicationName} (${pendingSkipSlot.dosage}) at ${pendingSkipSlot.scheduledTime} as skipped? Caregivers in this circle may see this update.`
            : ''
        }
        confirmLabel="Yes, Mark Skipped"
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={Boolean(busySlot)}
        onConfirm={() => {
          if (pendingSkipSlot) {
            handleLogDose(pendingSkipSlot, 'skipped');
          }
        }}
        onCancel={() => setPendingSkipSlot(null)}
      />
    </div>
  );
};
