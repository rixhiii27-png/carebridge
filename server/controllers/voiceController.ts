import type { Request, Response } from 'express';
import { VOICE_LANGUAGE_MATRIX } from '../../shared/voiceLanguageMatrix.ts';
import { getBackendDb } from '../config/backendContext.ts';
import { serverEnv } from '../config/env.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import {
  converseWithVoiceAssistant,
  executeConfirmedVoiceAction,
  synthesizeSpeechWithGemini,
  transcribeAudioWithGemini,
} from '../modules/voice/voiceService.ts';

function requireActor(req: Request): { uid: string; email?: string; name: string } {
  const authed = req as AuthenticatedRequest;
  if (!authed.user?.uid) {
    throw AppError.unauthorized('Authentication required.');
  }
  return {
    uid: authed.user.uid,
    email: authed.user.email,
    name: authed.user.name || 'CareBridge User',
  };
}

export async function handleGetVoiceCapabilities(_req: Request, res: Response): Promise<void> {
  const neuralConfigured = Boolean(
    serverEnv.geminiApiKey && serverEnv.geminiApiKey !== 'MY_GEMINI_API_KEY',
  );
  const googleCloudTtsConfigured = Boolean(serverEnv.googleCloudTtsApiKey);
  res.json({
    ok: true,
    neuralConfigured,
    googleCloudTtsConfigured,
    ttsProviders: [
      ...(neuralConfigured ? ['gemini-3.8-flash-lite-tts'] : []),
      ...(googleCloudTtsConfigured ? ['google-cloud-tts'] : []),
      'browser-speech-synthesis',
    ],
    zeroAudioRetention: true,
    languagesCount: VOICE_LANGUAGE_MATRIX.length,
    languages: VOICE_LANGUAGE_MATRIX.map((lang) => ({
      code: lang.code,
      englishName: lang.englishName,
      nativeName: lang.nativeName,
      bcp47: lang.bcp47,
      defaultScript: lang.defaultScript,
      defaultDir: lang.defaultDir,
      recognitionTier: lang.recognitionTier,
      synthesisTier: lang.synthesisTier,
      browserSttExpected: lang.browserSttExpected,
      neuralServerSupport: lang.neuralServerSupport,
      capabilityNote: lang.capabilityNote,
    })),
  });
}

export async function handleVoiceTranscribe(req: Request, res: Response): Promise<void> {
  requireActor(req);
  const result = await transcribeAudioWithGemini(req.body);
  res.json({ ok: true, ...result });
}

export async function handleVoiceConverse(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const db = getBackendDb();
  const result = await converseWithVoiceAssistant(
    {
      uid: actor.uid,
      transcript: req.body.transcript,
      preferredLanguage: req.body.preferredLanguage,
      autoDetectLanguage: req.body.autoDetectLanguage,
      groupId: req.body.groupId,
      history: req.body.history,
    },
    db,
  );
  res.json({ ok: true, ...result });
}

export async function handleVoiceExecuteAction(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const db = getBackendDb();
  const result = await executeConfirmedVoiceAction(
    {
      uid: actor.uid,
      actorName: actor.name,
      email: actor.email,
      confirmed: req.body.confirmed,
      actionType: req.body.actionType,
      groupId: req.body.groupId,
      payload: req.body.payload,
    },
    db,
  );
  res.json({ ok: true, ...result });
}

export async function handleVoiceSynthesize(req: Request, res: Response): Promise<void> {
  requireActor(req);
  const result = await synthesizeSpeechWithGemini(req.body);
  res.json({ ok: true, ...result });
}
