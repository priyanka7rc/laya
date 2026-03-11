/**
 * Google Cloud Vision OCR adapter (stub).
 * Implement OcrClient and register in getOcrClient() to use.
 */

import type { OcrClient, OcrResult, OcrExtractInput } from '../types';

export class GoogleOcrClient implements OcrClient {
  async extract(_input: OcrExtractInput): Promise<OcrResult> {
    throw new Error('Google OCR provider is not implemented. Set OCR_PROVIDER=openai or implement GoogleOcrClient.extract().');
  }
}
