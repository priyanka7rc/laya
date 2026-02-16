/**
 * WhatsApp Template Inventory
 * Centralized registry of all Gupshup template messages
 */

// ============================================
// TEMPLATE DEFINITION
// ============================================

export interface WhatsAppTemplate {
  templateKey: string;
  templateId: string | undefined;
  expectedParamCount: number;
}

// ============================================
// TEMPLATE REGISTRY
// ============================================

export const TEMPLATES = {
  TASK_REMINDER: {
    templateKey: 'TASK_REMINDER',
    templateId: process.env.GUPSHUP_TEMPLATE_TASK_REMINDER_ID,
    expectedParamCount: 2, // e.g., ["Task title", "Due time"]
  },
  DAILY_DIGEST: {
    templateKey: 'DAILY_DIGEST',
    templateId: process.env.GUPSHUP_TEMPLATE_DAILY_DIGEST_ID,
    expectedParamCount: 2, // e.g., ["Task count", "Task list"]
  },
} as const;

// ============================================
// TEMPLATE KEYS TYPE
// ============================================

export type TemplateKey = keyof typeof TEMPLATES;

// ============================================
// VALIDATION
// ============================================

/**
 * Validate a template call before sending
 * 
 * @param templateKey - Template identifier (e.g., 'TASK_REMINDER')
 * @param params - Array of parameter values
 * @throws Error if template ID is missing, param count mismatch, or empty params
 * 
 * Example:
 * validateTemplateCall('TASK_REMINDER', ['Buy milk', 'today at 5pm']);
 */
export function validateTemplateCall(
  templateKey: TemplateKey,
  params: string[]
): void {
  const template = TEMPLATES[templateKey];

  // Check if template ID is configured
  if (!template.templateId) {
    throw new Error(
      `Template ID not configured for ${templateKey}. ` +
      `Set GUPSHUP_TEMPLATE_${templateKey}_ID in environment variables.`
    );
  }

  // Check param count
  if (params.length !== template.expectedParamCount) {
    throw new Error(
      `Template ${templateKey} expects ${template.expectedParamCount} parameters, ` +
      `but received ${params.length}`
    );
  }

  // Check for empty or whitespace-only params
  const emptyParamIndex = params.findIndex(
    (param) => !param || param.trim().length === 0
  );
  
  if (emptyParamIndex !== -1) {
    throw new Error(
      `Template ${templateKey} parameter at index ${emptyParamIndex} is empty or whitespace`
    );
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get template ID for a given template key
 * 
 * @param templateKey - Template identifier
 * @returns Template ID if configured, undefined otherwise
 */
export function getTemplateId(templateKey: TemplateKey): string | undefined {
  return TEMPLATES[templateKey].templateId;
}

/**
 * Check if a template is configured (has an ID)
 * 
 * @param templateKey - Template identifier
 * @returns true if template ID is set
 */
export function isTemplateConfigured(templateKey: TemplateKey): boolean {
  return !!TEMPLATES[templateKey].templateId;
}
