/**
 * Token Usage Limits and Monitoring
 * Enforces per-user monthly token limits
 */

import { supabase } from './supabaseClient';

const TOKEN_LIMIT_PER_USER = parseInt(process.env.TOKEN_LIMIT_PER_USER || '100000');

/**
 * Check if user has exceeded monthly token limit
 */
export async function checkTokenLimit(userId: string): Promise<{
  allowed: boolean;
  tokensUsed: number;
  tokensRemaining: number;
  message?: string;
}> {
  try {
    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Query user's token usage this month
    const { data, error } = await supabase
      .from('ai_usage_logs')
      .select('tokens_in, tokens_out')
      .eq('user_id', userId)
      .gte('created_at', startOfMonth.toISOString());

    if (error) {
      console.error('Error checking token limit:', error);
      // Fail open - allow the call but log error
      return { allowed: true, tokensUsed: 0, tokensRemaining: TOKEN_LIMIT_PER_USER };
    }

    // Calculate total tokens used
    const tokensUsed = (data || []).reduce(
      (sum, log) => sum + (log.tokens_in || 0) + (log.tokens_out || 0),
      0
    );

    const tokensRemaining = TOKEN_LIMIT_PER_USER - tokensUsed;
    const allowed = tokensUsed < TOKEN_LIMIT_PER_USER;

    if (!allowed) {
      return {
        allowed: false,
        tokensUsed,
        tokensRemaining: 0,
        message: `Monthly token limit (${TOKEN_LIMIT_PER_USER.toLocaleString()}) exceeded. Used: ${tokensUsed.toLocaleString()}. Resets next month.`,
      };
    }

    // Warn at 80%
    if (tokensUsed > TOKEN_LIMIT_PER_USER * 0.8) {
      console.warn(`⚠️ User ${userId} at ${Math.round(tokensUsed / TOKEN_LIMIT_PER_USER * 100)}% of token limit`);
    }

    return {
      allowed: true,
      tokensUsed,
      tokensRemaining,
    };
  } catch (error) {
    console.error('Error in checkTokenLimit:', error);
    // Fail open
    return { allowed: true, tokensUsed: 0, tokensRemaining: TOKEN_LIMIT_PER_USER };
  }
}

/**
 * Log AI usage to database
 */
export async function logAIUsage(params: {
  userId: string;
  feature: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  cacheHit: boolean;
}): Promise<void> {
  try {
    // Only log if tracking enabled
    if (process.env.AI_USAGE_TRACKING_ENABLED !== 'true') {
      return;
    }

    await supabase.from('ai_usage_logs').insert({
      user_id: params.userId,
      feature: params.feature,
      model: params.model,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      latency_ms: params.latencyMs,
      cache_hit: params.cacheHit,
    });

    console.log(`📊 Logged AI usage: ${params.feature}, ${params.tokensIn + params.tokensOut} tokens`);
  } catch (error) {
    console.error('Error logging AI usage:', error);
    // Don't throw - logging failure shouldn't break app
  }
}

/**
 * Get user's token usage summary
 */
export async function getUserTokenUsage(userId: string): Promise<{
  thisMonth: number;
  thisWeek: number;
  limit: number;
  percentageUsed: number;
}> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday

  const { data: monthData } = await supabase
    .from('ai_usage_logs')
    .select('tokens_in, tokens_out')
    .eq('user_id', userId)
    .gte('created_at', startOfMonth.toISOString());

  const { data: weekData } = await supabase
    .from('ai_usage_logs')
    .select('tokens_in, tokens_out')
    .eq('user_id', userId)
    .gte('created_at', startOfWeek.toISOString());

  const monthTokens = (monthData || []).reduce(
    (sum, log) => sum + (log.tokens_in || 0) + (log.tokens_out || 0),
    0
  );

  const weekTokens = (weekData || []).reduce(
    (sum, log) => sum + (log.tokens_in || 0) + (log.tokens_out || 0),
    0
  );

  return {
    thisMonth: monthTokens,
    thisWeek: weekTokens,
    limit: TOKEN_LIMIT_PER_USER,
    percentageUsed: (monthTokens / TOKEN_LIMIT_PER_USER) * 100,
  };
}

