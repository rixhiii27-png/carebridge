import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Calendar,
  FileBarChart2,
  Globe,
  HeartPulse,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useCareBridge } from '../../context/CareBridgeContext.tsx';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages.ts';
import { CareAssistantDrawer } from '../assistant/CareAssistantDrawer.tsx';

interface NavItemDef {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  essential: boolean;
  badge?: number;
}

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    profile,
    activeGroup,
    memberships,
    activeGroupId,
    setActiveGroupId,
    notifications,
    syncError,
    retrySync,
    languageCode,
    setLanguageAndScript,
    searchQuery,
    setSearchQuery,
    accessibility,
    logout,
  } = useCareBridge();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const navGroups: Array<{ groupLabel: string; items: NavItemDef[] }> = [
    {
      groupLabel: 'Daily Care',
      items: [
        { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, essential: true },
        { to: '/medications', label: t('nav.medications'), icon: Pill, essential: true },
        { to: '/appointments', label: t('nav.appointments'), icon: Calendar, essential: true },
        { to: '/profile', label: t('nav.careProfile'), icon: UserCircle2, essential: true },
      ],
    },
    {
      groupLabel: 'Care Circle & Updates',
      items: [
        { to: '/family', label: t('nav.familyCaregivers'), icon: Users, essential: true },
        {
          to: '/notifications',
          label: t('nav.notifications'),
          icon: Bell,
          essential: true,
          badge: unreadCount,
        },
        { to: '/activity', label: t('nav.activityHistory'), icon: Activity, essential: false },
        { to: '/reports', label: t('nav.reports'), icon: FileBarChart2, essential: false },
      ],
    },
    {
      groupLabel: 'Preferences',
      items: [
        { to: '/languages', label: t('nav.languageSettings'), icon: Globe, essential: false },
        {
          to: '/accessibility',
          label: t('nav.accessibilitySettings'),
          icon: ShieldCheck,
          essential: true,
        },
        { to: '/account', label: t('nav.accountSettings'), icon: Settings, essential: false },
      ],
    },
  ];

  const matchRoute = (to: string) => {
    if (to === '/') return location.pathname === '/' || location.pathname === '/dashboard';
    if (to === '/family') return location.pathname === '/family' || location.pathname === '/caregivers';
    if (to === '/account') return location.pathname === '/account' || location.pathname === '/settings';
    return location.pathname === to;
  };

  const mobileBottomTabs = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/medications', label: 'Meds', icon: Pill },
    { to: '/appointments', label: 'Visits', icon: Calendar },
    { to: '/family', label: 'Circle', icon: Users },
    { to: '/notifications', label: 'Alerts', icon: Bell, badge: unreadCount },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full text-[#FAF7F2]">
      <div className="px-5 py-5 border-b border-[#D7CAB7]/15 flex items-center justify-between">
        <Link
          to="/dashboard"
          onClick={() => setMobileMenuOpen(false)}
          className="flex items-center gap-3 min-w-0 hover:opacity-90 transition-opacity min-h-[44px]"
        >
          <div className="w-10 h-10 rounded-xl bg-[#71774B] flex items-center justify-center shadow-sm shrink-0">
            <HeartPulse className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-lg tracking-tight text-white truncate">
              {t('brand.name')}
            </div>
            <div className="text-[11px] text-[#D7CAB7]/80 truncate">Elderly Care Platform</div>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#D7CAB7] hover:bg-white/10 cursor-pointer"
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Main navigation">
        {navGroups.map((group) => {
          const items = accessibility.simpleNavigation
            ? group.items.filter((i) => i.essential)
            : group.items;
          if (items.length === 0) return null;
          return (
            <div key={group.groupLabel} className="space-y-1">
              <div className="px-3.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#D7CAB7]/70">
                {group.groupLabel}
              </div>
              {items.map((item) => {
                const Icon = item.icon;
                const active = matchRoute(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between gap-3 px-3.5 min-h-[44px] py-2 rounded-xl text-[15px] font-medium transition-colors ${
                      active
                        ? 'bg-[#71774B] text-white shadow-sm'
                        : 'text-[#E5DDD0] hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="text-xs font-mono tabular-nums font-bold px-2 py-0.5 rounded-md bg-[#85383E] text-white shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-3.5 border-t border-[#D7CAB7]/15 space-y-2.5">
        {activeGroup && (
          <div className="px-3.5 py-2.5 rounded-xl bg-[#2A2D1A] text-xs text-[#D7CAB7] space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-[#D7CAB7]/70">
              Active Care Circle
            </div>
            {memberships.length > 1 ? (
              <select
                aria-label="Switch active care profile"
                value={activeGroupId || ''}
                onChange={(e) => setActiveGroupId(e.target.value)}
                className="w-full min-h-[40px] px-2.5 py-1 rounded-lg bg-[#383C23] border border-[#D7CAB7]/20 text-sm font-semibold text-white cursor-pointer"
              >
                {memberships.map((m) => (
                  <option key={m.groupId} value={m.groupId}>
                    {m.elderlyName} ({m.role})
                  </option>
                ))}
              </select>
            ) : (
              <div className="font-semibold text-sm text-white truncate">
                {activeGroup.elderlyName}
              </div>
            )}
            <div className="truncate opacity-80">{activeGroup.timezone}</div>
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          className="w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2 rounded-xl text-[15px] font-medium text-[#E5DDD0] hover:bg-[#85383E] hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span>{t('nav.logout')}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#D7CAB7] text-[#3E0911] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block lg:w-64 xl:w-72 shrink-0 cb-sidebar-3d sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#3E0911]/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-80 max-w-[85vw] cb-sidebar-3d h-full z-10">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Top Navigation */}
        <header className="sticky top-0 z-30 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#3E0911]/12 px-3 sm:px-4 lg:px-8 py-2">
          <div className="flex items-center justify-between gap-2 sm:gap-4 min-h-[48px]">
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#3E0911]/15 bg-white text-[#3E0911] cursor-pointer shrink-0"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <Link
                to="/dashboard"
                className="lg:hidden font-display font-bold text-base text-[#3E0911] truncate min-w-0"
              >
                {activeGroup ? activeGroup.elderlyName : t('brand.name')}
              </Link>

              <div className="relative hidden md:block flex-1 max-w-md">
                <Search className="w-4 h-4 text-[#5D4A44] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('topbar.searchPlaceholder')}
                  aria-label={t('topbar.searchPlaceholder')}
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-white border border-[#3E0911]/15 text-sm text-[#3E0911] placeholder:text-[#5D4A44]/75"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                aria-label={t('topbar.searchPlaceholder')}
                aria-expanded={mobileSearchOpen}
                className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white border border-[#3E0911]/15 text-[#3E0911] cursor-pointer"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* 23-Language Selector */}
              <div className="flex items-center gap-1.5 bg-white border border-[#3E0911]/15 rounded-xl px-2 sm:px-3 min-h-[44px]">
                <Globe className="w-4 h-4 text-[#71774B] shrink-0" />
                <select
                  aria-label={t('topbar.selectLanguage')}
                  value={languageCode}
                  onChange={(e) => setLanguageAndScript(e.target.value)}
                  className="bg-transparent text-xs sm:text-sm font-medium text-[#3E0911] focus:outline-none cursor-pointer max-w-[92px] sm:max-w-[140px] min-h-[38px]"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.nativeName} ({lang.englishName})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label={t('nav.notifications')}
                className="hidden sm:flex relative min-w-[44px] min-h-[44px] items-center justify-center rounded-xl bg-white border border-[#3E0911]/15 text-[#3E0911] hover:bg-[#E5DDD0] transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1.5 min-w-[18px] h-[18px] rounded-full bg-[#85383E] text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                aria-label={t('topbar.assistantButton')}
                className="inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 rounded-xl border border-[#3E0911]/15 bg-white hover:bg-[#E5DDD0] text-[#3E0911] text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <MessageCircle className="w-4 h-4 text-[#71774B] shrink-0" />
                <span className="hidden sm:inline">{t('topbar.assistantButton')}</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/medications')}
                aria-label={t('topbar.quickAction')}
                className="cb-btn-3d hidden md:inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>{t('topbar.quickAction')}</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/account')}
                className="hidden xl:flex items-center gap-2 pl-2.5 pr-3.5 min-h-[44px] rounded-xl bg-white border border-[#3E0911]/15 hover:bg-[#E5DDD0] transition-colors cursor-pointer"
                title={profile?.displayName || 'Account'}
              >
                <UserCircle2 className="w-5 h-5 text-[#71774B]" />
                <span className="text-sm font-semibold text-[#3E0911] max-w-[120px] truncate">
                  {profile?.displayName || 'Account'}
                </span>
              </button>
            </div>
          </div>

          {/* Expandable Mobile Search Strip */}
          {mobileSearchOpen && (
            <div className="md:hidden pt-2 pb-1">
              <div className="relative">
                <Search className="w-4 h-4 text-[#5D4A44] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('topbar.searchPlaceholder')}
                  aria-label={t('topbar.searchPlaceholder')}
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-white border border-[#3E0911]/15 text-base text-[#3E0911]"
                />
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-5 lg:p-6 xl:p-8 pb-24 lg:pb-8 max-w-[1400px] w-full mx-auto">
          {syncError && (
            <div
              role="alert"
              className="mb-5 p-4 rounded-2xl bg-[#F6EAEC] border border-[#85383E]/30 text-sm text-[#3E0911] flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-[#85383E] shrink-0" />
                <span>{syncError}</span>
              </div>
              <button
                type="button"
                onClick={retrySync}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl bg-white border border-[#85383E]/30 text-sm font-semibold text-[#3E0911] hover:bg-[#E5DDD0] cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Sync
              </button>
            </div>
          )}
          {children}
        </main>

        <footer className="hidden lg:flex px-6 xl:px-8 py-4 border-t border-[#3E0911]/10 bg-[#FAF7F2]/60 text-xs text-[#5D4A44] flex-wrap items-center justify-between gap-3">
          <span>
            {t('brand.name')} · {t('brand.tagline')}
          </span>
          <span>{t('brand.disclaimer')}</span>
        </footer>
      </div>

      {/* Mobile Thumb-Zone Bottom Navigation Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-t border-[#3E0911]/12 pb-safe"
      >
        <div className="grid grid-cols-5 h-16">
          {mobileBottomTabs.map((tab) => {
            const Icon = tab.icon;
            const active = matchRoute(tab.to);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-[11px] font-semibold transition-colors ${
                  active ? 'text-[#383C23]' : 'text-[#5D4A44] hover:text-[#3E0911]'
                }`}
              >
                <span
                  className={`relative flex items-center justify-center px-3 py-1 rounded-full transition-colors ${
                    active ? 'bg-[#71774B]/20 text-[#383C23]' : ''
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span className="absolute -top-0.5 right-1 px-1 min-w-[16px] h-[16px] rounded-full bg-[#85383E] text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full px-1">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <CareAssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
};
