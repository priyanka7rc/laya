/**
 * OpenAI Vision OCR adapter. OCR-only: extract text verbatim, no interpretation.
 */

import OpenAI from 'openai';
import type { OcrClient, OcrPage, OcrResult, OcrExtractInput } from '../types';

const OCR_LOG = '[OCR:openai]';

export class OpenAiOcrClient implements OcrClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(input: OcrExtractInput): Promise<OcrResult> {
    const start = Date.now();
    const { bytes, mimeType, filename, maxPages = 20 } = input;

    const imageMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!imageMimes.includes(mimeType)) {
      if (mimeType === 'application/pdf') {
        throw new Error('PDF is not supported with OpenAI OCR. Use an image or set OCR_PROVIDER=google.');
      }
      throw new Error(`Unsupported media type: ${mimeType}`);
    }

    // OpenAI vision: one image per request.
    // for MVP we support single image or first page as image. PDF support can be "first page as image" or external conversion.
    const file = new File([new Uint8Array(bytes)], filename || 'upload', { type: mimeType });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

    const response = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the text verbatim. Preserve line breaks. Do not summarize or interpret. Return only the extracted text, no JSON.',
            },
            {
              type: 'image_url',
              image_url: {
                url: await this.dataUrlFromFile(file),
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? '';
    const ms = Date.now() - start;

    const result: OcrResult = {
      fullText: content,
      pages: [{ pageIndex: 0, text: content }],
      meta: { provider: 'openai', model, ms },
    };

    if (maxPages && result.pages.length > maxPages) {
      result.pages = result.pages.slice(0, maxPages);
      result.fullText = result.pages.map((p: OcrPage) => p.text).join('\n\n');
    }

    return result;
  }

  private async dataUrlFromFile(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mime = file.type || 'image/png';
    return `data:${mime};base64,${base64}`;
  }
}
