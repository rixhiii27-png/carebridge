import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Mail,
  Pill,
  Send,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyStateCard, PageHeader } from '../components/common/AccessibleWidgets.tsx';
import { buildApiUrl } from '../config/api.ts';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import {
  createInAppNotification,
  fetchNotificationPreferences,
  getAuthenticatedIdToken,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '../services/firestoreService.ts';
import type { NotificationType } from '../types/carebridge.ts';

type NotificationCategory = 'all' | 'medications' | 'appointments' | 'careCircle';

function getNotificationCategory(type: NotificationType): NotificationCategory {
  if (type === 'upcoming_dose' || type === 'unconfirmed_dose' || type === 'missed_dose') {
    return 'medications';
  }
  if (type === 'upcoming_appointment') {
    return 'appointments';
  }
  return 'careCircle';
}

function renderTypeBadge(type: NotificationType) {
  if (type === 'missed_dose') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#85383E]">
        <AlertCircle className="w-3.5 h-3.5" />
        Missed Dose Alert
      </span>
    );
  }
  if (type === 'upcoming_dose' || type === 'unconfirmed_dose') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#71774B]">
        <Pill className="w-3.5 h-3.5" />
        Medication Reminder
      </span>
    );
  }
  if (type === 'upcoming_appointment') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#383C23]">
        <Calendar className="w-3.5 h-3.5" />
        Appointment Update
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5D4A44]">
      <Users className="w-3.5 h-3.5" />
      Care Circle Alert
    </span>
  );
}

export const NotificationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { firebaseUser, activeGroup, notifications } = useCareBridge();

  const [activeCategory, setActiveCategory] = useState<NotificationCategory>('all');
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [upcomingDoseAlert, setUpcomingDoseAlert] = useState(true);
  const [unconfirmedDoseAlert, setUnconfirmedDoseAlert] = useState(true);
  const [missedDoseAlert, setMissedDoseAlert] = useState(true);
  const [appointmentAlert, setAppointmentAlert] = useState(true);
  const [caregiverUpdateAlert, setCaregiverUpdateAlert] = useState(true);
  const [timezone, setTimezone] = useState(
    () => activeGroup?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  );

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    fetchNotificationPreferences(firebaseUser.uid)
      .then((prefs) => {
        if (prefs) {
          setInAppEnabled(prefs.inAppEnabled);
          setEmailEnabled(prefs.emailEnabled);
          setUpcomingDoseAlert(prefs.upcomingDoseAlert);
          setUnconfirmedDoseAlert(prefs.unconfirmedDoseAlert);
          setMissedDoseAlert(prefs.missedDoseAlert);
          setAppointmentAlert(prefs.appointmentAlert);
          setCaregiverUpdateAlert(prefs.caregiverUpdateAlert);
          setTimezone(prefs.timezone);
        }
      })
      .catch(() => {
        // handled cleanly
      });
  }, [firebaseUser]);

  const categoryCounts = useMemo(() => {
    const counts = {
      all: notifications.length,
      medications: 0,
      appointments: 0,
      careCircle: 0,
    };
    notifications.forEach((n) => {
      const cat = getNotificationCategory(n.type);
      if (cat === 'medications') counts.medications += 1;
      else if (cat === 'appointments') counts.appointments += 1;
      else counts.careCircle += 1;
    });
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeCategory === 'all') return notifications;
    return notifications.filter((n) => getNotificationCategory(n.type) === activeCategory);
  }, [activeCategory, notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      await updateNotificationPreferences(firebaseUser.uid, {
        inAppEnabled,
        emailEnabled,
        upcomingDoseAlert,
        unconfirmedDoseAlert,
        missedDoseAlert,
        appointmentAlert,
        caregiverUpdateAlert,
        timezone,
      });
      setStatusMsg('Notification preferences saved.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to save preferences.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestReminder = async () => {
    if (!firebaseUser || !activeGroup) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const token = await getAuthenticatedIdToken();
      if (!token) throw new Error('Not signed in');

      const dedupeKey = `test_${firebaseUser.uid}_${Date.now()}`;
      const res = await fetch(buildApiUrl('/api/notifications/dispatch'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          groupId: activeGroup.id,
          type: 'upcoming_dose',
          title: 'Scheduled Care Reminder',
          message: `Test reminder generated for ${activeGroup.elderlyName} (${timezone}).`,
          dedupeKey,
          sendEmail: emailEnabled,
          recipientEmail: firebaseUser.email || undefined,
          timezone,
        }),
      });
      const data = await res.json();

      if (inAppEnabled) {
        await createInAppNotification({
          groupId: activeGroup.id,
          recipientUid: firebaseUser.uid,
          type: 'upcoming_dose',
          title: 'Scheduled Care Reminder',
          message: `Reminder verified for ${activeGroup.elderlyName} (${timezone}).`,
          channel: 'in_app',
          deliveryStatus: 'sent',
          dedupeKey,
        });
      }

      if (data.dispatch?.emailResult) {
        setStatusMsg(
          data.dispatch.emailResult.sent
            ? `Email sent (${data.dispatch.emailResult.subject}).`
            : `Email adapter status (${data.dispatch.emailResult.mode} mode): ${data.dispatch.emailResult.reason}`,
        );
      } else {
        setStatusMsg('In-app test reminder recorded in Firestore.');
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Dispatch failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        icon={<Bell className="w-6 h-6" />}
        actions={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={handleTestReminder}
              className="cb-btn-3d min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              {t('notifications.sendTestReminder')}
            </button>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={() => markAllNotificationsRead(notifications)}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#FAF7F2] text-sm font-semibold text-[#3E0911] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4 text-[#71774B]" />
              {t('notifications.markAllRead')}
            </button>
          </>
        }
      />

      {statusMsg && (
        <div
          role="status"
          className="p-4 rounded-xl bg-[#FAF7F2] border border-[#71774B] text-[15px] text-[#383C23] font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#85383E]" />
              {t('notifications.inbox')}
            </h2>
            {unreadCount > 0 && (
              <span className="text-sm font-bold text-[#85383E] tabular-nums">
                {unreadCount} unread
              </span>
            )}
          </div>

          {/* Category Filter Tabs */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Notification categories">
            {(
              [
                { id: 'all', label: `All (${categoryCounts.all})` },
                { id: 'medications', label: `Medications (${categoryCounts.medications})` },
                { id: 'appointments', label: `Appointments (${categoryCounts.appointments})` },
                { id: 'careCircle', label: `Care Circle (${categoryCounts.careCircle})` },
              ] as const
            ).map((tab) => {
              const selected = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveCategory(tab.id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer tabular-nums ${
                    selected
                      ? 'bg-[#383C23] text-white'
                      : 'bg-[#FAF7F2] border border-[#3E0911]/15 text-[#3E0911] hover:bg-[#E5DDD0]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {filteredNotifications.length === 0 ? (
            <EmptyStateCard
              title="No reminders in this view"
              description={t('dashboard.noNotifications')}
              actionLabel={activeCategory !== 'all' ? 'View All Notifications' : undefined}
              onAction={activeCategory !== 'all' ? () => setActiveCategory('all') : undefined}
            />
          ) : (
            <div className="space-y-3">
              {filteredNotifications.map((n) => {
                const ts = (n.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
                return (
                  <div
                    key={n.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                      n.read
                        ? 'bg-[#FAF7F2] border-[#3E0911]/10'
                        : 'bg-[#F6EAEC] border-[#85383E]/30'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {renderTypeBadge(n.type)}
                        <span className="text-xs text-[#5D4A44]">
                          · {n.channel.toUpperCase()} ({n.deliveryStatus})
                        </span>
                      </div>
                      <div className="font-bold text-base text-[#3E0911]">{n.title}</div>
                      <p className="text-[15px] text-[#5D4A44] leading-snug">{n.message}</p>
                      <div className="text-xs font-mono tabular-nums text-[#5D4A44] pt-0.5">
                        {ts ? ts.toLocaleString() : 'Recent'}
                      </div>
                    </div>

                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => markNotificationRead(n.id)}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-white border border-[#85383E]/30 text-sm font-semibold text-[#85383E] hover:bg-[#FAF7F2] shrink-0 cursor-pointer self-start"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <form
          onSubmit={handleSavePrefs}
          className="lg:col-span-5 cb-card-3d rounded-2xl p-5 sm:p-6 space-y-4 h-fit"
        >
          <h2 className="text-lg font-bold text-[#3E0911] flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#71774B]" />
            {t('notifications.preferences')}
          </h2>

          <div className="space-y-2.5 text-[15px]">
            {[
              { label: t('notifications.inAppEnabled'), val: inAppEnabled, set: setInAppEnabled },
              { label: t('notifications.emailEnabled'), val: emailEnabled, set: setEmailEnabled },
              {
                label: t('notifications.upcomingDoseAlert'),
                val: upcomingDoseAlert,
                set: setUpcomingDoseAlert,
              },
              {
                label: t('notifications.unconfirmedDoseAlert'),
                val: unconfirmedDoseAlert,
                set: setUnconfirmedDoseAlert,
              },
              {
                label: t('notifications.missedDoseAlert'),
                val: missedDoseAlert,
                set: setMissedDoseAlert,
              },
              {
                label: t('notifications.appointmentAlert'),
                val: appointmentAlert,
                set: setAppointmentAlert,
              },
              {
                label: t('notifications.caregiverUpdateAlert'),
                val: caregiverUpdateAlert,
                set: setCaregiverUpdateAlert,
              },
            ].map((item, idx) => (
              <label
                key={idx}
                className="min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/10 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={item.val}
                  onChange={(e) => item.set(e.target.checked)}
                  className="w-5 h-5 accent-[#71774B] shrink-0"
                />
                <span className="text-[#3E0911]">{item.label}</span>
              </label>
            ))}

            <div className="pt-2">
              <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                {t('appointments.timezoneLabel')}
              </label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#3E0911]/20 text-base font-mono text-[#3E0911]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="cb-btn-3d w-full min-h-[48px] py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-[15px] font-semibold cursor-pointer disabled:opacity-60"
          >
            {t('notifications.savePreferences')}
          </button>
        </form>
      </div>
    </div>
  );
};

