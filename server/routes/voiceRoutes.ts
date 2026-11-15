import { Router } from 'express';
import {
  handleGetVoiceCapabilities,
  handleVoiceConverse,
  handleVoiceExecuteAction,
  handleVoiceSynthesize,
  handleVoiceTranscribe,
} from '../controllers/voiceController.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { sensitiveEndpointLimiter } from '../middleware/rateLimit.ts';
import { validateBody } from '../middleware/validation.ts';
import {
  transcribeAudioSchema,
  voiceConverseSchema,
  voiceExecuteActionSchema,
  voiceSynthesizeSchema,
} from '../validators/voiceSchemas.ts';

export const voiceRouter = Router();

voiceRouter.get('/capabilities', asyncHandler(handleGetVoiceCapabilities));

voiceRouter.post(
  '/transcribe',
  sensitiveEndpointLimiter,
  validateBody(transcribeAudioSchema),
  asyncHandler(handleVoiceTranscribe),
);

voiceRouter.post(
  '/converse',
  validateBody(voiceConverseSchema),
  asyncHandler(handleVoiceConverse),
);

voiceRouter.post(
  '/execute-action',
  sensitiveEndpointLimiter,
  validateBody(voiceExecuteActionSchema),
  asyncHandler(handleVoiceExecuteAction),
);

voiceRouter.post(
  '/synthesize',
  sensitiveEndpointLimiter,
  validateBody(voiceSynthesizeSchema),
  asyncHandler(handleVoiceSynthesize),
);
