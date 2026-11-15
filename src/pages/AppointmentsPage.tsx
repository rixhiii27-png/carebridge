import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  MapPin,
  Plus,
  Stethoscope,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmDialog,
  EmptyStateCard,
  PageHeader,
} from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getLanguageMeta } from '../i18n/languages.ts';
import { formatCareBridgeError, getTodayDateKey } from '../services/firebase.ts';
import { createAppointment, updateAppointment } from '../services/firestoreService.ts';
import type { Appointment } from '../types/carebridge.ts';

export const AppointmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const {
    firebaseUser,
    profile,
    activeGroup,
    currentMember,
    appointments,
    languageCode,
    searchQuery,
  } = useCareBridge();

  const canEdit =
    currentMember?.role === 'elderly' || currentMember?.canEditAppointments === true;

  const localeTag = getLanguageMeta(languageCode).bcp47;
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [showForm, setShowForm] = useState(false);
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);
  const [confirmStatusAction, setConfirmStatusAction] = useState<{
    apt: Appointment;
    status: 'completed' | 'cancelled';
  } | null>(null);

  const todayStr = getTodayDateKey(activeGroup?.timezone);
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [appointmentDate, setAppointmentDate] = useState(() => todayStr);
  const [appointmentTime, setAppointmentTime] = useState('10:30');
  const [timezone, setTimezone] = useState(
    () =>
      activeGroup?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  );
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState('60');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const formatDateDisplay = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
      return new Intl.DateTimeFormat(localeTag, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(dt);
    } catch {
      return dateStr;
    }
  };

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4500);
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return appointments.filter(
      (a) =>
        !q ||
        a.doctorName.toLowerCase().includes(q) ||
        a.clinicName.toLowerCase().includes(q) ||
        (a.specialty || '').toLowerCase().includes(q),
    );
  }, [appointments, searchQuery]);

  const upcoming = filtered.filter(
    (a) => a.status === 'scheduled' && a.appointmentDate >= todayStr,
  );
  const history = filtered.filter(
    (a) => a.status !== 'scheduled' || a.appointmentDate < todayStr,
  );

  const openNew = () => {
    setEditingApt(null);
    setDoctorName('');
    setSpecialty('');
    setClinicName(activeGroup?.primaryClinic || '');
    setAppointmentDate(todayStr);
    setAppointmentTime('10:30');
    setTimezone(activeGroup?.timezone || 'Asia/Kolkata');
    setReminderMinutesBefore('60');
    setNotes('');
    setErrorMsg(null);
    setShowForm(true);
  };

  const openEdit = (apt: Appointment) => {
    setEditingApt(apt);
    setDoctorName(apt.doctorName);
    setSpecialty(apt.specialty || '');
    setClinicName(apt.clinicName);
    setAppointmentDate(apt.appointmentDate);
    setAppointmentTime(apt.appointmentTime);
    setTimezone(apt.timezone);
    setReminderMinutesBefore(String(apt.reminderMinutesBefore));
    setNotes(apt.notes || '');
    setErrorMsg(null);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !activeGroup) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      if (editingApt) {
        await updateAppointment(
          editingApt.id,
          activeGroup.id,
          activeGroup.memberUids,
          {
            doctorName,
            specialty: specialty || undefined,
            clinicName,
            appointmentDate,
            appointmentTime,
            timezone,
            reminderMinutesBefore: Number(reminderMinutesBefore) || 60,
            notes: notes || undefined,
          },
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        );
        showToast(`Updated appointment with ${doctorName}.`);
      } else {
        await createAppointment({
          groupId: activeGroup.id,
          memberUids: activeGroup.memberUids,
          doctorName,
          specialty: specialty || undefined,
          clinicName,
          appointmentDate,
          appointmentTime,
          timezone,
          notes: notes || undefined,
          reminderMinutesBefore: Number(reminderMinutesBefore) || 60,
          actor: { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        });
        showToast(`Scheduled visit with ${doctorName}.`);
      }
      setShowForm(false);
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (
    apt: Appointment,
    status: 'completed' | 'cancelled',
  ) => {
    if (!firebaseUser || !profile || !activeGroup) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await updateAppointment(
        apt.id,
        activeGroup.id,
        activeGroup.memberUids,
        { status, doctorName: apt.doctorName },
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
      );
      if (selectedApt?.id === apt.id) {
        setSelectedApt({ ...apt, status });
      }
      showToast(
        status === 'completed'
          ? `Marked visit with ${apt.doctorName} as completed.`
          : `Cancelled appointment with ${apt.doctorName}.`,
      );
    } catch (err) {
      setErrorMsg(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      setConfirmStatusAction(null);
    }
  };

  const calendarCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr?: string; items: Appointment[] }> = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ day: null, items: [] });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const items = filtered.filter((a) => a.appointmentDate === dateStr);
      cells.push({ day: d, dateStr, items });
    }
    return cells;
  }, [calMonth, filtered]);

  const selectedDayAppointments = useMemo(() => {
    if (!selectedCalDate) return [];
    return filtered.filter((a) => a.appointmentDate === selectedCalDate);
  }, [filtered, selectedCalDate]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('appointments.title')}
        subtitle={t('appointments.subtitle')}
        icon={<CalendarIcon className="w-6 h-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex p-1 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/15">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer ${
                  viewMode === 'list' ? 'bg-[#71774B] text-white' : 'text-[#5D4A44]'
                }`}
              >
                {t('appointments.listView')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer ${
                  viewMode === 'calendar' ? 'bg-[#71774B] text-white' : 'text-[#5D4A44]'
                }`}
              >
                {t('appointments.calendarView')}
              </button>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openNew}
                className="cb-btn-3d min-h-[48px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-5 h-5" />
                {t('appointments.scheduleAppointment')}
              </button>
            )}
          </div>
        }
      />

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

      {showForm && (
        <form onSubmit={handleSave} className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-[#3E0911]">
              {editingApt ? t('common.edit') : t('appointments.scheduleAppointment')}
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
                {t('appointments.doctorName')} *
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Dr. Ananya Nair"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.specialty')}
              </label>
              <input
                type="text"
                maxLength={80}
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Cardiology / General Medicine"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.clinicName')} *
              </label>
              <input
                type="text"
                required
                maxLength={160}
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Clinic or Hospital"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.dateLabel')} *
              </label>
              <input
                type="date"
                required
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.timeLabel')} *
              </label>
              <input
                type="time"
                required
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.timezoneLabel')} *
              </label>
              <input
                type="text"
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.reminderLabel')}
              </label>
              <select
                value={reminderMinutesBefore}
                onChange={(e) => setReminderMinutesBefore(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base"
              >
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="120">2 hours before</option>
                <option value="1440">1 day before</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.notesLabel')}
              </label>
              <input
                type="text"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Questions for the doctor, documents to carry..."
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

      {viewMode === 'calendar' ? (
        <section className="cb-card-3d rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-[#3E0911]">
              {calMonth.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))
                }
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] cursor-pointer"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))
                }
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] cursor-pointer"
                aria-label="Next month"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-[#5D4A44]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="text-center py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {calendarCells.map((cell, idx) => {
              const isSelected = Boolean(cell.dateStr && selectedCalDate === cell.dateStr);
              const hasItems = cell.items.length > 0;
              return (
                <div
                  key={idx}
                  className={`min-h-[54px] sm:min-h-[88px] p-1.5 sm:p-2 rounded-xl border transition-colors ${
                    !cell.day
                      ? 'bg-transparent border-transparent'
                      : isSelected
                        ? 'bg-[#71774B]/15 border-[#71774B]'
                        : 'bg-[#FAF7F2] border-[#3E0911]/10'
                  }`}
                >
                  {cell.day && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedCalDate(cell.dateStr || null)}
                        className="w-full text-left flex items-center justify-between cursor-pointer"
                      >
                        <span className="text-xs sm:text-sm font-mono tabular-nums font-bold text-[#3E0911]">
                          {cell.day}
                        </span>
                        {hasItems && (
                          <span className="sm:hidden w-2 h-2 rounded-full bg-[#71774B]" />
                        )}
                      </button>

                      {/* Desktop appointment buttons inside cell */}
                      <div className="hidden sm:block space-y-1 mt-1">
                        {cell.items.map((apt) => (
                          <button
                            key={apt.id}
                            type="button"
                            onClick={() => setSelectedApt(apt)}
                            className={`w-full text-left px-2 py-1 rounded-md text-xs font-medium truncate cursor-pointer ${
                              apt.status === 'cancelled'
                                ? 'bg-[#F6EAEC] text-[#85383E] line-through'
                                : 'bg-[#71774B] text-white'
                            }`}
                          >
                            {apt.appointmentTime} {apt.doctorName}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mobile Day Detail Panel when tapping a calendar day */}
          {selectedCalDate && (
            <div className="pt-4 border-t border-[#3E0911]/10 space-y-3">
              <h3 className="text-base font-bold text-[#3E0911]">
                {formatDateDisplay(selectedCalDate)}
              </h3>
              {selectedDayAppointments.length === 0 ? (
                <p className="text-sm text-[#5D4A44]">No appointments scheduled on this date.</p>
              ) : (
                <div className="space-y-2.5">
                  {selectedDayAppointments.map((apt) => (
                    <button
                      key={apt.id}
                      type="button"
                      onClick={() => setSelectedApt(apt)}
                      className="w-full text-left p-4 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/15 flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div>
                        <div className="font-bold text-base text-[#3E0911]">
                          {apt.doctorName}
                        </div>
                        <div className="text-sm text-[#5D4A44]">
                          {apt.appointmentTime} · {apt.clinicName}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-[#71774B]">Details →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold text-[#3E0911]">
              {t('appointments.upcoming')} ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <EmptyStateCard
                title={t('dashboard.noAppointmentsUpcoming')}
                description={t('appointments.subtitle')}
                actionLabel={canEdit ? t('appointments.scheduleAppointment') : undefined}
                onAction={canEdit ? openNew : undefined}
              />
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {upcoming.map((apt) => (
                  <div
                    key={apt.id}
                    className="cb-card-3d cb-card-interactive rounded-2xl p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-[#5D4A44] mb-1.5">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#383C23]">
                            <CalendarIcon className="w-4 h-4 text-[#71774B]" />
                            {formatDateDisplay(apt.appointmentDate)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums font-semibold text-[#3E0911]">
                            <Clock className="w-4 h-4" />
                            {apt.appointmentTime}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-[#3E0911] flex items-center gap-2">
                          <Stethoscope className="w-5 h-5 text-[#71774B] shrink-0" />
                          <span>{apt.doctorName}</span>
                        </h3>
                        <p className="text-sm text-[#5D4A44] mt-1 inline-flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 shrink-0" />
                          <span>
                            {apt.clinicName}
                            {apt.specialty ? ` · ${apt.specialty}` : ''}
                          </span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedApt(apt)}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-[#3E0911]/15 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {t('appointments.viewDetails')}
                      </button>
                    </div>

                    {apt.notes && (
                      <p className="text-sm text-[#3E0911] bg-[#FAF7F2] p-3.5 rounded-xl border border-[#3E0911]/10">
                        {apt.notes}
                      </p>
                    )}

                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#3E0911]/10">
                        <button
                          type="button"
                          onClick={() => openEdit(apt)}
                          className="min-h-[44px] px-4 py-2 rounded-xl border border-[#3E0911]/15 bg-white hover:bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmStatusAction({ apt, status: 'completed' })
                          }
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {t('appointments.markCompleted')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmStatusAction({ apt, status: 'cancelled' })
                          }
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-[#85383E] text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <XCircle className="w-4 h-4" />
                          {t('appointments.cancelAppointment')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="cb-card-3d rounded-2xl p-5 sm:p-6">
            <h2 className="font-display text-xl font-bold text-[#3E0911] mb-4">
              {t('appointments.history')} ({history.length})
            </h2>
            {history.length === 0 ? (
              <p className="text-[15px] text-[#5D4A44]">{t('common.empty')}</p>
            ) : (
              <div className="divide-y divide-[#3E0911]/10">
                {history.map((apt) => (
                  <div
                    key={apt.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-base text-[#3E0911]">
                        {apt.doctorName} · {apt.clinicName}
                      </div>
                      <div className="text-sm font-mono tabular-nums text-[#5D4A44] mt-0.5">
                        {formatDateDisplay(apt.appointmentDate)} · {apt.appointmentTime} (
                        {apt.timezone})
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                        apt.status === 'completed'
                          ? 'text-[#383C23]'
                          : apt.status === 'cancelled'
                            ? 'text-[#85383E]'
                            : 'text-[#5D4A44]'
                      }`}
                    >
                      {apt.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-[#71774B]" />
                      ) : apt.status === 'cancelled' ? (
                        <XCircle className="w-4 h-4 text-[#85383E]" />
                      ) : (
                        <Clock className="w-4 h-4 text-[#5D4A44]" />
                      )}
                      {apt.status === 'completed'
                        ? t('appointments.statusCompleted')
                        : apt.status === 'cancelled'
                          ? t('appointments.statusCancelled')
                          : t('appointments.statusScheduled')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Appointment Detail Modal */}
      {selectedApt && (
        <div
          className="fixed inset-0 z-50 bg-[#3E0911]/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="cb-card-3d w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 space-y-4 bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-bold text-[#3E0911]">
                  {selectedApt.doctorName}
                </h3>
                <p className="text-sm text-[#5D4A44] mt-0.5">
                  {selectedApt.clinicName}
                  {selectedApt.specialty ? ` · ${selectedApt.specialty}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedApt(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-[#E5DDD0] cursor-pointer"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 space-y-2.5 text-[15px]">
              <div className="flex justify-between gap-2">
                <span className="text-[#5D4A44]">{t('appointments.dateLabel')}</span>
                <span className="font-semibold text-[#3E0911]">
                  {formatDateDisplay(selectedApt.appointmentDate)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5D4A44]">{t('appointments.timeLabel')}</span>
                <span className="font-mono tabular-nums font-semibold text-[#3E0911]">
                  {selectedApt.appointmentTime} ({selectedApt.timezone})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5D4A44]">{t('appointments.reminderLabel')}</span>
                <span className="font-mono tabular-nums text-[#3E0911]">
                  {selectedApt.reminderMinutesBefore} min prior
                </span>
              </div>
            </div>

            {selectedApt.notes && (
              <div className="text-sm text-[#3E0911] bg-[#FAF7F2] p-4 rounded-xl border border-[#3E0911]/10">
                <div className="font-semibold mb-1">{t('appointments.notesLabel')}</div>
                <p>{selectedApt.notes}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedApt(null)}
              className="cb-btn-3d w-full min-h-[48px] py-2.5 rounded-xl bg-[#71774B] text-white text-[15px] font-semibold cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmStatusAction)}
        title={
          confirmStatusAction?.status === 'cancelled'
            ? 'Cancel this appointment?'
            : 'Mark appointment as completed?'
        }
        description={
          confirmStatusAction?.status === 'cancelled'
            ? `Are you sure you want to cancel the appointment with ${confirmStatusAction.apt.doctorName} on ${formatDateDisplay(confirmStatusAction.apt.appointmentDate)} at ${confirmStatusAction.apt.appointmentTime}?`
            : `Confirm that the visit with ${confirmStatusAction?.apt.doctorName} has been completed?`
        }
        confirmLabel={
          confirmStatusAction?.status === 'cancelled'
            ? t('appointments.cancelAppointment')
            : t('appointments.markCompleted')
        }
        cancelLabel={t('common.cancel')}
        tone={confirmStatusAction?.status === 'cancelled' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => {
          if (confirmStatusAction) {
            handleStatusChange(confirmStatusAction.apt, confirmStatusAction.status);
          }
        }}
        onCancel={() => setConfirmStatusAction(null)}
      />
    </div>
  );
};
