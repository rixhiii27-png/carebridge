export type UserRole = 'elderly' | 'family' | 'caregiver';

export type MedicationFrequency =
  | 'once_daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'weekly'
  | 'as_needed';

export type DoseStatus = 'not_confirmed' | 'taken' | 'skipped' | 'missed';

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export type NotificationType =
  | 'upcoming_dose'
  | 'unconfirmed_dose'
  | 'missed_dose'
  | 'upcoming_appointment'
  | 'caregiver_update';

export type NotificationChannel = 'in_app' | 'email';

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped_preference';

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  preferredLanguage: string;
  preferredScript?: string;
  timezone: string;
  largeText?: boolean;
  highContrast?: boolean;
  largeButtons?: boolean;
  simpleNavigation?: boolean;
  reducedMotion?: boolean;
  voiceEnabled?: boolean;
  activeGroupId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  emergencyContact?: string;
  address?: string;
  updatedAt?: unknown;
}

export interface CareGroup {
  id: string;
  ownerId: string;
  elderlyName: string;
  elderlyAge: number;
  bloodGroup?: string;
  primaryPhysician?: string;
  primaryClinic?: string;
  timezone: string;
  allergies?: string[];
  conditions?: string[];
  memberUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CareMember {
  uid: string;
  groupId: string;
  displayName: string;
  role: UserRole;
  relationship?: string;
  inviteCode?: string;
  canEditMedications: boolean;
  canEditAppointments: boolean;
  status: 'active' | 'revoked';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CareMembership {
  uid: string;
  groupId: string;
  elderlyName: string;
  role: UserRole;
  status: 'active' | 'revoked';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Invitation {
  code: string;
  groupId: string;
  elderlyName: string;
  createdBy: string;
  targetRole: 'family' | 'caregiver';
  canEditMedications: boolean;
  canEditAppointments: boolean;
  status: 'pending' | 'redeemed' | 'revoked';
  redeemedBy?: string;
  expiresAtMs: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Medication {
  id: string;
  groupId: string;
  memberUids: string[];
  name: string;
  dosage: string;
  scheduleTimes: string[];
  frequency: MedicationFrequency;
  startDate: string;
  endDate?: string;
  instructions?: string;
  prescriberName?: string;
  prescriberClinic?: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MedicationLog {
  id: string;
  groupId: string;
  memberUids: string[];
  medicationId: string;
  medicationName: string;
  scheduledDate: string;
  scheduledTime: string;
  status: DoseStatus;
  note?: string;
  updatedByUid: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Appointment {
  id: string;
  groupId: string;
  memberUids: string[];
  doctorName: string;
  specialty?: string;
  clinicName: string;
  appointmentDate: string;
  appointmentTime: string;
  timezone: string;
  notes?: string;
  reminderMinutesBefore: number;
  status: AppointmentStatus;
  createdBy: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationRecord {
  id: string;
  groupId: string;
  recipientUid: string;
  type: NotificationType;
  title: string;
  message: string;
  channel: NotificationChannel;
  deliveryStatus: DeliveryStatus;
  dedupeKey: string;
  read: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationPreference {
  uid: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  upcomingDoseAlert: boolean;
  unconfirmedDoseAlert: boolean;
  missedDoseAlert: boolean;
  appointmentAlert: boolean;
  caregiverUpdateAlert: boolean;
  timezone: string;
  updatedAt?: unknown;
}

export interface ActivityLog {
  id: string;
  groupId: string;
  memberUids: string[];
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  actionType: string;
  entityType:
    | 'medication'
    | 'medicationLog'
    | 'appointment'
    | 'careGroup'
    | 'member'
    | 'invitation'
    | 'notification';
  entityId: string;
  summary: string;
  createdAt?: unknown;
}
