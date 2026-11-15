import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getLanguageMeta, resolveLanguageDirection } from '../i18n/languages.ts';
import {
  fetchCareMembers,
  subscribeCareGroup,
  subscribeGroupActivityLogs,
  subscribeGroupAppointments,
  subscribeGroupMedicationLogs,
  subscribeGroupMedications,
  subscribeUserMemberships,
  subscribeUserNotifications,
  updateUserPreferences,
  upsertUserProfile,
} from '../services/firestoreService.ts';
import {
  auth,
  db,
  formatCareBridgeError,
  googleProvider,
  logFirestoreError,
  OperationType,
} from '../services/firebase.ts';
import type {
  ActivityLog,
  Appointment,
  CareGroup,
  CareMember,
  CareMembership,
  Medication,
  MedicationLog,
  NotificationRecord,
  UserProfile,
  UserRole,
} from '../types/carebridge.ts';

interface AccessibilitySettings {
  largeText: boolean;
  highContrast: boolean;
  largeButtons: boolean;
  simpleNavigation: boolean;
  reducedMotion: boolean;
  voiceEnabled: boolean;
}

interface CareBridgeContextValue {
  firebaseUser: User | null;
  emailVerified: boolean;
  authReady: boolean;
  profile: UserProfile | null;
  profileLoaded: boolean;
  memberships: CareMembership[];
  membershipsLoaded: boolean;
  syncError: string | null;
  retrySync: () => void;
  activeGroupId: string | null;
  activeGroup: CareGroup | null;
  members: CareMember[];
  currentMember: CareMember | null;
  medications: Medication[];
  medicationLogs: MedicationLog[];
  appointments: Appointment[];
  notifications: NotificationRecord[];
  activityLogs: ActivityLog[];
  languageCode: string;
  scriptId: string;
  dir: 'ltr' | 'rtl';
  accessibility: AccessibilitySettings;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  setActiveGroupId: (groupId: string) => Promise<void>;
  setLanguageAndScript: (code: string, script?: string) => Promise<void>;
  updateAccessibility: (patch: Partial<AccessibilitySettings>) => Promise<void>;
  signInWithGoogle: () => Promise<User>;
  signUpWithEmail: (params: {
    displayName: string;
    email: string;
    password: string;
  }) => Promise<User>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  completeOnboardingProfile: (params: {
    displayName: string;
    role: UserRole;
    timezone: string;
  }) => Promise<void>;
  refreshMembers: () => Promise<void>;
  logout: () => Promise<void>;
}

const CareBridgeContext = createContext<CareBridgeContextValue | null>(null);

export const CareBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [memberships, setMemberships] = useState<CareMembership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncEpoch, setSyncEpoch] = useState(0);

  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<CareGroup | null>(null);
  const [members, setMembers] = useState<CareMember[]>([]);

  const [medications, setMedications] = useState<Medication[]>([]);
  const [medicationLogs, setMedicationLogs] = useState<MedicationLog[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [localLang, setLocalLang] = useState<string>(
    () => window.localStorage.getItem('carebridge_lang') || 'en',
  );
  const [localScript, setLocalScript] = useState<string>(
    () => window.localStorage.getItem('carebridge_script') || getLanguageMeta(localLang).defaultScript,
  );
  const [localAccess, setLocalAccess] = useState<AccessibilitySettings>({
    largeText: false,
    highContrast: false,
    largeButtons: false,
    simpleNavigation: false,
    reducedMotion: false,
    voiceEnabled: false,
  });

  const retrySync = useCallback(() => {
    setSyncError(null);
    setSyncEpoch((prev) => prev + 1);
  }, []);

  // Listen to Firebase Auth state (persisted via browserLocalPersistence)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setEmailVerified(Boolean(user?.emailVerified));
      setAuthReady(true);
      setSyncError(null);
      if (!user) {
        setProfile(null);
        setProfileLoaded(true);
        setMemberships([]);
        setMembershipsLoaded(true);
        setActiveGroupIdState(null);
        setActiveGroup(null);
        setMembers([]);
        setMedications([]);
        setMedicationLogs([]);
        setAppointments([]);
        setNotifications([]);
        setActivityLogs([]);
      }
    });
    return unsub;
  }, []);

  // Subscribe to user profile when signed in & verified
  useEffect(() => {
    if (!authReady) return;
    if (!firebaseUser) {
      setProfileLoaded(true);
      return;
    }
    if (!emailVerified) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }

    setProfileLoaded(false);
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          setLocalLang(data.preferredLanguage || 'en');
          setLocalScript(
            data.preferredScript || getLanguageMeta(data.preferredLanguage || 'en').defaultScript,
          );
          setLocalAccess({
            largeText: Boolean(data.largeText),
            highContrast: Boolean(data.highContrast),
            largeButtons: Boolean(data.largeButtons),
            simpleNavigation: Boolean(data.simpleNavigation),
            reducedMotion: Boolean(data.reducedMotion),
            voiceEnabled: Boolean(data.voiceEnabled),
          });
        } else {
          setProfile(null);
        }
        setProfileLoaded(true);
      },
      (err) => {
        logFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        setSyncError(formatCareBridgeError(err));
        setProfileLoaded(true);
      },
    );
    return unsub;
  }, [authReady, firebaseUser, emailVerified, syncEpoch]);

  // Subscribe to memberships & user notifications (without activeGroupId in deps)
  useEffect(() => {
    if (!authReady) return;
    if (!firebaseUser || !emailVerified) {
      setMemberships([]);
      setMembershipsLoaded(true);
      setNotifications([]);
      return;
    }

    setMembershipsLoaded(false);
    const unsubM = subscribeUserMemberships(
      firebaseUser.uid,
      (items) => {
        setMemberships(items);
        setMembershipsLoaded(true);
      },
      (err) => {
        setSyncError(formatCareBridgeError(err));
        setMembershipsLoaded(true);
      },
    );

    const unsubN = subscribeUserNotifications(
      firebaseUser.uid,
      setNotifications,
      (err) => {
        setSyncError(formatCareBridgeError(err));
      },
    );

    return () => {
      unsubM();
      unsubN();
    };
  }, [authReady, firebaseUser, emailVerified, syncEpoch]);

  // Reconcile activeGroupId whenever memberships or profile load/change
  useEffect(() => {
    if (!membershipsLoaded) return;
    if (memberships.length === 0) {
      setActiveGroupIdState(null);
      return;
    }
    setActiveGroupIdState((prev) => {
      if (prev && memberships.some((m) => m.groupId === prev)) {
        return prev;
      }
      if (profile?.activeGroupId && memberships.some((m) => m.groupId === profile.activeGroupId)) {
        return profile.activeGroupId;
      }
      return memberships[0].groupId;
    });
  }, [membershipsLoaded, memberships, profile?.activeGroupId]);

  // Subscribe to active CareGroup & its collections
  useEffect(() => {
    if (!authReady || !firebaseUser || !emailVerified || !activeGroupId) {
      setActiveGroup(null);
      setMedications([]);
      setMedicationLogs([]);
      setAppointments([]);
      setActivityLogs([]);
      return;
    }

    const onSubError = (err: unknown) => {
      setSyncError(formatCareBridgeError(err));
    };

    const unsubG = subscribeCareGroup(firebaseUser.uid, activeGroupId, setActiveGroup, onSubError);
    const unsubMed = subscribeGroupMedications(
      firebaseUser.uid,
      activeGroupId,
      setMedications,
      onSubError,
    );
    const unsubLogs = subscribeGroupMedicationLogs(
      firebaseUser.uid,
      activeGroupId,
      setMedicationLogs,
      onSubError,
    );
    const unsubApt = subscribeGroupAppointments(
      firebaseUser.uid,
      activeGroupId,
      setAppointments,
      onSubError,
    );
    const unsubAct = subscribeGroupActivityLogs(
      firebaseUser.uid,
      activeGroupId,
      setActivityLogs,
      onSubError,
    );

    return () => {
      unsubG();
      unsubMed();
      unsubLogs();
      unsubApt();
      unsubAct();
    };
  }, [authReady, firebaseUser, emailVerified, activeGroupId, syncEpoch]);

  const refreshMembers = useCallback(async () => {
    if (!activeGroupId || !activeGroup?.memberUids?.length) {
      setMembers([]);
      return;
    }
    try {
      const list = await fetchCareMembers(activeGroupId, activeGroup.memberUids);
      setMembers(list);
    } catch (err) {
      setSyncError(formatCareBridgeError(err));
      setMembers([]);
    }
  }, [activeGroupId, activeGroup?.memberUids]);

  useEffect(() => {
    refreshMembers();
  }, [refreshMembers]);

  // Sync language, script, RTL direction, and accessibility classes to <html>
  const languageCode = profile?.preferredLanguage || localLang;
  const scriptId =
    profile?.preferredScript || localScript || getLanguageMeta(languageCode).defaultScript;
  const dir = resolveLanguageDirection(languageCode, scriptId);

  useEffect(() => {
    if (i18n.language !== languageCode) {
      i18n.changeLanguage(languageCode);
    }
    window.localStorage.setItem('carebridge_lang', languageCode);
    window.localStorage.setItem('carebridge_script', scriptId);
    document.documentElement.lang = getLanguageMeta(languageCode).bcp47;
    document.documentElement.dir = dir;
  }, [languageCode, scriptId, dir, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('cb-large-text', localAccess.largeText);
    root.classList.toggle('cb-high-contrast', localAccess.highContrast);
    root.classList.toggle('cb-large-buttons', localAccess.largeButtons);
    root.classList.toggle('cb-reduced-motion', localAccess.reducedMotion);
  }, [localAccess]);

  const setLanguageAndScript = useCallback(
    async (code: string, script?: string) => {
      const meta = getLanguageMeta(code);
      const chosenScript = script || meta.defaultScript;
      setLocalLang(code);
      setLocalScript(chosenScript);
      await i18n.changeLanguage(code);
      if (firebaseUser && profile) {
        await updateUserPreferences(firebaseUser.uid, {
          preferredLanguage: code,
          preferredScript: chosenScript,
        });
      }
    },
    [firebaseUser, profile, i18n],
  );

  const updateAccessibility = useCallback(
    async (patch: Partial<AccessibilitySettings>) => {
      setLocalAccess((prev) => ({ ...prev, ...patch }));
      if (firebaseUser && profile) {
        await updateUserPreferences(firebaseUser.uid, patch);
      }
    },
    [firebaseUser, profile],
  );

  const setActiveGroupId = useCallback(
    async (groupId: string) => {
      setActiveGroupIdState(groupId);
      if (firebaseUser && profile) {
        await updateUserPreferences(firebaseUser.uid, { activeGroupId: groupId });
      }
    },
    [firebaseUser, profile],
  );

  const signInWithGoogle = useCallback(async () => {
    const res = await signInWithPopup(auth, googleProvider);
    setEmailVerified(Boolean(res.user.emailVerified));
    return res.user;
  }, []);

  const signUpWithEmail = useCallback(
    async (params: { displayName: string; email: string; password: string }) => {
      const cred = await createUserWithEmailAndPassword(
        auth,
        params.email.trim(),
        params.password,
      );
      if (params.displayName.trim()) {
        await updateProfile(cred.user, { displayName: params.displayName.trim() });
      }
      try {
        await sendEmailVerification(cred.user);
      } catch (err) {
        console.warn('Initial verification email could not be dispatched:', err);
      }
      setEmailVerified(Boolean(cred.user.emailVerified));
      return cred.user;
    },
    [],
  );

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    setEmailVerified(Boolean(cred.user.emailVerified));
    return cred.user;
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    await sendEmailVerification(auth.currentUser);
  }, []);

  const refreshAuthUser = useCallback(async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      await auth.currentUser.getIdToken(true);
    }
    const verified = Boolean(auth.currentUser.emailVerified);
    setFirebaseUser(auth.currentUser);
    setEmailVerified(verified);
    return verified;
  }, []);

  const completeOnboardingProfile = useCallback(
    async (params: { displayName: string; role: UserRole; timezone: string }) => {
      if (!firebaseUser) throw new Error('Must be signed in first.');
      await upsertUserProfile({
        uid: firebaseUser.uid,
        displayName: params.displayName,
        email: firebaseUser.email || 'user@carebridge.local',
        role: params.role,
        preferredLanguage: localLang,
        preferredScript: localScript,
        timezone: params.timezone,
      });
    },
    [firebaseUser, localLang, localScript],
  );

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const currentMember = useMemo(() => {
    if (!firebaseUser) return null;
    return members.find((m) => m.uid === firebaseUser.uid) || null;
  }, [members, firebaseUser]);

  const value: CareBridgeContextValue = {
    firebaseUser,
    emailVerified,
    authReady,
    profile,
    profileLoaded,
    memberships,
    membershipsLoaded,
    syncError,
    retrySync,
    activeGroupId,
    activeGroup,
    members,
    currentMember,
    medications,
    medicationLogs,
    appointments,
    notifications,
    activityLogs,
    languageCode,
    scriptId,
    dir,
    accessibility: localAccess,
    searchQuery,
    setSearchQuery,
    setActiveGroupId,
    setLanguageAndScript,
    updateAccessibility,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    resendVerificationEmail,
    refreshAuthUser,
    completeOnboardingProfile,
    refreshMembers,
    logout,
  };

  return <CareBridgeContext.Provider value={value}>{children}</CareBridgeContext.Provider>;
};

export function useCareBridge(): CareBridgeContextValue {
  const ctx = useContext(CareBridgeContext);
  if (!ctx) {
    throw new Error('useCareBridge must be used inside CareBridgeProvider');
  }
  return ctx;
}
