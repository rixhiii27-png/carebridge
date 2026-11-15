import { z } from 'zod';
import { isValidIanaTimezone } from '../utils/idAndDate.ts';

const safeIdRegex = /^[a-zA-Z0-9_-]{1,128}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const safeIdSchema = z.string().min(1).max(128).regex(safeIdRegex, 'Invalid identifier format.');

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => isValidIanaTimezone(tz), 'Invalid IANA timezone identifier.');

export const idParamSchema = z.object({
  id: safeIdSchema,
});

export const groupMemberParamsSchema = z.object({
  id: safeIdSchema,
  uid: safeIdSchema,
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export const groupScopedQuerySchema = paginationQuerySchema.extend({
  groupId: safeIdSchema,
});

export const updateUserMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    preferredLanguage: z.string().trim().min(2).max(16).optional(),
    preferredScript: z.string().trim().min(2).max(32).optional(),
    timezone: timezoneSchema.optional(),
    largeText: z.boolean().optional(),
    highContrast: z.boolean().optional(),
    largeButtons: z.boolean().optional(),
    simpleNavigation: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
    voiceEnabled: z.boolean().optional(),
    activeGroupId: safeIdSchema.optional(),
    phone: z.string().trim().max(32).optional(),
    emergencyContact: z.string().trim().max(160).optional(),
    address: z.string().trim().max(250).optional(),
  })
  .strict();

export const createCareGroupSchema = z
  .object({
    elderlyName: z.string().trim().min(1).max(120),
    elderlyAge: z.number().int().min(1).max(130),
    ownerRole: z.enum(['elderly', 'family', 'caregiver']).default('elderly'),
    bloodGroup: z.string().trim().max(16).optional(),
    primaryPhysician: z.string().trim().max(120).optional(),
    primaryClinic: z.string().trim().max(160).optional(),
    timezone: timezoneSchema.default('Asia/Kolkata'),
    allergies: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    conditions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    targetRole: z.enum(['family', 'caregiver']),
    canEditMedications: z.boolean().default(false),
    canEditAppointments: z.boolean().default(true),
    invitedEmail: z.string().trim().email().max(254).optional(),
    expiresInHours: z.number().int().min(1).max(168).default(24),
  })
  .strict();

export const redeemInvitationSchema = z
  .object({
    token: z.string().trim().min(6).max(128).optional(),
    code: z.string().trim().min(6).max(128).optional(),
    relationship: z.string().trim().max(64).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.token || v.code), {
    message: 'Either invitation token or code is required.',
  });

export const updateMemberPermissionsSchema = z
  .object({
    canEditMedications: z.boolean().optional(),
    canEditAppointments: z.boolean().optional(),
    status: z.enum(['active', 'revoked']).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.canEditMedications !== undefined ||
      v.canEditAppointments !== undefined ||
      v.status !== undefined,
    { message: 'At least one permission or status field must be provided.' },
  );

const medicationFrequencySchema = z.enum([
  'once_daily',
  'twice_daily',
  'three_times_daily',
  'weekly',
  'as_needed',
]);

export const createMedicationSchema = z
  .object({
    groupId: safeIdSchema,
    name: z.string().trim().min(1).max(120).optional(),
    medicationName: z.string().trim().min(1).max(120).optional(),
    dosage: z.string().trim().min(1).max(80),
    scheduleTimes: z.array(z.string().trim().regex(hhmmRegex, 'Times must be HH:MM (24h).')).min(1).max(8),
    frequency: medicationFrequencySchema,
    startDate: z.string().trim().regex(isoDateRegex, 'startDate must be YYYY-MM-DD.'),
    endDate: z.string().trim().regex(isoDateRegex, 'endDate must be YYYY-MM-DD.').optional(),
    instructions: z.string().trim().max(500).optional(),
    prescriberName: z.string().trim().max(120).optional(),
    prescribingClinician: z.string().trim().max(120).optional(),
    prescriberClinic: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.name || v.medicationName), {
    message: 'Medication name is required.',
  });

export const updateMedicationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    medicationName: z.string().trim().min(1).max(120).optional(),
    dosage: z.string().trim().min(1).max(80).optional(),
    scheduleTimes: z.array(z.string().trim().regex(hhmmRegex)).min(1).max(8).optional(),
    frequency: medicationFrequencySchema.optional(),
    startDate: z.string().trim().regex(isoDateRegex).optional(),
    endDate: z.string().trim().regex(isoDateRegex).optional(),
    instructions: z.string().trim().max(500).optional(),
    prescriberName: z.string().trim().max(120).optional(),
    prescribingClinician: z.string().trim().max(120).optional(),
    prescriberClinic: z.string().trim().max(160).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const recordDoseSchema = z
  .object({
    scheduledDate: z.string().trim().regex(isoDateRegex, 'scheduledDate must be YYYY-MM-DD.'),
    scheduledTime: z.string().trim().regex(hhmmRegex, 'scheduledTime must be HH:MM.'),
    status: z.enum(['taken', 'skipped', 'missed', 'not_confirmed', 'unconfirmed']),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const medicationHistoryQuerySchema = paginationQuerySchema.extend({
  fromDate: z.string().trim().regex(isoDateRegex).optional(),
  toDate: z.string().trim().regex(isoDateRegex).optional(),
});

export const createAppointmentSchema = z
  .object({
    groupId: safeIdSchema,
    doctorName: z.string().trim().min(1).max(120),
    specialty: z.string().trim().max(80).optional(),
    clinicName: z.string().trim().min(1).max(160).optional(),
    hospitalName: z.string().trim().min(1).max(160).optional(),
    appointmentDate: z.string().trim().regex(isoDateRegex, 'appointmentDate must be YYYY-MM-DD.'),
    appointmentTime: z.string().trim().regex(hhmmRegex, 'appointmentTime must be HH:MM.'),
    timezone: timezoneSchema.default('Asia/Kolkata'),
    notes: z.string().trim().max(500).optional(),
    reminderMinutesBefore: z.number().int().min(0).max(10080).default(120),
  })
  .strict()
  .refine((v) => Boolean(v.clinicName || v.hospitalName), {
    message: 'clinicName is required.',
  });

export const updateAppointmentSchema = z
  .object({
    doctorName: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().max(80).optional(),
    clinicName: z.string().trim().min(1).max(160).optional(),
    hospitalName: z.string().trim().min(1).max(160).optional(),
    appointmentDate: z.string().trim().regex(isoDateRegex).optional(),
    appointmentTime: z.string().trim().regex(hhmmRegex).optional(),
    timezone: timezoneSchema.optional(),
    notes: z.string().trim().max(500).optional(),
    reminderMinutesBefore: z.number().int().min(0).max(10080).optional(),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  })
  .strict();

export const notificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const updateNotificationPreferencesSchema = z
  .object({
    inAppEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    upcomingDoseAlert: z.boolean().optional(),
    unconfirmedDoseAlert: z.boolean().optional(),
    missedDoseAlert: z.boolean().optional(),
    appointmentAlert: z.boolean().optional(),
    caregiverUpdateAlert: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export const dashboardAdherenceQuerySchema = z.object({
  groupId: safeIdSchema,
  period: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
});

export const dashboardOverviewQuerySchema = z.object({
  groupId: safeIdSchema,
});
