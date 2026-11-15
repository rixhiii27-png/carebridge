import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Firestore } from 'firebase-admin/firestore';
import {
  detectScriptLanguageHint,
  findLanguageSwitchTarget,
  getVoiceLanguageCapability,
  VOICE_LANGUAGE_MATRIX,
} from '../../../shared/voiceLanguageMatrix.ts';
import { adminDb, FieldValue } from '../../config/firebase.ts';
import { serverEnv } from '../../config/env.ts';
import {
  assertActiveMember,
  type CareMemberDoc,
} from '../../middleware/authorization.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import {
  clampStr,
  formatTimezoneDateKey,
  formatTimezoneTimeKey,
  generateDocId,
  timeToMinutes,
} from '../../utils/idAndDate.ts';
import { listAppointments } from '../appointments/appointmentsService.ts';
import { buildLocalizedNotification } from '../localization/notificationLocalizer.ts';
import {
  deriveScheduledDoseSlots,
  type MedicationDoc,
  type MedicationLogDoc,
  recordDoseEvent,
} from '../medications/medicationsService.ts';
import { updateMyProfile } from '../users/usersService.ts';

let cachedVoiceClient: GoogleGenAI | null = null;

function getVoiceGeminiClient(): GoogleGenAI | null {
  if (!serverEnv.geminiApiKey || serverEnv.geminiApiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedVoiceClient) {
    cachedVoiceClient = new GoogleGenAI({
      apiKey: serverEnv.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedVoiceClient;
}

export type VoiceIntentType =
  | 'query_next_dose'
  | 'query_schedule'
  | 'query_appointments'
  | 'query_profile'
  | 'navigate'
  | 'request_language_change'
  | 'request_log_dose'
  | 'request_notify_caregiver_missed'
  | 'emergency'
  | 'medical_boundary'
  | 'general_help';

export interface PendingVoiceAction {
  actionType: 'log_dose' | 'notify_caregiver_missed' | 'change_language';
  groupId?: string;
  label: string;
  summary: string;
  payload: {
    medicationId?: string;
    medicationName?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    status?: 'taken' | 'skipped' | 'missed' | 'not_confirmed';
    note?: string;
    targetLanguageCode?: string;
    targetScript?: string;
  };
}

export interface VoiceConverseResult {
  replyText: string;
  spokenText: string;
  responseLanguageCode: string;
  responseLanguageName: string;
  responseBcp47: string;
  direction: 'ltr' | 'rtl';
  detectedLanguageCode: string;
  intent: VoiceIntentType;
  navigateTo?: string;
  requiresConfirmation: boolean;
  pendingAction?: PendingVoiceAction;
  emergencyNotice: boolean;
  poweredByModel: boolean;
}

export interface TranscribeAudioResult {
  transcript: string;
  detectedLanguageCode: string;
  detectedBcp47: string;
  scriptPreserved: boolean;
  provider: 'gemini-3.5-transcribe';
}

export interface SynthesizeSpeechResult {
  audioAvailable: boolean;
  audioBase64?: string;
  mimeType?: 'audio/wav' | 'audio/mpeg';
  byteLength?: number;
  provider?: 'gemini-3.8-flash-lite-tts' | 'google-cloud-tts' | 'none';
  languageCode: string;
  bcp47: string;
  speakingRate: number;
  fallbackToBrowserTts: boolean;
  reason?: string;
}

const EMERGENCY_PATTERN =
  /\b(chest pain|shortness of breath|cannot breathe|can't breathe|difficulty breathing|unconscious|fainted|stroke|heart attack|severe bleeding|emergency|call ambulance)\b|(सीने में दर्द|सांस नहीं|साँस लेने|बेहोश|दिल का दौरा|आपातकाल|ಎದೆ ನೋವು|ಉಸಿರಾಟದ ತೊಂದರೆ|ಪ್ರಜ್ಞೆ ತಪ್ಪ|ತುರ್ತು|நெஞ்சு வலி|மூச்சு திணறல்|ఛాతీ నొప్పి|శ్వాస తీసుకోవడం)/i;

const MEDICAL_BOUNDARY_PATTERN =
  /\b(diagnose|diagnosis|what disease|prescribe|change dosage|double dose|stop taking|should i stop|increase my dose|decrease my dose|side effect diagnosis)\b|(बीमारी बताओ|खुराक बढ़ा|दवा बंद कर|ರೋಗ ನಿರ್ಣಯ|ಡೋಸ್ ಬದಲ|ಮಾತ್ರೆ ನಿಲ್ಲಿಸ)/i;

interface NativePhraseBundle {
  emergency: (physician?: string) => string;
  medicalBoundary: (physician?: string) => string;
  noGroup: string;
  noMedications: string;
  allTakenToday: (count: number) => string;
  nextDose: (medName: string, dosage: string, time: string) => string;
  scheduleIntro: (summaryLines: string) => string;
  noAppointments: string;
  upcomingAppointments: (summaryLines: string) => string;
  profileSummary: (elderlyName: string, age: number, physician: string, clinic: string) => string;
  confirmLanguageChange: (targetNative: string, targetEnglish: string) => string;
  confirmCaregiverAlert: (elderlyName: string, medSummary: string) => string;
  confirmLogDose: (medName: string, status: string, time: string) => string;
  navigateMsg: (sectionLabel: string) => string;
  generalHelp: string;
}

const NATIVE_PHRASES: Record<string, NativePhraseBundle> = {
  en: {
    emergency: (physician) =>
      `This sounds like an urgent medical symptom. Please call emergency services (112 or 108 in India, or your local emergency number) right away.${physician ? ` You may also alert your caregiver or contact ${physician} immediately.` : ''}`,
    medicalBoundary: (physician) =>
      `I cannot diagnose conditions, prescribe medicines, or advise changing your dosage. Please speak with ${physician || 'your prescribing doctor'} before making any change.`,
    noGroup: 'No active care profile is selected yet. Open your Care Profile to set up or select a group.',
    noMedications: 'There are no active medications currently listed in this Care Circle.',
    allTakenToday: (count) =>
      `All ${count} scheduled doses for today have already been logged. No remaining unconfirmed doses today.`,
    nextDose: (med, dosage, time) =>
      `Your next scheduled medicine is ${med} (${dosage}) at ${time}. Status is currently Not confirmed.`,
    scheduleIntro: (lines) => `Here is today's medication schedule: ${lines}`,
    noAppointments: 'There are no upcoming scheduled appointments right now.',
    upcomingAppointments: (lines) => `Your upcoming scheduled appointments: ${lines}`,
    profileSummary: (name, age, physician, clinic) =>
      `Care Profile for ${name}, age ${age}. Primary doctor: ${physician || 'Not listed'}. Clinic: ${clinic || 'Not listed'}. Opening Care Profile.`,
    confirmLanguageChange: (native, eng) =>
      `Would you like me to change your preferred CareBridge language to ${native} (${eng})? Please confirm below.`,
    confirmCaregiverAlert: (name, medSummary) =>
      `Would you like me to send a missed-reminder alert for ${name}${medSummary ? ` (${medSummary})` : ''} to your active caregivers now? Please confirm below.`,
    confirmLogDose: (med, status, time) =>
      `Please confirm if I should mark ${med} (${time}) as ${status}.`,
    navigateMsg: (section) => `Opening ${section} now.`,
    generalHelp:
      'I can read your next medicine, today’s medication schedule, upcoming appointments, Care Profile, or alert your caregiver with your confirmation.',
  },
  hi: {
    emergency: (physician) =>
      `यह एक गंभीर स्वास्थ्य लक्षण लग रहा है। कृपया तुरंत आपातकालीन सेवा (112 या 108) पर कॉल करें।${physician ? ` साथ ही अपने देखभालकर्ता या ${physician} से तुरंत संपर्क करें।` : ''}`,
    medicalBoundary: (physician) =>
      `मैं किसी बीमारी की जांच, दवा लिखने या खुराक बदलने की सलाह नहीं दे सकता। कृपया किसी भी बदलाव के लिए ${physician || 'अपने डॉक्टर'} से बात करें।`,
    noGroup: 'अभी कोई सक्रिय केयर प्रोफ़ाइल चयनित नहीं है।',
    noMedications: 'इस केयर सर्कल में अभी कोई सक्रिय दवा सूचीबद्ध नहीं है।',
    allTakenToday: (count) =>
      `आज की सभी ${count} निर्धारित खुराक दर्ज की जा चुकी हैं। आज कोई बाकी खुराक नहीं है।`,
    nextDose: (med, dosage, time) =>
      `आपकी अगली निर्धारित दवा ${med} (${dosage}) ${time} बजे है। अभी स्थिति: पुष्टि बाकी है।`,
    scheduleIntro: (lines) => `आज की दवाओं की समय-सारिणी: ${lines}`,
    noAppointments: 'अभी कोई आगामी डॉक्टर अपॉइंटमेंट निर्धारित नहीं है।',
    upcomingAppointments: (lines) => `आपके आगामी डॉक्टर अपॉइंटमेंट: ${lines}`,
    profileSummary: (name, age, physician, clinic) =>
      `केयर प्रोफ़ाइल: ${name}, उम्र ${age} वर्ष। मुख्य डॉक्टर: ${physician || 'दर्ज नहीं'}। क्लिनिक: ${clinic || 'दर्ज नहीं'}। प्रोफ़ाइल खोली जा रही है।`,
    confirmLanguageChange: (native, eng) =>
      `क्या आप CareBridge की पसंदीदा भाषा बदलकर ${native} (${eng}) करना चाहते हैं? कृपया नीचे पुष्टि करें।`,
    confirmCaregiverAlert: (name, medSummary) =>
      `क्या मैं ${name}${medSummary ? ` (${medSummary})` : ''} की छूटी हुई दवा की सूचना आपके सक्रिय देखभालकर्ताओं को भेज दूं? कृपया नीचे पुष्टि करें।`,
    confirmLogDose: (med, status, time) =>
      `कृपया पुष्टि करें: क्या ${med} (${time}) को ${status} के रूप में दर्ज करूं?`,
    navigateMsg: (section) => `${section} अनुभाग खोला जा रहा है।`,
    generalHelp:
      'मैं आपकी अगली दवा, आज का दवा शेड्यूल, आगामी अपॉइंटमेंट, केयर प्रोफ़ाइल पढ़ सकता हूं या आपकी पुष्टि से देखभालकर्ता को सूचना भेज सकता हूं।',
  },
  kn: {
    emergency: (physician) =>
      `ಇದು ತುರ್ತು ಆರೋಗ್ಯ ಲಕ್ಷಣವಾಗಿರಬಹುದು. ದಯವಿಟ್ಟು ತಕ್ಷಣ ತುರ್ತು ಸಹಾಯವಾಣಿ (112 ಅಥವಾ 108) ಗೆ ಕರೆ ಮಾಡಿ.${physician ? ` ನಿಮ್ಮ ಆರೈಕೆದಾರರಿಗೆ ಅಥವಾ ${physician} ಅವರಿಗೆ ತಕ್ಷಣ ತಿಳಿಸಿ.` : ''}`,
    medicalBoundary: (physician) =>
      `ನಾನು ರೋಗ ನಿರ್ಣಯ ಮಾಡಲು ಅಥವಾ ಔಷಧಿಯ ಪ್ರಮಾಣವನ್ನು ಬದಲಾಯಿಸಲು ಸಲಹೆ ನೀಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಯಾವುದೇ ಬದಲಾವಣೆಗಾಗಿ ದಯವಿಟ್ಟು ${physician || 'ನಿಮ್ಮ ವೈದ್ಯರನ್ನು'} ಸಂಪರ್ಕಿಸಿ.`,
    noGroup: 'ಪ್ರಸ್ತುತ ಯಾವುದೇ ಸಕ್ರಿಯ ಕೇರ್ ಪ್ರೊಫೈಲ್ ಆಯ್ಕೆಯಾಗಿಲ್ಲ.',
    noMedications: 'ಈ ಕೇರ್ ಗುಂಪಿನಲ್ಲಿ ಪ್ರಸ್ತುತ ಯಾವುದೇ ಸಕ್ರಿಯ ಔಷಧಿಗಳು ಪಟ್ಟಿ ಮಾಡಲಾಗಿಲ್ಲ.',
    allTakenToday: (count) =>
      `ಇಂದಿನ ಎಲ್ಲಾ ${count} ನಿಗದಿತ ಔಷಧಿಗಳನ್ನು ಈಗಾಗಲೇ ದಾಖಲಿಸಲಾಗಿದೆ.`,
    nextDose: (med, dosage, time) =>
      `ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ ${med} (${dosage}), ಸಮಯ ${time}. ಪ್ರಸ್ತುತ ಸ್ಥಿತಿ: ದೃಢೀಕರಿಸಲಾಗಿಲ್ಲ.`,
    scheduleIntro: (lines) => `ಇಂದಿನ ಔಷಧಿಗಳ ವೇಳಾಪಟ್ಟಿ: ${lines}`,
    noAppointments: 'ಪ್ರಸ್ತುತ ಯಾವುದೇ ಮುಂಬರುವ ವೈದ್ಯರ ಭೇಟಿ ನಿಗದಿಯಾಗಿಲ್ಲ.',
    upcomingAppointments: (lines) => `ನಿಮ್ಮ ಮುಂಬರುವ ವೈದ್ಯರ ಭೇಟಿಗಳು: ${lines}`,
    profileSummary: (name, age, physician, clinic) =>
      `${name} (ವಯಸ್ಸು ${age}) ಅವರ ಆರೋಗ್ಯ ಪ್ರೊಫೈಲ್. ಮುಖ್ಯ ವೈದ್ಯರು: ${physician || 'ನಮೂದಿಸಿಲ್ಲ'}. ಕ್ಲಿನಿಕ್: ${clinic || 'ನಮೂದಿಸಿಲ್ಲ'}. ಪ್ರೊಫೈಲ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.`,
    confirmLanguageChange: (native, eng) =>
      `ನಿಮ್ಮ ಆದ್ಯತೆಯ ಭಾಷೆಯನ್ನು ${native} (${eng}) ಗೆ ಬದಲಾಯಿಸಬೇಕೆ? ದಯವಿಟ್ಟು ಕೆಳಗೆ ದೃಢೀಕರಿಸಿ.`,
    confirmCaregiverAlert: (name, medSummary) =>
      `${name}${medSummary ? ` (${medSummary})` : ''} ಅವರ ತಪ್ಪಿದ ಔಷಧಿ ಜ್ಞಾಪನೆಯ ಬಗ್ಗೆ ನಿಮ್ಮ ಆರೈಕೆದಾರರಿಗೆ ಈಗ ಸಂದೇಶ ಕಳುಹಿಸಬೇಕೆ? ದಯವಿಟ್ಟು ಕೆಳಗೆ ದೃಢೀಕರಿಸಿ.`,
    confirmLogDose: (med, status, time) =>
      `${med} (${time}) ಅನ್ನು ${status} ಎಂದು ದಾಖಲಿಸಲು ದಯವಿಟ್ಟು ದೃಢೀಕರಿಸಿ.`,
    navigateMsg: (section) => `${section} ವಿಭಾಗವನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.`,
    generalHelp:
      'ನಿಮ್ಮ ಮುಂದಿನ ಔಷಧಿ, ಇಂದಿನ ಔಷಧಿ ವೇಳಾಪಟ್ಟಿ, ಮುಂಬರುವ ವೈದ್ಯರ ಭೇಟಿಗಳು, ಆರೋಗ್ಯ ಪ್ರೊಫೈಲ್ ಓದಬಹುದು ಅಥವಾ ನಿಮ್ಮ ದೃಢೀಕರಣದೊಂದಿಗೆ ಆರೈಕೆದಾರರಿಗೆ ತಿಳಿಸಬಹುದು.',
  },
  ta: {
    emergency: (physician) =>
      `இது அவசர மருத்துவ அறிகுறியாக இருக்கலாம். தயவுசெய்து உடனடியாக அவசர உதவி எண்ணை (112 அல்லது 108) அழைக்கவும்.${physician ? ` ${physician} அல்லது பராமரிப்பாளரை உடனே தொடர்பு கொள்ளவும்.` : ''}`,
    medicalBoundary: (physician) =>
      `நான் நோய் கண்டறியவோ மருந்து அளவை மாற்றவோ ஆலோசனை வழங்க முடியாது. தயவுசெய்து ${physician || 'உங்கள் மருத்துவரை'} அணுகவும்.`,
    noGroup: 'தற்போது செயலில் உள்ள பராமரிப்பு சுயவிவரம் இல்லை.',
    noMedications: 'இந்த பராமரிப்பு குழுவில் செயலில் உள்ள மருந்துகள் எதுவும் இல்லை.',
    allTakenToday: (count) => `இன்றைய அனைத்து ${count} மருந்துகளும் பதிவு செய்யப்பட்டுள்ளன.`,
    nextDose: (med, dosage, time) =>
      `உங்கள் அடுத்த மருந்து ${med} (${dosage}) நேரம் ${time}. நிலை: உறுதிப்படுத்தப்படவில்லை.`,
    scheduleIntro: (lines) => `இன்றைய மருந்து அட்டவணை: ${lines}`,
    noAppointments: 'வரவிருக்கும் மருத்துவர் சந்திப்புகள் எதுவும் இல்லை.',
    upcomingAppointments: (lines) => `வரவிருக்கும் மருத்துவர் சந்திப்புகள்: ${lines}`,
    profileSummary: (name, age, physician, clinic) =>
      `${name} (வயது ${age}) சுயவிவரம். மருத்துவர்: ${physician || 'குறிப்பிடப்படவில்லை'}. மருத்துவமனை: ${clinic || 'குறிப்பிடப்படவில்லை'}.`,
    confirmLanguageChange: (native, eng) =>
      `CareBridge மொழியை ${native} (${eng}) ஆக மாற்ற வேண்டுமா? கீழே உறுதிப்படுத்தவும்.`,
    confirmCaregiverAlert: (name, medSummary) =>
      `${name}${medSummary ? ` (${medSummary})` : ''} தவறிய மருந்து பற்றி பராமரிப்பாளருக்கு தகவல் அனுப்ப வேண்டுமா? கீழே உறுதிப்படுத்தவும்.`,
    confirmLogDose: (med, status, time) => `${med} (${time}) நிலையை ${status} எனப் பதிவு செய்ய உறுதிப்படுத்தவும்.`,
    navigateMsg: (section) => `${section} பகுதி திறக்கப்படுகிறது.`,
    generalHelp:
      'உங்கள் அடுத்த மருந்து, இன்றைய அட்டவணை, மருத்துவர் சந்திப்புகள் மற்றும் சுயவிவரத்தை வாசித்து உதவ முடியும்.',
  },
  te: {
    emergency: (physician) =>
      `ఇది అత్యవసర ఆరోగ్య సమస్య కావచ్చు. దయచేసి వెంటనే 112 లేదా 108 కు కాల్ చేయండి.${physician ? ` ${physician} లేదా సంరక్షకులను వెంటనే సంప్రదించండి.` : ''}`,
    medicalBoundary: (physician) =>
      `నేను వ్యాధి నిర్ధారణ చేయలేను లేదా మందుల మోతాదును మార్చమని చెప్పలేను. దయచేసి ${physician || 'మీ వైద్యుడిని'} సంప్రదించండి.`,
    noGroup: 'ప్రస్తుతం యాక్టివ్ కేర్ ప్రొఫైల్ ఎంచుకోబడలేదు.',
    noMedications: 'ఈ కేర్ సర్కిల్‌లో ప్రస్తుతం యాక్టివ్ మందులు లేవు.',
    allTakenToday: (count) => `ఈరోజు షెడ్యూల్ చేసిన ${count} మోతాదులు అన్నీ నమోదు చేయబడ్డాయి.`,
    nextDose: (med, dosage, time) =>
      `మీ తదుపరి మందు ${med} (${dosage}) సమయం ${time}. ప్రస్తుత స్థితి: నిర్ధారించబడలేదు.`,
    scheduleIntro: (lines) => `ఈరోజు మందుల షెడ్యూల్: ${lines}`,
    noAppointments: 'ప్రస్తుతం రాబోయే డాక్టర్ అపాయింట్‌మెంట్లు లేవు.',
    upcomingAppointments: (lines) => `మీ రాబోయే డాక్టర్ అపాయింట్‌మెంట్లు: ${lines}`,
    profileSummary: (name, age, physician, clinic) =>
      `${name} (వయసు ${age}) కేర్ ప్రొఫైల్. డాక్టర్: ${physician || 'నమోదు కాలేదు'}. క్లినిక్: ${clinic || 'నమోదు కాలేదు'}.`,
    confirmLanguageChange: (native, eng) =>
      `CareBridge భాషను ${native} (${eng}) కు మార్చాలా? దయచేసి క్రింద నిర్ధారించండి.`,
    confirmCaregiverAlert: (name, medSummary) =>
      `${name}${medSummary ? ` (${medSummary})` : ''} తప్పిపోయిన మందు గురించి సంరక్షకులకు తెలియజేయాలా? దయచేసి క్రింద నిర్ధారించండి.`,
    confirmLogDose: (med, status, time) => `${med} (${time}) ను ${status} గా నమోదు చేయడానికి నిర్ధారించండి.`,
    navigateMsg: (section) => `${section} తెరవబడుతోంది.`,
    generalHelp:
      'మీ తదుపరి మందు, ఈరోజు మందుల షెడ్యూల్, రాబోయే అపాయింట్‌మెంట్లు మరియు ప్రొఫైల్ వివరాలను చదవగలను.',
  },
};

function getPhraseBundle(langCode: string): NativePhraseBundle {
  return NATIVE_PHRASES[langCode] ?? NATIVE_PHRASES.en;
}

export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType: string;
  preferredLanguage: string;
  autoDetect: boolean;
}): Promise<TranscribeAudioResult> {
  const ai = getVoiceGeminiClient();
  if (!ai) {
    throw AppError.serviceUnavailable(
      'Neural audio transcription is unavailable because GEMINI_API_KEY is not configured on this server. Browser speech recognition or text input remains active.',
    );
  }

  const prefMeta = getVoiceLanguageCapability(params.preferredLanguage);
  const instruction = [
    'Transcribe the user speech accurately.',
    params.autoDetect
      ? `The speaker may be speaking ${prefMeta.englishName} (${prefMeta.bcp47}) or any of the 22 Indian regional languages or English.`
      : `The expected language is ${prefMeta.englishName} (${prefMeta.bcp47}).`,
    'CRITICAL: Preserve the exact spoken language and its native writing script (e.g., Kannada in ಕನ್ನಡ, Hindi in देवनागरी, Tamil in தமிழ், Telugu in తెలుగు, Urdu in اردو).',
    'NEVER translate the spoken words into English. Preserve medicine names accurately.',
    'If there is only silence, background noise, or no intelligible words, set speechEmpty to true and transcript to empty string.',
  ].join(' ');

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.audioBase64,
          },
        },
        { text: instruction },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          transcript: { type: Type.STRING },
          detectedLanguageCode: { type: Type.STRING },
          speechEmpty: { type: Type.BOOLEAN },
        },
        required: ['transcript', 'detectedLanguageCode', 'speechEmpty'],
      },
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    throw AppError.badRequest('No intelligible speech was detected in the recording.', 'EMPTY_SPEECH');
  }

  let parsed: { transcript?: string; detectedLanguageCode?: string; speechEmpty?: boolean };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = { transcript: rawText, detectedLanguageCode: prefMeta.code, speechEmpty: !rawText };
  }

  const transcript = (parsed.transcript || '').trim();
  if (parsed.speechEmpty || !transcript) {
    throw AppError.badRequest(
      'I could not hear clear speech in that recording. Please try speaking closer to the microphone.',
      'EMPTY_SPEECH',
    );
  }

  const scriptHint = detectScriptLanguageHint(transcript);
  const rawCode = (parsed.detectedLanguageCode || '').trim().toLowerCase().split('-')[0];
  const resolvedCode =
    VOICE_LANGUAGE_MATRIX.find((l) => l.code === rawCode)?.code ||
    scriptHint ||
    prefMeta.code;
  const detectedMeta = getVoiceLanguageCapability(resolvedCode);

  return {
    transcript,
    detectedLanguageCode: detectedMeta.code,
    detectedBcp47: detectedMeta.bcp47,
    scriptPreserved: true,
    provider: 'gemini-3.5-transcribe',
  };
}

interface RuleEvaluationContext {
  transcript: string;
  responseLangCode: string;
  groupId?: string;
  groupName?: string;
  elderlyName?: string;
  elderlyAge?: number;
  primaryPhysician?: string;
  primaryClinic?: string;
  timezone: string;
  activeMeds: MedicationDoc[];
  todaySchedule: ReturnType<typeof deriveScheduledDoseSlots>;
  upcomingAppointments: Array<{
    id: string;
    doctorName: string;
    clinicName: string;
    appointmentDate: string;
    appointmentTime: string;
  }>;
  nextDose: ReturnType<typeof deriveScheduledDoseSlots>[number] | null;
}

function evaluateDeterministicVoiceIntent(ctx: RuleEvaluationContext): {
  intent: VoiceIntentType;
  replyText: string;
  navigateTo?: string;
  requiresConfirmation: boolean;
  pendingAction?: PendingVoiceAction;
  emergencyNotice: boolean;
} {
  const lower = ctx.transcript.toLowerCase();
  const phrases = getPhraseBundle(ctx.responseLangCode);

  if (EMERGENCY_PATTERN.test(ctx.transcript)) {
    return {
      intent: 'emergency',
      replyText: phrases.emergency(ctx.primaryPhysician),
      requiresConfirmation: Boolean(ctx.groupId),
      pendingAction: ctx.groupId
        ? {
            actionType: 'notify_caregiver_missed',
            groupId: ctx.groupId,
            label: 'Send Urgent Alert to Caregivers',
            summary: `Send an urgent caregiver alert for ${ctx.elderlyName || 'Resident'}.`,
            payload: {
              note: `Urgent voice check requested: "${clampStr(ctx.transcript, 140)}"`,
            },
          }
        : undefined,
      emergencyNotice: true,
    };
  }

  if (MEDICAL_BOUNDARY_PATTERN.test(ctx.transcript)) {
    return {
      intent: 'medical_boundary',
      replyText: phrases.medicalBoundary(ctx.primaryPhysician),
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  // 1. Language change request
  const targetLang = findLanguageSwitchTarget(ctx.transcript);
  if (targetLang) {
    return {
      intent: 'request_language_change',
      replyText: phrases.confirmLanguageChange(targetLang.nativeName, targetLang.englishName),
      requiresConfirmation: true,
      pendingAction: {
        actionType: 'change_language',
        groupId: ctx.groupId,
        label: `Switch language to ${targetLang.nativeName} (${targetLang.englishName})`,
        summary: `Update preferred CareBridge language to ${targetLang.englishName} (${targetLang.defaultScript}).`,
        payload: {
          targetLanguageCode: targetLang.code,
          targetScript: targetLang.defaultScript,
        },
      },
      emergencyNotice: false,
    };
  }

  // 2. Notify caregiver about missed reminder
  const asksCaregiverAlert =
    (/\b(caregiver|family|tell|notify|alert|inform)\b/.test(lower) &&
      /\b(miss|missed|reminder|late|skip|forgot)\b/.test(lower)) ||
    /(देखभाल|परिवार|छूट|भूल|ಆರೈಕೆದಾರ|ಮರೆತ|ತಪ್ಪಿದ|குடும்ப|பராமரிப்பாளர்|సంరక్షకు)/.test(ctx.transcript);

  if (asksCaregiverAlert) {
    if (!ctx.groupId) {
      return {
        intent: 'general_help',
        replyText: phrases.noGroup,
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    const targetSlot =
      ctx.todaySchedule.find((s) => s.status === 'missed' || s.status === 'not_confirmed') ||
      ctx.todaySchedule[0];

    const medSummary = targetSlot ? `${targetSlot.medicationName} (${targetSlot.scheduledTime})` : '';
    return {
      intent: 'request_notify_caregiver_missed',
      replyText: phrases.confirmCaregiverAlert(ctx.elderlyName || 'Resident', medSummary),
      requiresConfirmation: true,
      pendingAction: {
        actionType: 'notify_caregiver_missed',
        groupId: ctx.groupId,
        label: 'Notify Caregivers About Missed Reminder',
        summary: `Send localized alert to active caregivers for ${ctx.elderlyName || 'Resident'}${medSummary ? ` regarding ${medSummary}` : ''}.`,
        payload: {
          medicationId: targetSlot?.medicationId,
          medicationName: targetSlot?.medicationName,
          scheduledTime: targetSlot?.scheduledTime,
          scheduledDate: targetSlot?.scheduledDate,
          note: `Voice reminder alert: ${clampStr(ctx.transcript, 140)}`,
        },
      },
      emergencyNotice: false,
    };
  }

  // 3. Log dose confirmation ("mark ... taken / skipped / missed")
  const wantsLogDose =
    /\b(mark|log|record|took|taken|skip|skipped)\b/.test(lower) &&
    (/\b(med|medicine|medication|dose|tablet|pill)\b/.test(lower) ||
      ctx.activeMeds.some((m) => lower.includes(m.name.toLowerCase())));

  if (wantsLogDose && ctx.groupId && ctx.todaySchedule.length > 0) {
    const matchedMed = ctx.activeMeds.find((m) => lower.includes(m.name.toLowerCase()));
    const slot =
      (matchedMed
        ? ctx.todaySchedule.find(
            (s) => s.medicationId === matchedMed.id && s.status === 'not_confirmed',
          ) || ctx.todaySchedule.find((s) => s.medicationId === matchedMed.id)
        : ctx.nextDose || ctx.todaySchedule[0]);

    if (slot) {
      const targetStatus: 'taken' | 'skipped' | 'missed' = /\bskip/.test(lower)
        ? 'skipped'
        : /\bmiss/.test(lower)
          ? 'missed'
          : 'taken';
      return {
        intent: 'request_log_dose',
        replyText: phrases.confirmLogDose(slot.medicationName, targetStatus, slot.scheduledTime),
        requiresConfirmation: true,
        pendingAction: {
          actionType: 'log_dose',
          groupId: ctx.groupId,
          label: `Mark ${slot.medicationName} (${slot.scheduledTime}) as ${targetStatus}`,
          summary: `Log today's ${slot.scheduledTime} dose of ${slot.medicationName} as ${targetStatus}.`,
          payload: {
            medicationId: slot.medicationId,
            medicationName: slot.medicationName,
            scheduledDate: slot.scheduledDate,
            scheduledTime: slot.scheduledTime,
            status: targetStatus,
          },
        },
        emergencyNotice: false,
      };
    }
  }

  // 4. Next medicine query
  const asksNextMedicine =
    /\b(next|which medicine|what medicine|take next|due now)\b/.test(lower) ||
    /(अगली दवा|कौन सी दवा|अभी कौन|ಮುಂದಿನ ಔಷಧ|ಯಾವ ಔಷಧ|அடுத்த மருந்து|తదుపరి మందు)/.test(
      ctx.transcript,
    );

  if (asksNextMedicine) {
    if (!ctx.groupId) {
      return {
        intent: 'query_next_dose',
        replyText: phrases.noGroup,
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    if (ctx.activeMeds.length === 0) {
      return {
        intent: 'query_next_dose',
        replyText: phrases.noMedications,
        navigateTo: '/medications',
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    if (!ctx.nextDose) {
      return {
        intent: 'query_next_dose',
        replyText: phrases.allTakenToday(ctx.todaySchedule.length),
        navigateTo: '/medications',
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    return {
      intent: 'query_next_dose',
      replyText: phrases.nextDose(
        ctx.nextDose.medicationName,
        ctx.nextDose.dosage,
        ctx.nextDose.scheduledTime,
      ),
      navigateTo: '/medications',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  // 5. Read schedule / Show medicines
  const asksMedicinesSchedule =
    /\b(med|medicine|medicines|medication|medications|schedule|pills|doses)\b/.test(lower) ||
    /(दवा|दवाइ|दवाई|शेड्यूल|खुराक|ಔಷಧ|ಮಾತ್ರೆ|ವೇಳಾಪಟ್ಟಿ|மருந்து|அட்டவணை|మందు|షెడ్యూల్)/.test(
      ctx.transcript,
    );

  if (asksMedicinesSchedule) {
    if (!ctx.groupId) {
      return {
        intent: 'query_schedule',
        replyText: phrases.noGroup,
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    if (ctx.todaySchedule.length === 0) {
      return {
        intent: 'query_schedule',
        replyText: phrases.noMedications,
        navigateTo: '/medications',
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    const summaryLines = ctx.todaySchedule
      .slice(0, 5)
      .map((s) => `${s.medicationName} (${s.dosage}) at ${s.scheduledTime} [${s.status.replace('_', ' ')}]`)
      .join('; ');
    return {
      intent: 'query_schedule',
      replyText: phrases.scheduleIntro(summaryLines),
      navigateTo: '/medications',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  // 6. Appointments query
  const asksAppointments =
    /\b(appointment|appointments|doctor|visit|visits|clinic)\b/.test(lower) ||
    /(अपॉइंटमेंट|डॉक्टर|भेंट|क्लिनिक|ವೈದ್ಯ|ಭೇಟಿ|ಅಪಾಯಿಂಟ್|மருத்துவர்|சந்திப்பு|డాక్టర్|అపాయింట్)/.test(
      ctx.transcript,
    );

  if (asksAppointments) {
    if (!ctx.groupId) {
      return {
        intent: 'query_appointments',
        replyText: phrases.noGroup,
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    if (ctx.upcomingAppointments.length === 0) {
      return {
        intent: 'query_appointments',
        replyText: phrases.noAppointments,
        navigateTo: '/appointments',
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    const apptLines = ctx.upcomingAppointments
      .slice(0, 4)
      .map((a) => `${a.doctorName} (${a.clinicName}) on ${a.appointmentDate} at ${a.appointmentTime}`)
      .join('; ');
    return {
      intent: 'query_appointments',
      replyText: phrases.upcomingAppointments(apptLines),
      navigateTo: '/appointments',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  // 7. Healthcare profile
  const asksProfile =
    /\b(profile|health profile|my info|my details|care profile)\b/.test(lower) ||
    /(प्रोफ़ाइल|प्रोफाइल|जानकारी|ಪ್ರೊಫೈಲ್|ಆರೋಗ್ಯ ವಿವರ|சுயவிவரம்|ప్రొఫైల్)/.test(
      ctx.transcript,
    );

  if (asksProfile) {
    if (!ctx.groupId) {
      return {
        intent: 'query_profile',
        replyText: phrases.noGroup,
        navigateTo: '/profile',
        requiresConfirmation: false,
        emergencyNotice: false,
      };
    }
    return {
      intent: 'query_profile',
      replyText: phrases.profileSummary(
        ctx.elderlyName || 'Resident',
        ctx.elderlyAge || 0,
        ctx.primaryPhysician || '',
        ctx.primaryClinic || '',
      ),
      navigateTo: '/profile',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  // 8. Navigation shortcuts
  if (/\b(notif|alert|alerts)\b/.test(lower) || /(सूचना|ಸೂಚನೆ|ಅಧಿಸೂಚನೆ)/.test(ctx.transcript)) {
    return {
      intent: 'navigate',
      replyText: phrases.navigateMsg('Notifications'),
      navigateTo: '/notifications',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }
  if (/\b(family|caregiver|members)\b/.test(lower) || /(परिवार|ಕುಟುಂಬ)/.test(ctx.transcript)) {
    return {
      intent: 'navigate',
      replyText: phrases.navigateMsg('Family & Caregivers'),
      navigateTo: '/family',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }
  if (/\b(accessibility|voice settings)\b/.test(lower)) {
    return {
      intent: 'navigate',
      replyText: phrases.navigateMsg('Accessibility Settings'),
      navigateTo: '/accessibility',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }
  if (/\b(home|dashboard|overview)\b/.test(lower) || /(होम|डैशबोर्ड|ಮುಖಪುಟ)/.test(ctx.transcript)) {
    return {
      intent: 'navigate',
      replyText: phrases.navigateMsg('Dashboard'),
      navigateTo: '/dashboard',
      requiresConfirmation: false,
      emergencyNotice: false,
    };
  }

  return {
    intent: 'general_help',
    replyText: phrases.generalHelp,
    requiresConfirmation: false,
    emergencyNotice: false,
  };
}

export async function converseWithVoiceAssistant(
  params: {
    uid: string;
    transcript: string;
    preferredLanguage: string;
    autoDetectLanguage: boolean;
    groupId?: string;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
  },
  db: Firestore = adminDb,
): Promise<VoiceConverseResult> {
  // Determine response language cleanly — NEVER silently switch non-English input to English
  const scriptHint = params.autoDetectLanguage ? detectScriptLanguageHint(params.transcript) : null;
  const effectiveLangCode = scriptHint || params.preferredLanguage || 'en';
  const langMeta = getVoiceLanguageCapability(effectiveLangCode);

  let groupName: string | undefined;
  let elderlyName: string | undefined;
  let elderlyAge: number | undefined;
  let primaryPhysician: string | undefined;
  let primaryClinic: string | undefined;
  let timezone = 'Asia/Kolkata';
  let activeMeds: MedicationDoc[] = [];
  let todaySchedule: ReturnType<typeof deriveScheduledDoseSlots> = [];
  let upcomingAppointments: RuleEvaluationContext['upcomingAppointments'] = [];

  if (params.groupId) {
    // Enforce authorization strictly before reading ANY healthcare record
    const { group } = await assertActiveMember(params.groupId, params.uid, db);
    timezone = group.timezone || 'Asia/Kolkata';
    elderlyName = group.elderlyName;
    elderlyAge = group.elderlyAge;
    primaryPhysician = group.primaryPhysician;
    primaryClinic = group.primaryClinic;
    groupName = group.elderlyName;

    const [medsSnap, logsSnap, apptResult] = await Promise.all([
      db.collection('medications').where('groupId', '==', params.groupId).get(),
      db.collection('medicationLogs').where('groupId', '==', params.groupId).get(),
      listAppointments(params.groupId, params.uid, { status: 'scheduled', limit: 15 }, db),
    ]);

    activeMeds = medsSnap.docs
      .map((d) => d.data() as MedicationDoc)
      .filter((m) => m.active);
    const logs = logsSnap.docs.map((d) => d.data() as MedicationLogDoc);
    const todayKey = formatTimezoneDateKey(new Date(), timezone);
    todaySchedule = deriveScheduledDoseSlots(activeMeds, logs, todayKey);
    upcomingAppointments = apptResult.items
      .filter((a) => a.appointmentDate >= todayKey)
      .map((a) => ({
        id: a.id,
        doctorName: a.doctorName,
        clinicName: a.clinicName,
        appointmentDate: a.appointmentDate,
        appointmentTime: a.appointmentTime,
      }));
  }

  const nowMinutes = timeToMinutes(formatTimezoneTimeKey(new Date(), timezone));
  const pendingSlots = todaySchedule.filter((s) => s.status === 'not_confirmed');
  const nextDose =
    pendingSlots.find((s) => timeToMinutes(s.scheduledTime) >= nowMinutes) ||
    pendingSlots[0] ||
    null;

  const evalCtx: RuleEvaluationContext = {
    transcript: params.transcript,
    responseLangCode: langMeta.code,
    groupId: params.groupId,
    groupName,
    elderlyName,
    elderlyAge,
    primaryPhysician,
    primaryClinic,
    timezone,
    activeMeds,
    todaySchedule,
    upcomingAppointments,
    nextDose,
  };

  const ruleResult = evaluateDeterministicVoiceIntent(evalCtx);

  // Emergency & sensitive action confirmations are handled strictly and safely
  const ai = getVoiceGeminiClient();
  if (!ai) {
    return {
      replyText: ruleResult.replyText,
      spokenText: ruleResult.replyText,
      responseLanguageCode: langMeta.code,
      responseLanguageName: langMeta.englishName,
      responseBcp47: langMeta.bcp47,
      direction: langMeta.defaultDir,
      detectedLanguageCode: scriptHint || langMeta.code,
      intent: ruleResult.intent,
      navigateTo: ruleResult.navigateTo,
      requiresConfirmation: ruleResult.requiresConfirmation,
      pendingAction: ruleResult.pendingAction,
      emergencyNotice: ruleResult.emergencyNotice,
      poweredByModel: false,
    };
  }

  // Call Gemini 4 Hydrogen for natural multilingual dialogue & intent precision, with strict guardrails
  try {
    const contextJson = JSON.stringify({
      resident: elderlyName || null,
      elderlyAge: elderlyAge || null,
      primaryPhysician: primaryPhysician || null,
      primaryClinic: primaryClinic || null,
      timezone,
      nextPendingDose: nextDose,
      todaySchedule: todaySchedule.slice(0, 8),
      upcomingAppointments: upcomingAppointments.slice(0, 6),
      ruleAssessment: {
        intent: ruleResult.intent,
        requiresConfirmation: ruleResult.requiresConfirmation,
        pendingActionSummary: ruleResult.pendingAction?.summary || null,
        navigateTo: ruleResult.navigateTo || null,
        emergencyNotice: ruleResult.emergencyNotice,
      },
    });

    const systemInstruction = [
      'You are the CareBridge Elderly Voice Assistant.',
      `ALWAYS respond in ${langMeta.englishName} (${langMeta.nativeName}, BCP-47 ${langMeta.bcp47}) using its authentic native script.`,
      'NEVER translate a regional language user message into English when replying.',
      'NEVER diagnose diseases, prescribe treatments, recommend stopping medicine, or alter medication dosages.',
      'Preserve exact medication brand names, dosages, clinic names, and 24h times accurately.',
      'If ruleAssessment.requiresConfirmation is true, ask the user clearly in their language to press Confirm before any change happens.',
      'Keep replies warm, respectful, concise (2-3 sentences max) so text-to-speech sounds clear and calm for elderly listeners.',
    ].join('\n');

    const historyLines = params.history
      .slice(-6)
      .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`)
      .join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        `Authorized Care Context:\n${contextJson}`,
        historyLines ? `Recent Conversation:\n${historyLines}` : '',
        `Current User Utterance: ${params.transcript}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: { type: Type.STRING },
            spokenText: { type: Type.STRING },
          },
          required: ['replyText', 'spokenText'],
        },
      },
    });

    let aiReply = ruleResult.replyText;
    let aiSpoken = ruleResult.replyText;
    if (response.text) {
      const parsed = JSON.parse(response.text) as { replyText?: string; spokenText?: string };
      if (parsed.replyText?.trim()) aiReply = parsed.replyText.trim();
      if (parsed.spokenText?.trim()) aiSpoken = parsed.spokenText.trim();
      else aiSpoken = aiReply;
    }

    return {
      replyText: aiReply,
      spokenText: aiSpoken,
      responseLanguageCode: langMeta.code,
      responseLanguageName: langMeta.englishName,
      responseBcp47: langMeta.bcp47,
      direction: langMeta.defaultDir,
      detectedLanguageCode: scriptHint || langMeta.code,
      intent: ruleResult.intent,
      navigateTo: ruleResult.navigateTo,
      requiresConfirmation: ruleResult.requiresConfirmation,
      pendingAction: ruleResult.pendingAction,
      emergencyNotice: ruleResult.emergencyNotice,
      poweredByModel: true,
    };
  } catch {
    // Graceful resilience fallback to deterministic multilingual response
    return {
      replyText: ruleResult.replyText,
      spokenText: ruleResult.replyText,
      responseLanguageCode: langMeta.code,
      responseLanguageName: langMeta.englishName,
      responseBcp47: langMeta.bcp47,
      direction: langMeta.defaultDir,
      detectedLanguageCode: scriptHint || langMeta.code,
      intent: ruleResult.intent,
      navigateTo: ruleResult.navigateTo,
      requiresConfirmation: ruleResult.requiresConfirmation,
      pendingAction: ruleResult.pendingAction,
      emergencyNotice: ruleResult.emergencyNotice,
      poweredByModel: false,
    };
  }
}

export async function executeConfirmedVoiceAction(
  params: {
    uid: string;
    actorName: string;
    email?: string;
    confirmed: boolean;
    actionType: 'log_dose' | 'notify_caregiver_missed' | 'change_language';
    groupId?: string;
    payload: {
      medicationId?: string;
      medicationName?: string;
      scheduledDate?: string;
      scheduledTime?: string;
      status?: 'taken' | 'skipped' | 'missed' | 'not_confirmed';
      note?: string;
      targetLanguageCode?: string;
      targetScript?: string;
    };
  },
  db: Firestore = adminDb,
): Promise<{
  executed: true;
  actionType: string;
  summary: string;
  updatedLanguageCode?: string;
  updatedScript?: string;
  notificationsSent?: number;
}> {
  if (params.confirmed !== true) {
    throw AppError.badRequest('Explicit confirmation is required before executing care actions.');
  }

  if (params.actionType === 'change_language') {
    const targetCode = params.payload.targetLanguageCode;
    if (!targetCode || !VOICE_LANGUAGE_MATRIX.some((l) => l.code === targetCode)) {
      throw AppError.badRequest('Unsupported target language code.');
    }
    const targetMeta = getVoiceLanguageCapability(targetCode);
    const chosenScript = params.payload.targetScript || targetMeta.defaultScript;

    await updateMyProfile(
      params.uid,
      params.email,
      {
        preferredLanguage: targetMeta.code,
        preferredScript: chosenScript,
      },
      db,
    );

    return {
      executed: true,
      actionType: 'change_language',
      summary: `Preferred language updated to ${targetMeta.nativeName} (${targetMeta.englishName}).`,
      updatedLanguageCode: targetMeta.code,
      updatedScript: chosenScript,
    };
  }

  if (!params.groupId) {
    throw AppError.badRequest('groupId is required for care circle voice actions.');
  }

  if (params.actionType === 'log_dose') {
    const { medicationId, scheduledDate, scheduledTime, status, note } = params.payload;
    if (!medicationId || !scheduledDate || !scheduledTime || !status) {
      throw AppError.badRequest('medicationId, scheduledDate, scheduledTime, and status are required.');
    }
    const medSnap = await db.doc(`medications/${medicationId}`).get();
    if (!medSnap.exists) {
      throw AppError.notFound('Medication not found.');
    }
    const med = medSnap.data() as MedicationDoc;
    if (med.groupId !== params.groupId) {
      throw AppError.forbidden('Forbidden: medication does not belong to the active care group.');
    }
    const saved = await recordDoseEvent(
      {
        medId: medicationId,
        actorUid: params.uid,
        actorName: params.actorName,
        scheduledDate,
        scheduledTime,
        status,
        note: note || 'Logged via CareBridge voice assistant',
      },
      db,
    );
    return {
      executed: true,
      actionType: 'log_dose',
      summary: `Marked ${saved.medicationName} (${saved.scheduledTime}) as ${saved.status}.`,
    };
  }

  // notify_caregiver_missed
  const { group, member } = await assertActiveMember(params.groupId, params.uid, db);
  const membersSnap = await db.collection(`careGroups/${params.groupId}/members`).get();
  const peers = membersSnap.docs
    .map((d) => d.data() as CareMemberDoc)
    .filter((m) => m.status === 'active' && m.uid !== params.uid)
    .slice(0, 12);

  const actorDisplay = clampStr(params.actorName || member.displayName, 120) || 'Member';
  const medName = params.payload.medicationName || 'Scheduled Medication';
  const schedTime = params.payload.scheduledTime || formatTimezoneTimeKey(new Date(), group.timezone || 'Asia/Kolkata');

  const batch = db.batch();
  let notificationsSent = 0;

  for (const peer of peers) {
    const peerProfileSnap = await db.doc(`users/${peer.uid}`).get();
    const peerProfile = peerProfileSnap.exists
      ? (peerProfileSnap.data() as { preferredLanguage?: string; preferredScript?: string })
      : undefined;

    const localized = buildLocalizedNotification({
      type: 'missed_dose',
      languageCode: peerProfile?.preferredLanguage,
      preferredScript: peerProfile?.preferredScript,
      medicationName: medName,
      scheduledTime: schedTime,
      elderlyName: group.elderlyName,
      summary: params.payload.note || `${actorDisplay} asked to alert caregivers about ${medName} (${schedTime}).`,
    });

    const notifId = generateDocId('ntf');
    batch.set(db.doc(`notifications/${notifId}`), {
      id: notifId,
      groupId: params.groupId,
      recipientUid: peer.uid,
      type: 'missed_dose',
      title: localized.title,
      message: localized.message,
      channel: 'in_app',
      deliveryStatus: 'sent',
      dedupeKey: `voice_missed_${params.groupId}_${notifId}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    notificationsSent++;
  }

  const actId = generateDocId('act');
  batch.set(db.doc(`activityLogs/${actId}`), {
    id: actId,
    groupId: params.groupId,
    memberUids: group.memberUids.slice(0, 20),
    actorUid: params.uid,
    actorName: actorDisplay,
    actorRole: member.role,
    actionType: 'VOICE_CAREGIVER_ALERT_SENT',
    entityType: 'notification',
    entityId: actId,
    summary: `Voice assistant sent missed-reminder alert for ${medName} (${schedTime}) to ${notificationsSent} caregiver(s).`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return {
    executed: true,
    actionType: 'notify_caregiver_missed',
    summary:
      notificationsSent > 0
        ? `Sent localized missed-reminder alert for ${medName} to ${notificationsSent} care circle member(s).`
        : 'No other active caregivers in this care group yet; logged event in Activity History.',
    notificationsSent,
  };
}

const GOOGLE_CLOUD_TTS_VOICES: Record<string, { languageCode: string; name: string }> = {
  en: { languageCode: 'en-IN', name: 'en-IN-Standard-A' },
  hi: { languageCode: 'hi-IN', name: 'hi-IN-Standard-A' },
  kn: { languageCode: 'kn-IN', name: 'kn-IN-Standard-A' },
  te: { languageCode: 'te-IN', name: 'te-IN-Standard-A' },
  ta: { languageCode: 'ta-IN', name: 'ta-IN-Standard-A' },
  ml: { languageCode: 'ml-IN', name: 'ml-IN-Standard-A' },
  mr: { languageCode: 'mr-IN', name: 'mr-IN-Standard-A' },
  bn: { languageCode: 'bn-IN', name: 'bn-IN-Standard-A' },
  gu: { languageCode: 'gu-IN', name: 'gu-IN-Standard-A' },
  pa: { languageCode: 'pa-IN', name: 'pa-IN-Standard-A' },
};

export function ensureValidWavBase64(rawBase64: string): {
  base64: string;
  byteLength: number;
} | null {
  const cleaned = rawBase64.replace(/\s+/g, '');
  if (!cleaned) return null;
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.length < 32) return null;

  // Unary Gemini 3.8 TTS returns complete WAV with 'RIFF' header (24kHz mono 16-bit LE)
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.length >= 44) {
    return { base64: cleaned, byteLength: buf.length };
  }

  // Defensive wrap if provider ever streams raw L16 24kHz mono PCM without RIFF header
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + buf.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(24000 * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(buf.length, 40);
  const wav = Buffer.concat([header, buf]);
  return { base64: wav.toString('base64'), byteLength: wav.length };
}

async function synthesizeWithGoogleCloudTts(params: {
  text: string;
  languageCode: string;
  speakingRate: number;
}): Promise<{ audioBase64: string; byteLength: number } | null> {
  const apiKey = serverEnv.googleCloudTtsApiKey;
  if (!apiKey) return null;
  const voiceSpec = GOOGLE_CLOUD_TTS_VOICES[params.languageCode];
  if (!voiceSpec) return null;

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: params.text },
        voice: {
          languageCode: voiceSpec.languageCode,
          name: voiceSpec.name,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.max(0.7, Math.min(1.3, params.speakingRate)),
        },
      }),
    },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) return null;
  const cleaned = data.audioContent.replace(/\s+/g, '');
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.length < 128) return null;
  return { audioBase64: cleaned, byteLength: buf.length };
}

export async function synthesizeSpeechWithGemini(params: {
  text: string;
  languageCode: string;
  speakingRate: number;
}): Promise<SynthesizeSpeechResult> {
  const cap = getVoiceLanguageCapability(params.languageCode);

  if (cap.neuralServerSupport === 'experimental') {
    return {
      audioAvailable: false,
      provider: 'none',
      languageCode: cap.code,
      bcp47: cap.bcp47,
      speakingRate: params.speakingRate,
      fallbackToBrowserTts: true,
      reason: `${cap.englishName} server neural voice synthesis is experimental only; browser/text fallback active.`,
    };
  }

  const ai = getVoiceGeminiClient();
  let geminiFailureReason: string | undefined;

  if (ai) {
    try {
      const rateHint =
        params.speakingRate <= 0.85
          ? `Speak slowly, warmly, and clearly in ${cap.englishName} for an elderly listener.`
          : params.speakingRate >= 1.1
            ? `Speak clearly in ${cap.englishName} at a natural conversational pace.`
            : `Speak warmly, calmly, and clearly in ${cap.englishName} for an elderly listener.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: params.text,
                speechMetadata: {
                  style: rateHint,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore',
              },
            },
          },
        },
      });

      const rawAudioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const validatedWav = rawAudioData ? ensureValidWavBase64(rawAudioData) : null;

      if (validatedWav) {
        return {
          audioAvailable: true,
          audioBase64: validatedWav.base64,
          mimeType: 'audio/wav',
          byteLength: validatedWav.byteLength,
          provider: 'gemini-3.8-flash-lite-tts',
          languageCode: cap.code,
          bcp47: cap.bcp47,
          speakingRate: params.speakingRate,
          fallbackToBrowserTts: false,
        };
      }
      geminiFailureReason = 'Gemini speech synthesis returned empty or malformed audio bytes.';
    } catch (err) {
      geminiFailureReason =
        err instanceof Error
          ? `Gemini TTS error: ${err.message}`
          : 'Gemini TTS temporarily unavailable.';
    }
  } else {
    geminiFailureReason = 'GEMINI_API_KEY is not configured on the server.';
  }

  // Secondary Server Provider: Official Google Cloud Text-to-Speech v1 REST API
  try {
    const cloudMp3 = await synthesizeWithGoogleCloudTts({
      text: params.text,
      languageCode: cap.code,
      speakingRate: params.speakingRate,
    });
    if (cloudMp3) {
      return {
        audioAvailable: true,
        audioBase64: cloudMp3.audioBase64,
        mimeType: 'audio/mpeg',
        byteLength: cloudMp3.byteLength,
        provider: 'google-cloud-tts',
        languageCode: cap.code,
        bcp47: cap.bcp47,
        speakingRate: params.speakingRate,
        fallbackToBrowserTts: false,
      };
    }
  } catch {
    // Fall through cleanly to browser SpeechSynthesis fallback
  }

  return {
    audioAvailable: false,
    provider: 'none',
    languageCode: cap.code,
    bcp47: cap.bcp47,
    speakingRate: params.speakingRate,
    fallbackToBrowserTts: true,
    reason: geminiFailureReason
      ? `${geminiFailureReason} Attempting browser SpeechSynthesis fallback.`
      : 'Server TTS unavailable; attempting browser SpeechSynthesis fallback.',
  };
}
