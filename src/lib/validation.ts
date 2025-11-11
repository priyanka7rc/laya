import { z } from 'zod';

export const TaskQuickAddSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(120, 'Title must be 120 characters or less')
    .trim(),
  
  notes: z
    .string()
    .max(500, 'Notes must be 500 characters or less')
    .optional()
    .nullable(),
  
  category: z
    .string()
    .max(50, 'Category must be 50 characters or less')
    .optional()
    .nullable(),
  
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (use YYYY-MM-DD)')
    .optional()
    .nullable()
    .or(z.literal('')),
  
  due_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (use HH:MM)')
    .optional()
    .nullable()
    .or(z.literal('')),
  
  alert_count: z
    .number()
    .int('Alert count must be a whole number')
    .min(0, 'Alert count cannot be negative')
    .max(5, 'Maximum 5 alerts allowed')
    .optional()
    .default(0),
  
  alert_offsets: z
    .array(
      z.number()
        .int('Alert offset must be a whole number')
        .nonnegative('Alert offset cannot be negative')
    )
    .max(5, 'Maximum 5 alert offsets')
    .optional()
    .default([]),
});

export type TaskQuickAddInput = z.infer<typeof TaskQuickAddSchema>;

// Validation helper that returns formatted errors
export function validateTaskQuickAdd(data: unknown) {
  const result = TaskQuickAddSchema.safeParse(data);
  
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    const errorMessages: string[] = [];
    
    result.error.issues.forEach((error) => {
      const field = error.path[0] as string;
      const message = error.message;
      
      if (!fieldErrors[field]) {
        fieldErrors[field] = message;
        errorMessages.push(`${field}: ${message}`);
      }
    });
    
    return {
      success: false,
      errors: fieldErrors,
      message: errorMessages.join('; '),
    };
  }
  
  return {
    success: true,
    data: result.data,
  };
}