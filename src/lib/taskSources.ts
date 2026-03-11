/**
 * Canonical task source identifiers for all intake paths.
 */
export const TASK_SOURCES = {
  WEB_KEYBOARD: 'web_keyboard',
  WEB_BRAIN_DUMP: 'web_brain_dump',
  WEB_MEDIA: 'web_media',
  WHATSAPP_TEXT: 'whatsapp_text',
  WHATSAPP_MEDIA: 'whatsapp_media',
} as const;

export type TaskSource = (typeof TASK_SOURCES)[keyof typeof TASK_SOURCES];

