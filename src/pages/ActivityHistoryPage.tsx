import React, { useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  ClipboardCheck,
  HeartHandshake,
  History,
  Pill,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyStateCard, PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { useCareBridge } from '../context/CareBridgeContext.tsx';

function renderEntityIcon(entityType: string) {
  switch (entityType) {
    case 'medication':
      return <Pill className="w-4 h-4 text-[#71774B]" />;
    case 'medicationLog':
      return <ClipboardCheck className="w-4 h-4 text-[#383C23]" />;
    case 'appointment':
      return <Calendar className="w-4 h-4 text-[#71774B]" />;
    case 'member':
      return <Users className="w-4 h-4 text-[#85383E]" />;
    case 'careGroup':
      return <HeartHandshake className="w-4 h-4 text-[#3E0911]" />;
    default:
      return <Activity className="w-4 h-4 text-[#71774B]" />;
  }
}

export const ActivityHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const { activityLogs, searchQuery } = useCareBridge();

  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState(20);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activityLogs.filter((item) => {
      if (entityFilter !== 'all' && item.entityType !== entityFilter) return false;
      if (
        q &&
        !item.summary.toLowerCase().includes(q) &&
        !item.actorName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [activityLogs, entityFilter, searchQuery]);

  const visible = filtered.slice(0, pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.activityHistory')}
        subtitle="Audit trail of medication, appointment, and care circle updates."
        icon={<History className="w-6 h-6" />}
        actions={
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            aria-label="Filter activity type"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white border border-[#3E0911]/20 text-sm font-medium text-[#3E0911]"
          >
            <option value="all">All Events ({activityLogs.length})</option>
            <option value="medication">Medications</option>
            <option value="medicationLog">Dose Confirmations</option>
            <option value="appointment">Appointments</option>
            <option value="member">Care Circle Members</option>
            <option value="careGroup">Care Profile</option>
          </select>
        }
      />

      {visible.length === 0 ? (
        <EmptyStateCard
          title="No matching activity recorded"
          description={t('dashboard.noActivityYet')}
          actionLabel={entityFilter !== 'all' ? 'Show All Events' : undefined}
          onAction={entityFilter !== 'all' ? () => setEntityFilter('all') : undefined}
        />
      ) : (
        <section className="cb-card-3d rounded-2xl p-5 sm:p-6">
          <div className="divide-y divide-[#3E0911]/10">
            {visible.map((log) => {
              const ts = (log.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
              return (
                <div
                  key={log.id}
                  className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 flex items-center justify-center shrink-0 mt-0.5">
                      {renderEntityIcon(log.entityType)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[15px] text-[#3E0911] leading-snug">
                        {log.summary}
                      </div>
                      <div className="text-sm text-[#5D4A44] mt-0.5 capitalize">
                        {log.actorName} ({log.actorRole}) · {log.actionType}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-mono tabular-nums text-[#5D4A44] pl-12 sm:pl-0 shrink-0">
                    {ts ? ts.toLocaleString() : 'Recorded'}
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length > pageSize && (
            <div className="pt-5 mt-5 border-t border-[#3E0911]/10 text-center">
              <button
                type="button"
                onClick={() => setPageSize((n) => n + 20)}
                className="min-h-[44px] px-5 py-2 rounded-xl border border-[#3E0911]/20 bg-[#FAF7F2] hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer"
              >
                Load More ({filtered.length - pageSize} remaining)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

