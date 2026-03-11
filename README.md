This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Task import from media (OCR)

Tasks can be created from uploaded images or PDFs via the **Upload** button on the Tasks tab. The pipeline uses an OCR provider to extract text, then applies the same rules-based parsing as keyboard input (no AI for understanding).

### OCR provider (swappable)

- **Env:** `OCR_PROVIDER` — `openai` (default) or `google`.
- **Adapter pattern:** The app uses a single `OcrClient` interface. To switch or add a provider:
  1. Implement `OcrClient` in `src/server/ocr/providers/<name>.ts` (see `openai.ts`).
  2. Register it in `src/server/ocr/index.ts` in `getOcrClient()`.
  3. Set `OCR_PROVIDER=<name>` (and any provider-specific env, e.g. `OPENAI_API_KEY` for `openai`).
- **OpenAI:** Requires `OPENAI_API_KEY`. Supports images (JPEG, PNG, GIF, WebP). PDF is not supported with OpenAI; use an image or implement the Google adapter for PDF.
- **Google:** Stub only; implement `GoogleOcrClient.extract()` and add credentials to use it.
