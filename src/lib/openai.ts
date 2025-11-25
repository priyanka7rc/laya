import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Pricing for GPT-4o-mini (per 1M tokens)
const PRICING = {
  input: 0.15,   // $0.15 per 1M input tokens
  output: 0.60,  // $0.60 per 1M output tokens
};

// System prompt for task parsing
const TASK_PARSING_PROMPT = `You are a task parsing assistant. Extract structured task information from natural language input.

Return JSON in this exact format:
{
  "title": "Clean, actionable task title (remove time/date phrases)",
  "due_date": "YYYY-MM-DD or null",
  "due_time": "HH:MM or null (24-hour format)",
  "category": "Shopping|Meals|Work|Health|Home|Personal|Finance|Tasks"
}

Rules:
1. Title should be clean and actionable (e.g., "Buy milk" not "Buy milk tomorrow at 3pm")
2. Infer smart defaults:
   - "tomorrow" → next day's date
   - "morning" → 08:00
   - "afternoon" → 14:00
   - "evening" → 18:00
   - No time mentioned → null
   - No date mentioned → null (today is implied)
3. Detect category from task content:
   - Shopping: buy, get, purchase, groceries, milk, eggs, etc.
   - Meals: cook, prepare, bake, dinner, lunch, breakfast, etc.
   - Work: meeting, project, deadline, email, presentation, etc.
   - Health: doctor, dentist, appointment, checkup, medicine, gym, workout, etc.
   - Home: clean, laundry, dishes, vacuum, organize, fix, repair, etc.
   - Personal: call, text, visit, birthday, family, friend, etc.
   - Finance: pay, bill, bank, transfer, budget, taxes, etc.
   - Tasks: anything that doesn't fit above
4. Handle casual language and variations
5. If input is ambiguous, make best guess

Examples:
- "Buy milk tomorrow at 3pm" → {"title": "Buy milk", "due_date": "<tomorrow>", "due_time": "15:00", "category": "Shopping"}
- "Call mom" → {"title": "Call mom", "due_date": null, "due_time": null, "category": "Personal"}
- "Doctor appointment Monday morning" → {"title": "Doctor appointment", "due_date": "<next Monday>", "due_time": "08:00", "category": "Health"}`;

interface TaskParseResult {
  title: string;
  due_date: string | null;
  due_time: string | null;
  category: string;
}

interface UsageLog {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  input_text: string;
  endpoint: string;
}

/**
 * Calculate cost based on token usage
 */
export function calculateCost(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * PRICING.input;
  const outputCost = (completionTokens / 1_000_000) * PRICING.output;
  return inputCost + outputCost;
}

/**
 * Parse task using OpenAI
 */
export async function parseTaskWithAI(text: string): Promise<TaskParseResult> {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: TASK_PARSING_PROMPT },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Lower temperature for more consistent parsing
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content) as TaskParseResult;
    
    // Return usage info along with parsed task
    const usage = {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
      cost: calculateCost(
        response.usage?.prompt_tokens || 0,
        response.usage?.completion_tokens || 0
      ),
    };

    console.log('📊 OpenAI Usage:', {
      input: text,
      tokens: usage.totalTokens,
      cost: `$${usage.cost.toFixed(6)}`,
    });

    return {
      ...parsed,
      ...(usage as any), // Include usage for logging
    };
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw error;
  }
}

/**
 * Check if user has exceeded token quota
 */
export async function checkTokenQuota(userId: string): Promise<boolean> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: user } = await supabase
    .from('users')
    .select('gpt_token_total')
    .eq('id', userId)
    .single();

  const tokenLimit = parseInt(process.env.TOKEN_LIMIT_PER_USER || '100000');
  const currentUsage = user?.gpt_token_total || 0;

  return currentUsage < tokenLimit;
}

/**
 * Log usage to Supabase
 */
export async function logUsage(
  userId: string,
  usageLog: UsageLog
): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Insert usage log
  await supabase
    .from('gpt_usage_logs')
    .insert({
      user_id: userId,
      model: usageLog.model,
      prompt_tokens: usageLog.prompt_tokens,
      completion_tokens: usageLog.completion_tokens,
      total_tokens: usageLog.total_tokens,
      estimated_cost_usd: usageLog.estimated_cost_usd,
      input_text: usageLog.input_text,
      endpoint: usageLog.endpoint,
    });

  // Update user's total token count
  await supabase.rpc('increment_user_tokens', {
    user_id: userId,
    tokens: usageLog.total_tokens,
  });

  console.log('✅ Logged usage for user:', userId, {
    tokens: usageLog.total_tokens,
    cost: `$${usageLog.estimated_cost_usd.toFixed(6)}`,
  });
}

// ============================================
// WHISPER TRANSCRIPTION FOR WHATSAPP
// ============================================

/**
 * Download audio file from WhatsApp and transcribe with Whisper
 * 
 * WhatsApp audio flow:
 * 1. Get media URL from WhatsApp API
 * 2. Download audio file
 * 3. Send to Whisper API
 * 4. Return transcription
 */
export async function transcribeAudioFromWhatsApp(
  audioId: string
): Promise<{ text: string; audioUrl: string }> {
  try {
    // 1. Get media URL from WhatsApp
    const mediaUrl = await getWhatsAppMediaUrl(audioId);
    
    // 2. Download audio file
    const audioBuffer = await downloadWhatsAppMedia(mediaUrl);
    
    // 3. Transcribe with Whisper
    const transcription = await transcribeWithWhisper(audioBuffer);
    
    return {
      text: transcription,
      audioUrl: mediaUrl,
    };
  } catch (error) {
    console.error('❌ Error transcribing WhatsApp audio:', error);
    throw error;
  }
}

/**
 * Get media URL from WhatsApp Cloud API
 */
async function getWhatsAppMediaUrl(mediaId: string): Promise<string> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN not configured');
  }

  try {
    // Get media URL from WhatsApp API
    const response = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get media URL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Error getting WhatsApp media URL:', error);
    throw error;
  }
}

/**
 * Download media file from WhatsApp
 */
async function downloadWhatsAppMedia(mediaUrl: string): Promise<Buffer> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN not configured');
  }

  try {
    const response = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error downloading WhatsApp media:', error);
    throw error;
  }
}

/**
 * Transcribe audio buffer with OpenAI Whisper
 */
async function transcribeWithWhisper(audioBuffer: Buffer): Promise<string> {
  try {
    // Create a File-like object from the buffer
    const audioFile = new File([audioBuffer], 'audio.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Can be detected automatically or set to 'hi' for Hindi
      response_format: 'text',
    });

    console.log('🎤 Whisper transcription:', transcription);
    return transcription as string;
  } catch (error) {
    console.error('Error with Whisper transcription:', error);
    throw error;
  }
}

