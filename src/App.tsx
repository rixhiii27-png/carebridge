import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { DashboardLayout } from './components/layout/DashboardLayout.tsx';
import { CareBridgeProvider, useCareBridge } from './context/CareBridgeContext.tsx';
import './i18n/index.ts';
import { AccessibilitySettingsPage } from './pages/AccessibilitySettingsPage.tsx';
import { AccountSettingsPage } from './pages/AccountSettingsPage.tsx';
import { ActivityHistoryPage } from './pages/ActivityHistoryPage.tsx';
import { AppointmentsPage } from './pages/AppointmentsPage.tsx';
import { AuthOnboardingPage } from './pages/AuthOnboardingPage.tsx';
import { CareProfilePage } from './pages/CareProfilePage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { FamilyCaregiversPage } from './pages/FamilyCaregiversPage.tsx';
import { LanguageSettingsPage } from './pages/LanguageSettingsPage.tsx';
import { MedicationsPage } from './pages/MedicationsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { NotificationsPage } from './pages/NotificationsPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';

const CareBridgeShell: React.FC = () => {
  const location = useLocation();
  const {
    authReady,
    firebaseUser,
    emailVerified,
    profileLoaded,
    profile,
    memberships,
    membershipsLoaded,
  } = useCareBridge();

  const stillLoading =
    !authReady ||
    (Boolean(firebaseUser) && emailVerified && (!profileLoaded || !membershipsLoaded));

  if (stillLoading) {
    return (
      <div className="min-h-screen bg-[#D7CAB7] flex items-center justify-center p-6">
        <div className="cb-card-3d rounded-2xl px-8 py-6 text-center max-w-sm w-full">
          <div className="font-display font-bold text-xl text-[#3E0911] mb-1">CareBridge</div>
          <p className="text-sm text-[#5D4A44]">Preparing your secure care workspace...</p>
        </div>
      </div>
    );
  }

  const isOnboarded =
    Boolean(firebaseUser) && emailVerified && Boolean(profile) && memberships.length > 0;

  if (!isOnboarded) {
    return (
      <Routes>
        <Route path="/" element={<AuthOnboardingPage initialAuthMode="signup" />} />
        <Route path="/signup" element={<AuthOnboardingPage initialAuthMode="signup" />} />
        <Route path="/login" element={<AuthOnboardingPage initialAuthMode="login" />} />
        <Route
          path="*"
          element={
            firebaseUser ? (
              <AuthOnboardingPage initialAuthMode="signup" />
            ) : (
              <Navigate to="/login" state={{ from: location.pathname }} replace />
            )
          }
        />
      </Routes>
    );
  }

  return (
    <DashboardLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="/signup" element={<Navigate to="/dashboard" replace />} />
        <Route path="/profile" element={<CareProfilePage />} />
        <Route path="/medications" element={<MedicationsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/family" element={<FamilyCaregiversPage />} />
        <Route path="/caregivers" element={<FamilyCaregiversPage />} />
        <Route path="/activity" element={<ActivityHistoryPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/languages" element={<LanguageSettingsPage />} />
        <Route path="/accessibility" element={<AccessibilitySettingsPage />} />
        <Route path="/account" element={<AccountSettingsPage />} />
        <Route path="/settings" element={<AccountSettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </DashboardLayout>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <CareBridgeProvider>
          <CareBridgeShell />
        </CareBridgeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
