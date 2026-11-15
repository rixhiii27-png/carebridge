import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Pill,
  Plus,
  Power,
  ShieldAlert,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmDialog,
  EmptyStateCard,
  PageHeader,
  ReadAloudButton,
} from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { formatCareBridgeError, getTodayDateKey } from '../services/firebase.ts';
import {
  addMedication,
  recordDoseStatus,
  updateMedication,
} from '../services/firestoreService.ts';
import type { DoseStatus, Medication, MedicationFrequency } from '../types/carebridge.ts';

export const MedicationsPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    firebaseUser,
    profile,
    activeGroup,
    currentMember,
    medications,
    medicationLogs,
    searchQuery,
  } = useCareBridge();

  const canEdit =
    currentMember?.role === 'elderly' || currentMember?.canEditMedications === true;

  const [filterTab, setFilterTab] = useState<'active' | 'due' | 'inactive'>('active');
  const [showForm, setShowForm] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const todayStr = getTodayDateKey(activeGroup?.timezone);
  const [frequency, setFrequency] = useState<MedicationFrequency>('once_daily');
  const [timesStr, setTimesStr] = useState('08:00');
  const [startDate, setStartDate] = useState(() => todayStr);
  const [endDate, setEndDate] = useState('');
  const [instructions, setInstructions] = useState('');
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberClinic, setPrescriberClinic] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [confirmToggleMed, setConfirmToggleMed] = useState<Medication | null>(null);
  const [confirmDoseAction, setConfirmDoseAction] = useState<{
    med: Medication;
    time: string;
    status: 'skipped' | 'missed';
  } | null>(null);

  const filteredMeds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return medications.filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.prescriberName || '').toLowerCase().includes(q),
    );
  }, [medications, searchQuery]);

  const activeMeds = filteredMeds.filter((m) => m.active);
  const inactiveMeds = filteredMeds.filter((m) => !m.active);

  const dueMeds = useMemo(
    () =>
      activeMeds.filter((med) =>
        med.scheduleTimes.some((time) => {
          const log = medicationLogs.find(
            (l) =>
              l.medicationId === med.id &&
              l.scheduledDate === todayStr &&
              l.scheduledTime === time,
          );
          return !log || log.status === 'not_confirmed';
        }),
      ),
    [activeMeds, medicationLogs, todayStr],
  );

  const displayedActiveMeds = filterTab === 'due' ? dueMeds : activeMeds;

  const openAddForm = () => {
    setEditingMed(null);
    setName('');
    setDosage('');
    setFrequency('once_daily');
    setTimesStr('08:00');
    setStartDate(todayStr);
    setEndDate('');
    setInstructions('');
    setPrescriberName(activeGroup?.primaryPhysician || '');
    setPrescriberClinic(activeGroup?.primaryClinic || '');
    setErrorMsg(null);
    setShowForm(true);
  };

  const openEditForm = (med: Medication) => {
    setEditingMed(med);
    setName(med.name);
    setDosage(med.dosage);
    setFrequency(med.frequency);
    setTimesStr(med.scheduleTimes.join(', '));
    setStartDate(med.startDate);
    setEndDate(med.endDate || '');
    setInstructions(med.instructions || '');
    setPrescriberName(med.prescriberName || '');
    setPrescriberClinic(med.prescriberClinic || '');
    setErrorMsg(null);
    setShowForm(true);
  };

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4500);
  };

  const handleSaveMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !activeGroup) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const parsedTimes = timesStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d{2}:\d{2}$/.test(s));
      const scheduleTimes = parsedTimes.length > 0 ? parsedTimes : ['08:00'];

      if (editingMed) {
        await updateMedication(
          editingMed.id,
          activeGroup.id,
          activeGroup.memberUids,
          {
            name,
            dosage,
            frequency,
            scheduleTimes,
            startDate,
            endDate: endDate || undefined,
            instructions: instructions || undefined,
            prescriberName: prescriberName || undefined,
            prescriberClinic: prescriberClinic || undefined,
          },
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        );
        showToast(`Updated ${name}.`);
      } else {
        await addMedication({
          groupId: activeGroup.id,
          memberUids: activeGroup.memberUids,
          name,
          dosage,
          frequency,
          scheduleTimes,
          startDate,
          endDate: endDate || undefined,
          instructions: instructions || undefined,
          prescriberName: prescriberName || undefined,
          prescriberClinic: prescriberClinic || undefined,
          actor: { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        });
        showToast(`Added ${name} to schedule.`);
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (med: Medication) => {
    if (!firebaseUser || !profile || !activeGroup) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await updateMedication(
        med.id,
        activeGroup.id,
        activeGroup.memberUids,
        { active: !med.active, name: med.name },
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
      );
      showToast(
        med.active
          ? `${med.name} moved to inactive medications.`
          : `${med.name} reactivated in daily schedule.`,
      );
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      setConfirmToggleMed(null);
    }
  };

  const handleDoseLog = async (med: Medication, time: string, status: DoseStatus) => {
    if (!firebaseUser || !profile || !activeGroup) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await recordDoseStatus({
        groupId: activeGroup.id,
        memberUids: activeGroup.memberUids,
        medicationId: med.id,
        medicationName: med.name,
        scheduledDate: todayStr,
        scheduledTime: time,
        status,
        actor: { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
      });
      showToast(`Recorded ${med.name} (${time}) as ${status}.`);
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      setConfirmDoseAction(null);
    }
  };

  const renderDoseStatus = (status: DoseStatus) => {
    if (status === 'taken') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#383C23]">
          <CheckCircle2 className="w-4 h-4 text-[#71774B] shrink-0" />
          <span>{t('medications.statusTaken')}</span>
        </span>
      );
    }
    if (status === 'skipped') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5D4A44]">
          <SkipForward className="w-4 h-4 text-[#5D4A44] shrink-0" />
          <span>{t('medications.statusSkipped')}</span>
        </span>
      );
    }
    if (status === 'missed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E]">
          <XCircle className="w-4 h-4 text-[#85383E] shrink-0" />
          <span>{t('medications.statusMissed')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E]">
        <Clock className="w-4 h-4 text-[#85383E] shrink-0" />
        <span>Due · {t('medications.statusNotConfirmed')}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('medications.title')}
        subtitle={t('medications.subtitle')}
        icon={<Pill className="w-6 h-6" />}
        actions={
          canEdit ? (
            <button
              type="button"
              onClick={openAddForm}
              className="cb-btn-3d min-h-[48px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              {t('medications.addMedication')}
            </button>
          ) : undefined
        }
      />

      {/* Mandatory Medical Safety Notice */}
      <div className="p-4 rounded-2xl bg-[#FAF7F2] border border-[#85383E]/25 flex items-start gap-3 text-sm text-[#3E0911]">
        <ShieldAlert className="w-5 h-5 text-[#85383E] shrink-0 mt-0.5" />
        <span>{t('medications.safetyNote')}</span>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911] flex items-center gap-2.5"
        >
          <AlertCircle className="w-5 h-5 text-[#85383E] shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-4 rounded-2xl bg-white border border-[#71774B] text-[15px] text-[#383C23] font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Add / Edit Medication Form */}
      {showForm && (
        <form
          onSubmit={handleSaveMedication}
          className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-[#3E0911]">
              {editingMed ? t('medications.editMedication') : t('medications.addMedication')}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-[44px] px-4 rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.nameLabel')} *
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Metformin"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.dosageLabel')} *
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g., 500 mg tablet"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.frequencyLabel')} *
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as MedicationFrequency)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              >
                <option value="once_daily">{t('medications.freq_once_daily')}</option>
                <option value="twice_daily">{t('medications.freq_twice_daily')}</option>
                <option value="three_times_daily">{t('medications.freq_three_times_daily')}</option>
                <option value="weekly">{t('medications.freq_weekly')}</option>
                <option value="as_needed">{t('medications.freq_as_needed')}</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.timesLabel')} *
              </label>
              <input
                type="text"
                required
                value={timesStr}
                onChange={(e) => setTimesStr(e.target.value)}
                placeholder="08:00, 20:00"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  { label: 'Morning (08:00)', value: '08:00' },
                  { label: 'Morning & Night', value: '08:00, 20:00' },
                  { label: '3x Daily', value: '08:00, 14:00, 20:00' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setTimesStr(preset.value)}
                    className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#3E0911]/15 hover:bg-[#E5DDD0] text-xs font-semibold text-[#3E0911] cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.startDateLabel')} *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.endDateLabel')}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.prescriberLabel')}
              </label>
              <input
                type="text"
                maxLength={120}
                value={prescriberName}
                onChange={(e) => setPrescriberName(e.target.value)}
                placeholder="Dr. Ananya Nair"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.clinicLabel')}
              </label>
              <input
                type="text"
                maxLength={160}
                value={prescriberClinic}
                onChange={(e) => setPrescriberClinic(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('medications.instructionsLabel')}
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Take after meals with water..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="cb-btn-3d min-h-[48px] px-6 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-[48px] px-5 py-2.5 rounded-xl border border-[#3E0911]/20 bg-white text-[15px] font-semibold text-[#3E0911] cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Segmented Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filter medications"
        className="inline-flex flex-wrap p-1.5 rounded-2xl bg-[#FAF7F2] border border-[#3E0911]/12 gap-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={filterTab === 'active'}
          onClick={() => setFilterTab('active')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors ${
            filterTab === 'active'
              ? 'bg-[#71774B] text-white'
              : 'text-[#5D4A44] hover:text-[#3E0911]'
          }`}
        >
          {t('medications.activeMeds')} ({activeMeds.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filterTab === 'due'}
          onClick={() => setFilterTab('due')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors ${
            filterTab === 'due'
              ? 'bg-[#85383E] text-white'
              : 'text-[#5D4A44] hover:text-[#3E0911]'
          }`}
        >
          Needs Confirmation ({dueMeds.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filterTab === 'inactive'}
          onClick={() => setFilterTab('inactive')}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors ${
            filterTab === 'inactive'
              ? 'bg-[#383C23] text-white'
              : 'text-[#5D4A44] hover:text-[#3E0911]'
          }`}
        >
          {t('medications.inactiveMeds')} ({inactiveMeds.length})
        </button>
      </div>

      {/* Active / Due Medications View */}
      {filterTab !== 'inactive' ? (
        <section className="space-y-4">
          {displayedActiveMeds.length === 0 ? (
            <EmptyStateCard
              title={
                filterTab === 'due'
                  ? 'All doses for today are confirmed'
                  : t('dashboard.noMedicationsToday')
              }
              description={
                filterTab === 'due'
                  ? 'Every scheduled medication dose for today has already been recorded.'
                  : t('medications.subtitle')
              }
              actionLabel={
                filterTab === 'active' && canEdit ? t('medications.addMedication') : undefined
              }
              onAction={filterTab === 'active' && canEdit ? openAddForm : undefined}
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {displayedActiveMeds.map((med) => (
                <div
                  key={med.id}
                  className="cb-card-3d cb-card-interactive rounded-2xl p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-[#5D4A44] mb-1">
                        <Pill className="w-4 h-4 text-[#71774B] shrink-0" />
                        <span>{t(`medications.freq_${med.frequency}`)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{med.startDate}</span>
                      </div>
                      <h3 className="text-xl font-bold text-[#3E0911]">
                        {med.name}{' '}
                        <span className="font-normal text-[15px] text-[#5D4A44]">
                          — {med.dosage}
                        </span>
                      </h3>
                      {med.prescriberName && (
                        <p className="text-sm text-[#5D4A44] mt-0.5">
                          {med.prescriberName}
                          {med.prescriberClinic ? ` · ${med.prescriberClinic}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <ReadAloudButton
                        compact
                        label={t('dashboard.readAloud')}
                        text={`${med.name}, ${med.dosage}. ${med.instructions || ''}`}
                      />
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditForm(med)}
                            aria-label={`${t('medications.editMedication')} ${med.name}`}
                            title={t('medications.editMedication')}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-[#3E0911] cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmToggleMed(med)}
                            aria-label={`${t('medications.deactivate')} ${med.name}`}
                            title={t('medications.deactivate')}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#85383E]/25 bg-[#F6EAEC] hover:bg-[#85383E] hover:text-white text-[#85383E] cursor-pointer transition-colors"
                          >
                            <Power className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {med.instructions && (
                    <p className="text-sm text-[#3E0911] bg-[#FAF7F2] p-3.5 rounded-xl border border-[#3E0911]/10">
                      {med.instructions}
                    </p>
                  )}

                  {/* Today's Dose Confirmations */}
                  <div className="space-y-3 pt-3 border-t border-[#3E0911]/10">
                    {med.scheduleTimes.map((time) => {
                      const log = medicationLogs.find(
                        (l) =>
                          l.medicationId === med.id &&
                          l.scheduledDate === todayStr &&
                          l.scheduledTime === time,
                      );
                      const status: DoseStatus = log?.status ?? 'not_confirmed';
                      return (
                        <div
                          key={time}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-[#3E0911]/8 last:border-b-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-mono tabular-nums font-bold text-base text-[#3E0911] inline-flex items-center gap-1.5">
                              <Clock className="w-4 h-4 text-[#71774B]" />
                              {time}
                            </span>
                            <span aria-hidden="true">·</span>
                            {renderDoseStatus(status)}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDoseLog(med, time, 'taken')}
                              className={`min-h-[44px] px-3.5 py-2 rounded-xl font-semibold text-sm inline-flex items-center gap-1.5 cursor-pointer ${
                                status === 'taken'
                                  ? 'bg-[#383C23] text-white'
                                  : 'bg-[#71774B] hover:bg-[#5E633D] text-white'
                              }`}
                            >
                              <Check className="w-4 h-4" />
                              {t('medications.markTaken')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmDoseAction({ med, time, status: 'skipped' })
                              }
                              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#FAF7F2] text-[#3E0911] text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <SkipForward className="w-4 h-4" />
                              {t('medications.markSkipped')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setConfirmDoseAction({ med, time, status: 'missed' })
                              }
                              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#85383E]/30 bg-[#F6EAEC] hover:bg-[#85383E]/15 text-[#85383E] text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <XCircle className="w-4 h-4" />
                              {t('medications.markMissed')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        /* Inactive Medications Tab */
        <section className="space-y-4">
          {inactiveMeds.length === 0 ? (
            <EmptyStateCard
              title="No inactive medications"
              description="Paused or discontinued medications appear here so you always keep a clear record."
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {inactiveMeds.map((med) => (
                <div
                  key={med.id}
                  className="cb-card-3d p-5 rounded-2xl flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-base text-[#3E0911]">
                      {med.name} — {med.dosage}
                    </div>
                    <div className="text-sm text-[#5D4A44] mt-0.5 font-mono tabular-nums">
                      {med.scheduleTimes.join(', ')}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setConfirmToggleMed(med)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer"
                    >
                      {t('medications.reactivate')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Responsive Dose History */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold text-[#3E0911] mb-4">
          {t('medications.doseHistory')}
        </h2>
        {medicationLogs.length === 0 ? (
          <p className="text-[15px] text-[#5D4A44]">{t('common.empty')}</p>
        ) : (
          <>
            {/* Mobile Stacked Cards */}
            <div className="md:hidden divide-y divide-[#3E0911]/10">
              {medicationLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-base text-[#3E0911]">
                      {log.medicationName}
                    </span>
                    {renderDoseStatus(log.status)}
                  </div>
                  <div className="text-sm font-mono tabular-nums text-[#5D4A44]">
                    {log.scheduledDate} · {log.scheduledTime}
                  </div>
                  <div className="text-xs text-[#5D4A44]">
                    {t('medications.updatedBy')} {log.updatedByName}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b border-[#3E0911]/15 text-sm text-[#5D4A44]">
                    <th className="py-3 pr-4 font-semibold">{t('medications.nameLabel')}</th>
                    <th className="py-3 pr-4 font-semibold">{t('appointments.dateLabel')}</th>
                    <th className="py-3 pr-4 font-semibold">{t('appointments.timeLabel')}</th>
                    <th className="py-3 pr-4 font-semibold">Status</th>
                    <th className="py-3 font-semibold">{t('medications.updatedBy')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3E0911]/10">
                  {medicationLogs.slice(0, 30).map((log) => (
                    <tr key={log.id} className="hover:bg-[#FAF7F2]">
                      <td className="py-3.5 pr-4 font-semibold text-[#3E0911]">
                        {log.medicationName}
                      </td>
                      <td className="py-3.5 pr-4 font-mono tabular-nums text-sm text-[#5D4A44]">
                        {log.scheduledDate}
                      </td>
                      <td className="py-3.5 pr-4 font-mono tabular-nums text-sm text-[#5D4A44]">
                        {log.scheduledTime}
                      </td>
                      <td className="py-3.5 pr-4">{renderDoseStatus(log.status)}</td>
                      <td className="py-3.5 text-sm text-[#5D4A44]">{log.updatedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirmToggleMed)}
        title={
          confirmToggleMed?.active ? 'Pause this medication?' : 'Reactivate this medication?'
        }
        description={
          confirmToggleMed?.active
            ? `${confirmToggleMed.name} (${confirmToggleMed.dosage}) will be moved to Inactive Medications and will no longer appear in today's reminders. Past history is kept safely.`
            : `Restore ${confirmToggleMed?.name} (${confirmToggleMed?.dosage}) to today's active medication schedule?`
        }
        confirmLabel={
          confirmToggleMed?.active ? t('medications.deactivate') : t('medications.reactivate')
        }
        cancelLabel={t('common.cancel')}
        tone={confirmToggleMed?.active ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => {
          if (confirmToggleMed) handleToggleActive(confirmToggleMed);
        }}
        onCancel={() => setConfirmToggleMed(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmDoseAction)}
        title={
          confirmDoseAction?.status === 'missed'
            ? 'Mark dose as missed?'
            : 'Mark dose as skipped?'
        }
        description={
          confirmDoseAction
            ? `Record ${confirmDoseAction.med.name} scheduled for ${confirmDoseAction.time} as ${confirmDoseAction.status}? Authorized caregivers in your circle can see this status.`
            : ''
        }
        confirmLabel={
          confirmDoseAction?.status === 'missed'
            ? t('medications.markMissed')
            : t('medications.markSkipped')
        }
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (confirmDoseAction) {
            handleDoseLog(
              confirmDoseAction.med,
              confirmDoseAction.time,
              confirmDoseAction.status,
            );
          }
        }}
        onCancel={() => setConfirmDoseAction(null)}
      />
    </div>
  );
};
