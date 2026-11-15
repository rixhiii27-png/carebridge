export type NotificationCategory =
  | 'upcoming_dose'
  | 'unconfirmed_dose'
  | 'missed_dose'
  | 'upcoming_appointment'
  | 'caregiver_update';

export interface LocalizedNotificationPayload {
  title: string;
  message: string;
  languageCode: string;
  direction: 'ltr' | 'rtl';
  bcp47: string;
}

const LANGUAGE_BCP47: Record<string, { bcp47: string; dir: 'ltr' | 'rtl' }> = {
  en: { bcp47: 'en-IN', dir: 'ltr' },
  hi: { bcp47: 'hi-IN', dir: 'ltr' },
  as: { bcp47: 'as-IN', dir: 'ltr' },
  bn: { bcp47: 'bn-IN', dir: 'ltr' },
  brx: { bcp47: 'brx-IN', dir: 'ltr' },
  doi: { bcp47: 'doi-IN', dir: 'ltr' },
  gu: { bcp47: 'gu-IN', dir: 'ltr' },
  kn: { bcp47: 'kn-IN', dir: 'ltr' },
  ks: { bcp47: 'ks-IN', dir: 'rtl' },
  kok: { bcp47: 'kok-IN', dir: 'ltr' },
  mai: { bcp47: 'mai-IN', dir: 'ltr' },
  ml: { bcp47: 'ml-IN', dir: 'ltr' },
  mni: { bcp47: 'mni-IN', dir: 'ltr' },
  mr: { bcp47: 'mr-IN', dir: 'ltr' },
  ne: { bcp47: 'ne-IN', dir: 'ltr' },
  or: { bcp47: 'or-IN', dir: 'ltr' },
  pa: { bcp47: 'pa-IN', dir: 'ltr' },
  sa: { bcp47: 'sa-IN', dir: 'ltr' },
  sat: { bcp47: 'sat-IN', dir: 'ltr' },
  sd: { bcp47: 'sd-IN', dir: 'rtl' },
  ta: { bcp47: 'ta-IN', dir: 'ltr' },
  te: { bcp47: 'te-IN', dir: 'ltr' },
  ur: { bcp47: 'ur-IN', dir: 'rtl' },
};

interface TemplateSet {
  upcomingDoseTitle: (medName: string) => string;
  upcomingDoseBody: (medName: string, timeLabel: string, elderlyName: string) => string;
  unconfirmedDoseTitle: (medName: string) => string;
  unconfirmedDoseBody: (medName: string, timeLabel: string, elderlyName: string) => string;
  missedDoseTitle: (medName: string) => string;
  missedDoseBody: (medName: string, timeLabel: string, elderlyName: string) => string;
  appointmentTitle: (doctorName: string) => string;
  appointmentBody: (doctorName: string, clinicName: string, dateTimeLabel: string) => string;
  caregiverUpdateTitle: () => string;
  caregiverUpdateBody: (summary: string) => string;
}

const TEMPLATES: Record<string, TemplateSet> = {
  en: {
    upcomingDoseTitle: (med) => `Upcoming dose: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `Reminder for ${elderly}: scheduled dose of ${med} at ${time}.`,
    unconfirmedDoseTitle: (med) => `Dose confirmation needed: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `The ${time} dose of ${med} for ${elderly} is still not confirmed.`,
    missedDoseTitle: (med) => `Missed dose alert: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `The ${time} dose of ${med} for ${elderly} was marked missed.`,
    appointmentTitle: (doc) => `Upcoming appointment: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `Scheduled visit with ${doc} at ${clinic} (${dt}).`,
    caregiverUpdateTitle: () => 'Care circle update',
    caregiverUpdateBody: (summary) => summary,
  },
  hi: {
    upcomingDoseTitle: (med) => `आगामी खुराक अनुस्मारक: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly} के लिए अनुस्मारक: ${med} की निर्धारित खुराक ${time} पर है।`,
    unconfirmedDoseTitle: (med) => `खुराक पुष्टि आवश्यक: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly} के लिए ${med} की ${time} की खुराक की पुष्टि अभी बाकी है।`,
    missedDoseTitle: (med) => `छूटी हुई खुराक सूचना: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly} के लिए ${med} की ${time} की खुराक छूटी हुई दर्ज की गई है।`,
    appointmentTitle: (doc) => `आगामी डॉक्टर अपॉइंटमेंट: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc} के साथ ${clinic} में निर्धारित भेंट (${dt})।`,
    caregiverUpdateTitle: () => 'देखभाल समूह अपडेट',
    caregiverUpdateBody: (summary) => summary,
  },
  bn: {
    upcomingDoseTitle: (med) => `আসন্ন ডোজ অনুস্মারক: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly}-এর জন্য অনুস্মারক: ${med}-এর নির্ধারিত ডোজ ${time}-এ।`,
    unconfirmedDoseTitle: (med) => `ডোজ নিশ্চিতকরণ প্রয়োজন: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly}-এর জন্য ${med}-এর ${time} ডোজ এখনো নিশ্চিত করা হয়নি।`,
    missedDoseTitle: (med) => `মিসড ডোজ সতর্কতা: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly}-এর জন্য ${med}-এর ${time} ডোজ মিস হয়েছে বলে চিহ্নিত।`,
    appointmentTitle: (doc) => `আসন্ন ডাক্তারের অ্যাপয়েন্টমেন্ট: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc}-এর সাথে ${clinic}-এ নির্ধারিত সাক্ষাৎ (${dt})।`,
    caregiverUpdateTitle: () => 'কেয়ার সার্কেল আপডেট',
    caregiverUpdateBody: (summary) => summary,
  },
  ta: {
    upcomingDoseTitle: (med) => `வரவிருக்கும் மருந்து நினைவூட்டல்: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly} அவர்களுக்கான நினைவூட்டல்: ${med} மருந்து நேரம் ${time}.`,
    unconfirmedDoseTitle: (med) => `மருந்து உறுதிப்படுத்தல் தேவை: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly} அவர்களுக்கு ${time} மணி ${med} மருந்து இன்னும் உறுதிப்படுத்தப்படவில்லை.`,
    missedDoseTitle: (med) => `தவறிய மருந்து அறிவிப்பு: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly} அவர்களுக்கு ${time} மணி ${med} மருந்து தவறியதாக குறிக்கப்பட்டது.`,
    appointmentTitle: (doc) => `வரவிருக்கும் மருத்துவர் சந்திப்பு: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc} அவர்களுடன் ${clinic}-இல் சந்திப்பு (${dt}).`,
    caregiverUpdateTitle: () => 'பராமரிப்பு குழு தகவல்',
    caregiverUpdateBody: (summary) => summary,
  },
  te: {
    upcomingDoseTitle: (med) => `రాబోయే మోతాదు రిమైండర్: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly} కోసం రిమైండర్: ${med} మోతాదు సమయం ${time}.`,
    unconfirmedDoseTitle: (med) => `మోతాదు నిర్ధారణ అవసరం: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly} కోసం ${time} ${med} మోతాదు ఇంకా నిర్ధారించబడలేదు.`,
    missedDoseTitle: (med) => `తప్పిపోయిన మోతాదు హెచ్చరిక: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly} కోసం ${time} ${med} మోతాదు తప్పిపోయినట్లు గుర్తించబడింది.`,
    appointmentTitle: (doc) => `రాబోయే డాక్టర్ అపాయింట్‌మెంట్: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc} తో ${clinic} లో అపాయింట్‌మెంట్ (${dt}).`,
    caregiverUpdateTitle: () => 'కేర్ సర్కిల్ అప్‌డేట్',
    caregiverUpdateBody: (summary) => summary,
  },
  mr: {
    upcomingDoseTitle: (med) => `आगामी डोस स्मरणपत्र: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly} साठी स्मरणपत्र: ${med} चा नियोजित डोस ${time} वाजता आहे.`,
    unconfirmedDoseTitle: (med) => `डोस पुष्टी आवश्यक: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly} साठी ${med} चा ${time} चा डोस अद्याप निश्चित झालेला नाही.`,
    missedDoseTitle: (med) => `चुकलेला डोस सूचना: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly} साठी ${med} चा ${time} चा डोस चुकलेला नोंदवला आहे.`,
    appointmentTitle: (doc) => `आगामी डॉक्टर भेट: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc} यांच्यासोबत ${clinic} येथे भेट (${dt}).`,
    caregiverUpdateTitle: () => 'केअर सर्कल अपडेट',
    caregiverUpdateBody: (summary) => summary,
  },
  ur: {
    upcomingDoseTitle: (med) => `آئندہ خوراک کی یاد دہانی: ${med}`,
    upcomingDoseBody: (med, time, elderly) =>
      `${elderly} کے لیے یاد دہانی: ${med} کی مقررہ خوراک ${time} پر ہے۔`,
    unconfirmedDoseTitle: (med) => `خوراک کی تصدیق درکار ہے: ${med}`,
    unconfirmedDoseBody: (med, time, elderly) =>
      `${elderly} کے لیے ${med} کی ${time} کی خوراک کی تصدیق ابھی باقی ہے۔`,
    missedDoseTitle: (med) => `چھوٹی ہوئی خوراک کا الرٹ: ${med}`,
    missedDoseBody: (med, time, elderly) =>
      `${elderly} کے لیے ${med} کی ${time} کی خوراک چھوٹ جانے کے طور پر درج ہے۔`,
    appointmentTitle: (doc) => `آئندہ ڈاکٹر کی ملاقات: ${doc}`,
    appointmentBody: (doc, clinic, dt) =>
      `${doc} کے ساتھ ${clinic} میں ملاقات (${dt})۔`,
    caregiverUpdateTitle: () => 'کیئر سرکل اپ ڈیٹ',
    caregiverUpdateBody: (summary) => summary,
  },
};

export function resolveNotificationLanguageMeta(
  languageCode?: string,
  preferredScript?: string,
): { code: string; bcp47: string; dir: 'ltr' | 'rtl' } {
  const code = (languageCode || 'en').toLowerCase();
  const meta = LANGUAGE_BCP47[code] ?? LANGUAGE_BCP47.en;
  const dir =
    preferredScript === 'Devanagari'
      ? 'ltr'
      : preferredScript === 'Perso-Arabic'
        ? 'rtl'
        : meta.dir;
  return {
    code: LANGUAGE_BCP47[code] ? code : 'en',
    bcp47: meta.bcp47,
    dir,
  };
}

export function formatLocalizedDateTimeLabel(
  isoDate: string,
  hhmm: string,
  timezone: string,
  bcp47: string,
): string {
  try {
    const [year, month, day] = isoDate.split('-').map(Number);
    const [hour, minute] = hhmm.split(':').map(Number);
    const dt = new Date(Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0));
    const dateFmt = new Intl.DateTimeFormat(bcp47, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(dt);
    return `${dateFmt} ${hhmm}`;
  } catch {
    return `${isoDate} ${hhmm}`;
  }
}

export function buildLocalizedNotification(params: {
  type: NotificationCategory;
  languageCode?: string;
  preferredScript?: string;
  timezone?: string;
  medicationName?: string;
  scheduledTime?: string;
  elderlyName?: string;
  doctorName?: string;
  clinicName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  summary?: string;
}): LocalizedNotificationPayload {
  const meta = resolveNotificationLanguageMeta(params.languageCode, params.preferredScript);
  const t = TEMPLATES[meta.code] ?? TEMPLATES.en;
  const med = (params.medicationName || 'Medication').slice(0, 100);
  const time = params.scheduledTime || '08:00';
  const elderly = (params.elderlyName || 'Resident').slice(0, 80);

  let title = '';
  let message = '';

  switch (params.type) {
    case 'upcoming_dose':
      title = t.upcomingDoseTitle(med);
      message = t.upcomingDoseBody(med, time, elderly);
      break;
    case 'unconfirmed_dose':
      title = t.unconfirmedDoseTitle(med);
      message = t.unconfirmedDoseBody(med, time, elderly);
      break;
    case 'missed_dose':
      title = t.missedDoseTitle(med);
      message = t.missedDoseBody(med, time, elderly);
      break;
    case 'upcoming_appointment': {
      const doctor = (params.doctorName || 'Doctor').slice(0, 100);
      const clinic = (params.clinicName || 'Clinic').slice(0, 100);
      const dtLabel = formatLocalizedDateTimeLabel(
        params.appointmentDate || '',
        params.appointmentTime || '09:00',
        params.timezone || 'Asia/Kolkata',
        meta.bcp47,
      );
      title = t.appointmentTitle(doctor);
      message = t.appointmentBody(doctor, clinic, dtLabel);
      break;
    }
    case 'caregiver_update':
    default:
      title = t.caregiverUpdateTitle();
      message = t.caregiverUpdateBody((params.summary || 'Care circle activity updated.').slice(0, 450));
      break;
  }

  return {
    title: title.slice(0, 140),
    message: message.slice(0, 500),
    languageCode: meta.code,
    direction: meta.dir,
    bcp47: meta.bcp47,
  };
}
