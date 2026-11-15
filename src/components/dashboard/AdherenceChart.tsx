import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getTodayDateKey } from '../../services/firebase.ts';
import type { Medication, MedicationLog } from '../../types/carebridge.ts';

interface DaySummary {
  date: string;
  label: string;
  taken: number;
  skippedOrMissed: number;
  unconfirmed: number;
  rate: number;
}

export const AdherenceChart: React.FC<{
  medications: Medication[];
  logs: MedicationLog[];
  localeTag: string;
  timezone?: string;
}> = ({ medications, logs, localeTag, timezone = 'Asia/Kolkata' }) => {
  const { t } = useTranslation();

  const days = useMemo<DaySummary[]>(() => {
    const activeMeds = medications.filter((m) => m.active);
    const expectedPerDay = activeMeds.reduce(
      (sum, m) => sum + Math.max(1, m.scheduleTimes.length),
      0,
    );

    const todayKey = getTodayDateKey(timezone);
    const [y, m, dNum] = todayKey.split('-').map(Number);
    const baseUtc = new Date(Date.UTC(y, (m || 1) - 1, dNum || 1));

    const list: DaySummary[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(baseUtc);
      d.setUTCDate(d.getUTCDate() - offset);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLogs = logs.filter((l) => l.scheduledDate === dateStr);
      const taken = dayLogs.filter((l) => l.status === 'taken').length;
      const skippedOrMissed = dayLogs.filter(
        (l) => l.status === 'skipped' || l.status === 'missed',
      ).length;
      const denom = Math.max(expectedPerDay, taken + skippedOrMissed, 1);
      const unconfirmed = Math.max(0, denom - taken - skippedOrMissed);
      const rate = Math.min(100, Math.round((taken / denom) * 100));

      let label = dateStr.slice(5);
      try {
        label = new Intl.DateTimeFormat(localeTag, {
          weekday: 'short',
          timeZone: 'UTC',
        }).format(d);
      } catch {
        // fallback to MM-DD
      }
      list.push({ date: dateStr, label, taken, skippedOrMissed, unconfirmed, rate });
    }
    return list;
  }, [medications, logs, localeTag, timezone]);

  const weeklyAvg = useMemo(() => {
    const sum = days.reduce((acc, d) => acc + d.rate, 0);
    return Math.round(sum / Math.max(1, days.length));
  }, [days]);

  return (
    <div className="cb-card-3d rounded-2xl p-5 sm:p-6 w-full min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold text-[#3E0911] leading-snug break-words">
            {t('dashboard.adherenceOverview')}
          </h2>
          <p className="text-sm text-[#5D4A44] mt-0.5 break-words">
            {t('dashboard.adherenceRate')} · Last 7 days
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="text-3xl font-bold font-mono tabular-nums text-[#71774B]">
            {weeklyAvg}%
          </div>
          <div className="text-xs text-[#5D4A44]">7-day average</div>
        </div>
      </div>

      {/* 7-Day Layered Column Bars */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-3 items-end min-h-[11.5rem] pt-2 pb-3 border-b border-[#3E0911]/10">
        {days.map((day) => {
          const total = Math.max(1, day.taken + day.skippedOrMissed + day.unconfirmed);
          const takenPct = (day.taken / total) * 100;
          const missedPct = (day.skippedOrMissed / total) * 100;
          return (
            <div key={day.date} className="flex flex-col items-center gap-1.5 min-w-0 justify-end">
              <span className="text-[11px] sm:text-xs font-mono tabular-nums font-semibold text-[#5D4A44] leading-tight whitespace-nowrap">
                {day.rate}%
              </span>
              <div
                className="w-full max-w-[38px] h-24 sm:h-28 rounded-lg bg-[#E5DDD0] overflow-hidden flex flex-col-reverse border border-[#3E0911]/12 shadow-inner"
                aria-label={`${day.date}: ${day.taken} taken, ${day.skippedOrMissed} skipped or missed, ${day.unconfirmed} not confirmed`}
                title={`${day.date}: ${day.taken} taken, ${day.skippedOrMissed} skipped/missed, ${day.unconfirmed} not confirmed`}
              >
                {takenPct > 0 && (
                  <div
                    className="w-full bg-[#71774B] transition-all duration-300"
                    style={{ height: `${takenPct}%` }}
                  />
                )}
                {missedPct > 0 && (
                  <div
                    className="w-full bg-[#85383E] transition-all duration-300"
                    style={{ height: `${missedPct}%` }}
                  />
                )}
              </div>
              <span className="text-[11px] sm:text-sm font-semibold text-[#3E0911] leading-tight text-center max-w-full break-words">
                {day.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-[#5D4A44]">
        <span className="inline-flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-[#71774B] inline-block shrink-0" />
          {t('medications.statusTaken')}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-[#85383E] inline-block shrink-0" />
          {t('medications.statusSkipped')} / {t('medications.statusMissed')}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-[#E5DDD0] border border-[#3E0911]/20 inline-block shrink-0" />
          {t('medications.statusNotConfirmed')}
        </span>
      </div>
    </div>
  );
};
