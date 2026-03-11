/**
 * Provider-agnostic OCR types.
 * Swapping providers requires implementing OcrClient and setting OCR_PROVIDER env.
 */

export interface OcrPage {
  pageIndex: number;
  text: string;
}

export interface OcrResult {
  fullText: string;
  pages: OcrPage[];
  meta?: {
    provider: string;
    model?: string;
    ms?: number;
  };
}

export interface OcrExtractInput {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  maxPages?: number;
}

export interface OcrClient {
  extract(input: OcrExtractInput): Promise<OcrResult>;
}
