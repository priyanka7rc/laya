/**
 * OCR client factory. Provider is selected via OCR_PROVIDER env (default: openai).
 * To add a provider: implement OcrClient in providers/<name>.ts and add a case below.
 */

import type { OcrClient } from './types';
import { OpenAiOcrClient } from './providers/openai';
import { GoogleOcrClient } from './providers/google';

let cachedClient: OcrClient | null = null;

export type OcrProvider = 'openai' | 'google';

export function getOcrClient(): OcrClient {
  if (cachedClient) return cachedClient;

  const provider = (process.env.OCR_PROVIDER || 'openai').toLowerCase() as OcrProvider;

  switch (provider) {
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is required for OCR_PROVIDER=openai');
      cachedClient = new OpenAiOcrClient(key);
      break;
    }
    case 'google':
      cachedClient = new GoogleOcrClient();
      break;
    default:
      throw new Error(`Unknown OCR_PROVIDER: ${process.env.OCR_PROVIDER}. Use openai or google.`);
  }

  return cachedClient;
}

export type { OcrClient, OcrResult, OcrPage, OcrExtractInput } from './types';
