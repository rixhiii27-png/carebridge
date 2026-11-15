import React, { useMemo } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileBarChart2,
  Printer,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyStateCard, PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { AdherenceChart } from '../components/dashboard/AdherenceChart.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getLanguageMeta } from '../i18n/languages.ts';
import type { Appointment } from '../types/carebridge.ts';

function renderAppointmentStatus(status: Appointment['status']) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#71774B]">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        Completed
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E]">
        <XCircle className="w-4 h-4 shrink-0" />
        Cancelled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#383C23]">
      <Clock className="w-4 h-4 shrink-0" />
      Scheduled
    </span>
  );
}

export const ReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const { activeGroup, medications, medicationLogs, appointments, languageCode } = useCareBridge();

  const localeTag = getLanguageMeta(languageCode).bcp47;

  const stats = useMemo(() => {
    const taken = medicationLogs.filter((l) => l.status === 'taken').length;
    const skipped = medicationLogs.filter((l) => l.status === 'skipped').length;
    const missed = medicationLogs.filter((l) => l.status === 'missed').length;
    const total = taken + skipped + missed;
    return {
      taken,
      skipped,
      missed,
      total,
      rate: total > 0 ? Math.round((taken / total) * 100) : 0,
    };
  }, [medicationLogs]);

  const upcomingAppointmentsCount = useMemo(
    () => appointments.filter((a) => a.status === 'scheduled').length,
    [appointments],
  );

  const handleExportCsv = () => {
    const headers = ['Date', 'Time', 'Medication', 'Status', 'UpdatedBy'];
    const rows = medicationLogs.map((l) => [
      l.scheduledDate,
      l.scheduledTime,
      `"${l.medicationName.replace(/"/g, '""')}"`,
      l.status,
      `"${l.updatedByName.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carebridge-dose-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.reports')}
        subtitle={`Care summary for ${activeGroup?.elderlyName || 'Resident'} · ${t('brand.disclaimer')}`}
        icon={<FileBarChart2 className="w-6 h-6" />}
        actions={
          <div className="flex flex-wrap items-center gap-2.5 cb-no-print">
            <button
              type="button"
              onClick={handleExportCsv}
              className="cb-btn-3d min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              {t('common.exportCsv')}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-[#71774B]" />
              {t('common.printReport')}
            </button>
          </div>
        }
      />

      {/* Plain-Language Care Intelligence Summary */}
      <section className="cb-card-3d rounded-2xl p-5 sm:p-6 bg-[#FAF7F2] border border-[#71774B]/25 space-y-2">
        <h2 className="font-display text-lg font-bold text-[#3E0911]">
          Plain-Language Care Summary
        </h2>
        <p className="text-[15px] text-[#3E0911] leading-relaxed">
          {stats.total > 0 ? (
            <>
              <strong className="tabular-nums">{stats.taken}</strong> of{' '}
              <strong className="tabular-nums">{stats.total}</strong> recorded medication doses were
              confirmed taken (<strong className="tabular-nums">{stats.rate}%</strong> confirmation
              rate). There {upcomingAppointmentsCount === 1 ? 'is' : 'are'}{' '}
              <strong className="tabular-nums">{upcomingAppointmentsCount}</strong> upcoming{' '}
              {upcomingAppointmentsCount === 1 ? 'visit' : 'visits'} scheduled across{' '}
              <strong className="tabular-nums">{medications.filter((m) => m.active).length}</strong>{' '}
              active prescriptions.
            </>
          ) : (
            <>
              No medication doses have been recorded yet for{' '}
              <strong>{activeGroup?.elderlyName || 'this resident'}</strong>. Once daily doses are
              confirmed, weekly adherence trends will appear automatically below.
            </>
          )}
        </p>
        <p className="text-sm text-[#5D4A44]">
          Share this printed or CSV record with your doctor or caregiver during clinic visits.
        </p>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="cb-card-3d rounded-2xl p-5 space-y-1.5">
          <div className="text-sm font-medium text-[#5D4A44]">Confirmed Rate</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#71774B]">
            {stats.rate}%
          </div>
        </div>
        <div className="cb-card-3d rounded-2xl p-5 space-y-1.5">
          <div className="text-sm font-medium text-[#5D4A44] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#71774B] shrink-0" />
            <span>{t('medications.statusTaken')}</span>
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#3E0911]">
            {stats.taken}
          </div>
        </div>
        <div className="cb-card-3d rounded-2xl p-5 space-y-1.5">
          <div className="text-sm font-medium text-[#5D4A44] flex items-center gap-1.5">
            <SkipForward className="w-4 h-4 text-[#5D4A44] shrink-0" />
            <span>{t('medications.statusSkipped')}</span>
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#5D4A44]">
            {stats.skipped}
          </div>
        </div>
        <div className="cb-card-3d rounded-2xl p-5 space-y-1.5">
          <div className="text-sm font-medium text-[#5D4A44] flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-[#85383E] shrink-0" />
            <span>{t('medications.statusMissed')}</span>
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#85383E]">
            {stats.missed}
          </div>
        </div>
      </div>

      <AdherenceChart medications={medications} logs={medicationLogs} localeTag={localeTag} />

      <section className="cb-card-3d rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold text-[#3E0911] mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-[#71774B]" />
          {t('nav.appointments')} ({appointments.length})
        </h2>
        {appointments.length === 0 ? (
          <EmptyStateCard
            title="No appointments recorded"
            description="Scheduled, completed, and cancelled medical visits will be summarized here for clinic follow-ups."
          />
        ) : (
          <div className="divide-y divide-[#3E0911]/10">
            {appointments.map((apt) => (
              <div
                key={apt.id}
                className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-base text-[#3E0911]">{apt.doctorName}</div>
                  <div className="text-sm text-[#5D4A44]">{apt.clinicName}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono tabular-nums text-sm text-[#5D4A44]">
                    {apt.appointmentDate} · {apt.appointmentTime}
                  </span>
                  {renderAppointmentStatus(apt.status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

