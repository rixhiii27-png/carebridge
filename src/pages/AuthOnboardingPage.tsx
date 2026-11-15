import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  HeartPulse,
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import elderlyAvatar from '../assets/images/avatar_elderly_resident_1794717063448.jpg';
import { useCareBridge } from '../context/CareBridgeContext.tsx';
import { getLanguageMeta, SUPPORTED_LANGUAGES } from '../i18n/languages.ts';
import { getVoiceLanguageCapability } from '../../shared/voiceLanguageMatrix.ts';
import { formatCareBridgeError } from '../services/firebase.ts';
import {
  createCareGroup,
  redeemInvitationCode,
  seedFictionalDemoCareProfile,
} from '../services/firestoreService.ts';
import type { UserRole } from '../types/carebridge.ts';

interface AuthOnboardingPageProps {
  initialAuthMode?: 'login' | 'signup';
}

export const AuthOnboardingPage: React.FC<AuthOnboardingPageProps> = ({
  initialAuthMode = 'signup',
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    firebaseUser,
    emailVerified,
    profile,
    languageCode,
    scriptId,
    setLanguageAndScript,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    resendVerificationEmail,
    refreshAuthUser,
    completeOnboardingProfile,
    logout,
  } = useCareBridge();

  const [authMode, setAuthMode] = useState<'login' | 'signup'>(initialAuthMode);
  const [selectedRole, setSelectedRole] = useState<UserRole>('elderly');
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  );
  const [setupMode, setSetupMode] = useState<'create' | 'join'>('create');
  const [elderlyName, setElderlyName] = useState('');
  const [elderlyAge, setElderlyAge] = useState('74');
  const [primaryPhysician, setPrimaryPhysician] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const currentLangMeta = getLanguageMeta(languageCode);

  useEffect(() => {
    setAuthMode(initialAuthMode);
  }, [initialAuthMode]);

  useEffect(() => {
    if (firebaseUser?.displayName && !displayName) {
      setDisplayName(firebaseUser.displayName);
    }
  }, [firebaseUser?.displayName, displayName]);

  const redirectTarget =
    (location.state as { from?: string } | null)?.from &&
    (location.state as { from?: string }).from !== '/login' &&
    (location.state as { from?: string }).from !== '/signup'
      ? ((location.state as { from?: string }).from as string)
      : '/dashboard';

  const switchAuthMode = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setError(null);
    setInfoMsg(null);
    navigate(mode === 'login' ? '/login' : '/signup', { replace: true, state: location.state });
  };

  const handleGoogleSignIn = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      if (!displayName && user.displayName) {
        setDisplayName(user.displayName);
      }
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setInfoMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (authMode === 'signup' && !displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    try {
      if (authMode === 'signup') {
        await signUpWithEmail({
          displayName: displayName.trim(),
          email: trimmedEmail,
          password,
        });
        setInfoMsg('Account created! Please check your inbox to verify your email address.');
      } else {
        await signInWithEmail(trimmedEmail, password);
      }
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const handleCheckVerification = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const verified = await refreshAuthUser();
      if (!verified) {
        setInfoMsg(
          'Your email is not verified yet. Please click the verification link sent to your inbox, then tap "I\'ve Verified — Continue".',
        );
      }
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const handleResendVerification = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      await resendVerificationEmail();
      setInfoMsg('Verification email sent again. Please check your inbox and spam folder.');
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const handleFinishSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const nameToUse = displayName.trim() || firebaseUser.displayName || 'CareBridge User';
      if (!profile) {
        await completeOnboardingProfile({
          displayName: nameToUse,
          role: selectedRole,
          timezone,
        });
      }

      if (setupMode === 'join') {
        if (!inviteCode.trim()) throw new Error('Please enter an invitation code.');
        await redeemInvitationCode({
          code: inviteCode,
          uid: firebaseUser.uid,
          displayName: nameToUse,
          relationship: relationship || selectedRole,
        });
      } else {
        const resName = elderlyName.trim() || nameToUse;
        await createCareGroup({
          ownerUid: firebaseUser.uid,
          ownerName: nameToUse,
          ownerRole: profile?.role || selectedRole,
          elderlyName: resName,
          elderlyAge: Number(elderlyAge) || 72,
          primaryPhysician: primaryPhysician.trim(),
          timezone,
        });
      }
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const handleSeedDemo = async () => {
    if (!firebaseUser || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const nameToUse = displayName.trim() || firebaseUser.displayName || 'CareBridge User';
      if (!profile) {
        await completeOnboardingProfile({
          displayName: nameToUse,
          role: selectedRole,
          timezone,
        });
      }
      await seedFictionalDemoCareProfile({
        ownerUid: firebaseUser.uid,
        ownerName: nameToUse,
        ownerRole: profile?.role || selectedRole,
        timezone,
      });
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(formatCareBridgeError(err));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-[#D7CAB7] text-[#3E0911] flex flex-col justify-between p-3.5 sm:p-8">
      <div className="max-w-5xl w-full mx-auto my-auto cb-perspective">
        <div className="cb-hero-3d rounded-3xl overflow-hidden grid lg:grid-cols-12">
          {/* Left Editorial Identity Panel */}
          <div className="lg:col-span-5 bg-[#383C23] text-[#FAF7F2] p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[#71774B] flex items-center justify-center shadow-sm">
                  <HeartPulse className="w-6 h-6 text-white" />
                </div>
                <span className="font-display font-bold text-2xl text-white">
                  {t('brand.name')}
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-snug mb-3">
                {t('auth.welcomeTitle')}
              </h1>
              <p className="text-[15px] text-[#E5DDD0] leading-relaxed mb-6">
                {t('auth.welcomeSubtitle')}
              </p>

              <div className="rounded-2xl overflow-hidden border border-[#D7CAB7]/20 bg-[#2A2D1A] p-4 flex items-center gap-4">
                <img
                  src={elderlyAvatar}
                  alt="Dignified elderly CareBridge resident"
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border border-[#D7CAB7]/30"
                />
                <div className="text-sm text-[#E5DDD0] space-y-1">
                  <div className="font-semibold text-white">{t('brand.tagline')}</div>
                  <div className="text-xs opacity-90">
                    22 Indian Languages + English · Voice & RTL Ready
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-5 border-t border-[#D7CAB7]/15 text-xs text-[#D7CAB7] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-[#71774B]" />
              <span>{t('brand.disclaimer')}</span>
            </div>
          </div>

          {/* Right Sign-In & Onboarding Form */}
          <div className="lg:col-span-7 p-5 sm:p-8 lg:p-10 bg-[#FAF7F2]">
            {/* Onboarding Language + Script Selector */}
            <div className="mb-6 pb-5 border-b border-[#3E0911]/10">
              <label className="block text-sm font-semibold text-[#5D4A44] mb-2">
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-[#71774B]" />
                  {t('auth.chooseLanguage')}
                </span>
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <select
                  value={languageCode}
                  onChange={(e) => setLanguageAndScript(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.nativeName} — {lang.englishName}
                    </option>
                  ))}
                </select>

                {currentLangMeta.scripts.length > 1 && (
                  <select
                    value={scriptId}
                    onChange={(e) => setLanguageAndScript(languageCode, e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                    aria-label="Script"
                  >
                    {currentLangMeta.scripts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="mt-2 text-xs text-[#5D4A44]">
                Voice readiness: {getVoiceLanguageCapability(languageCode).capabilityNote}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 p-4 rounded-xl bg-[#F6EAEC] border border-[#85383E]/30 text-[15px] text-[#3E0911]"
              >
                {error}
              </div>
            )}

            {infoMsg && (
              <div
                role="status"
                className="mb-5 p-4 rounded-xl bg-white border border-[#71774B]/40 text-[15px] text-[#383C23] flex items-start gap-2.5"
              >
                <CheckCircle2 className="w-5 h-5 text-[#71774B] shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            {!firebaseUser ? (
              <div className="space-y-5">
                {/* Sign Up vs Log In Tabs */}
                <div className="flex gap-2 p-1 bg-[#E5DDD0] rounded-xl">
                  <button
                    type="button"
                    onClick={() => switchAuthMode('signup')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      authMode === 'signup'
                        ? 'bg-white text-[#3E0911] shadow-sm'
                        : 'text-[#5D4A44] hover:text-[#3E0911]'
                    }`}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => switchAuthMode('login')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      authMode === 'login'
                        ? 'bg-white text-[#3E0911] shadow-sm'
                        : 'text-[#5D4A44] hover:text-[#3E0911]'
                    }`}
                  >
                    Log In
                  </button>
                </div>

                {authMode === 'signup' && (
                  <div>
                    <h2 className="text-sm font-bold text-[#3E0911] mb-2.5">
                      {t('auth.chooseRole')}
                    </h2>
                    <div className="grid sm:grid-cols-3 gap-2.5">
                      {(
                        [
                          {
                            id: 'elderly',
                            title: t('auth.roleElderly'),
                            desc: t('auth.roleElderlyDesc'),
                          },
                          {
                            id: 'family',
                            title: t('auth.roleFamily'),
                            desc: t('auth.roleFamilyDesc'),
                          },
                          {
                            id: 'caregiver',
                            title: t('auth.roleCaregiver'),
                            desc: t('auth.roleCaregiverDesc'),
                          },
                        ] as const
                      ).map((roleItem) => (
                        <button
                          key={roleItem.id}
                          type="button"
                          onClick={() => setSelectedRole(roleItem.id)}
                          className={`text-left min-h-[64px] p-3.5 rounded-2xl border transition-all cursor-pointer ${
                            selectedRole === roleItem.id
                              ? 'bg-white border-[#71774B] ring-2 ring-[#71774B]/25'
                              : 'bg-white/70 border-[#3E0911]/15 hover:bg-white'
                          }`}
                        >
                          <div className="font-bold text-sm text-[#3E0911]">{roleItem.title}</div>
                          <div className="text-xs text-[#5D4A44] mt-1 leading-snug">
                            {roleItem.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        autoComplete="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g., Meera Iyer"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                      />
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        Password *
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className="w-full min-h-[44px] pl-3.5 pr-12 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5D4A44] hover:text-[#3E0911] cursor-pointer"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="cb-btn-3d w-full min-h-[48px] py-3 px-6 rounded-2xl bg-[#383C23] hover:bg-[#2A2D1A] disabled:opacity-60 text-white font-bold text-[15px] cursor-pointer"
                  >
                    {busy
                      ? t('auth.signingIn')
                      : authMode === 'signup'
                        ? 'Create Account with Email'
                        : 'Log In with Email'}
                  </button>
                </form>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-[#3E0911]/15" />
                  <span className="shrink-0 mx-3 text-xs font-semibold uppercase tracking-wider text-[#5D4A44]">
                    or
                  </span>
                  <div className="flex-grow border-t border-[#3E0911]/15" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={busy}
                  className="cb-btn-3d w-full min-h-[48px] py-3.5 px-6 rounded-2xl bg-[#71774B] hover:bg-[#5E633D] disabled:opacity-60 text-white font-bold text-base cursor-pointer"
                >
                  {busy ? t('auth.signingIn') : t('auth.signInGoogle')}
                </button>
              </div>
            ) : !emailVerified ? (
              <div className="space-y-5 py-2">
                <div className="p-5 rounded-2xl bg-white border border-[#71774B]/30 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#71774B]/15 flex items-center justify-center text-[#71774B]">
                      <MailCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-[#3E0911]">Verify Your Email Address</h2>
                      <p className="text-sm text-[#5D4A44]">
                        Signed in as <strong>{firebaseUser.email}</strong>
                      </p>
                    </div>
                  </div>
                  <p className="text-[15px] text-[#5D4A44] leading-relaxed">
                    To protect elderly care records, CareBridge requires email verification before opening or creating a Care Circle. Please click the verification link in your inbox, then continue below.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCheckVerification}
                    className="cb-btn-3d flex-1 min-h-[48px] py-3 px-5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] disabled:opacity-60 text-white font-bold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    I&apos;ve Verified — Continue
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResendVerification}
                    className="min-h-[48px] py-3 px-5 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#E5DDD0] text-[#3E0911] font-semibold text-[15px] cursor-pointer"
                  >
                    Resend Email
                  </button>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={logout}
                  className="min-h-[44px] inline-flex items-center gap-1.5 text-sm font-semibold text-[#85383E] hover:underline cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Use another account
                </button>
              </div>
            ) : (
              <form onSubmit={handleFinishSetup} className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-[#3E0911]">{t('auth.setupCareTitle')}</h2>
                    <p className="text-sm text-[#5D4A44] mt-0.5 truncate">
                      Signed in as {firebaseUser.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#3E0911]/15 bg-white hover:bg-[#E5DDD0] text-sm font-semibold text-[#3E0911] cursor-pointer shrink-0"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('nav.logout')}
                  </button>
                </div>

                {!profile && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['elderly', 'family', 'caregiver'] as const).map((roleOption) => (
                      <button
                        key={roleOption}
                        type="button"
                        onClick={() => setSelectedRole(roleOption)}
                        className={`min-h-[44px] py-2 px-3 rounded-xl border text-sm font-bold capitalize cursor-pointer ${
                          selectedRole === roleOption
                            ? 'bg-white border-[#71774B] text-[#3E0911] ring-2 ring-[#71774B]/20'
                            : 'bg-white/60 border-[#3E0911]/15 text-[#5D4A44]'
                        }`}
                      >
                        {roleOption === 'elderly'
                          ? t('auth.roleElderly')
                          : roleOption === 'family'
                            ? t('auth.roleFamily')
                            : t('auth.roleCaregiver')}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                      Your Name
                    </label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Full name"
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                      {t('appointments.timezoneLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base font-mono text-[#3E0911]"
                    />
                  </div>
                </div>

                {/* Mode switcher: Create Care Profile vs Join with Invitation Code */}
                <div className="flex gap-2 p-1 bg-[#E5DDD0] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSetupMode('create')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                      setupMode === 'create'
                        ? 'bg-white text-[#3E0911] shadow-sm'
                        : 'text-[#5D4A44]'
                    }`}
                  >
                    <UserPlus className="w-4 h-4" />
                    {t('auth.createNewProfile')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetupMode('join')}
                    className={`flex-1 min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                      setupMode === 'join'
                        ? 'bg-white text-[#3E0911] shadow-sm'
                        : 'text-[#5D4A44]'
                    }`}
                  >
                    <KeyRound className="w-4 h-4" />
                    {t('auth.joinWithCode')}
                  </button>
                </div>

                {setupMode === 'create' ? (
                  <div className="grid sm:grid-cols-3 gap-3.5">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        {t('auth.elderlyNameLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={elderlyName}
                        onChange={(e) => setElderlyName(e.target.value)}
                        placeholder="e.g., Shri Raghavan Iyer"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        {t('auth.elderlyAgeLabel')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={125}
                        required
                        value={elderlyAge}
                        onChange={(e) => setElderlyAge(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base tabular-nums text-[#3E0911]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        {t('auth.primaryPhysicianLabel')}
                      </label>
                      <input
                        type="text"
                        value={primaryPhysician}
                        onChange={(e) => setPrimaryPhysician(e.target.value)}
                        placeholder="Optional (e.g., Dr. Ananya Nair)"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        {t('auth.inviteCodeLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder="CB-XXXX-XXXX"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base font-mono uppercase text-[#3E0911]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#3E0911] mb-1.5">
                        {t('auth.relationshipLabel')}
                      </label>
                      <input
                        type="text"
                        value={relationship}
                        onChange={(e) => setRelationship(e.target.value)}
                        placeholder="Daughter / Caregiver"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#3E0911]/20 text-base text-[#3E0911]"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="cb-btn-3d flex-1 min-h-[48px] py-3 px-5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] disabled:opacity-60 text-white font-bold text-[15px] cursor-pointer"
                  >
                    {busy
                      ? 'Saving...'
                      : setupMode === 'join'
                        ? t('auth.joinCareGroup')
                        : t('auth.completeSetup')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSeedDemo}
                    className="min-h-[48px] py-3 px-5 rounded-xl border border-[#3E0911]/20 bg-white hover:bg-[#E5DDD0] text-[#3E0911] font-semibold text-[15px] inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-[#71774B]" />
                    {t('auth.loadDemoData')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
