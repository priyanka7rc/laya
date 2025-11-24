-- Add token tracking field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS gpt_token_total INTEGER DEFAULT 0;

-- Create usage logs table
CREATE TABLE IF NOT EXISTS gpt_usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  estimated_cost_usd NUMERIC(10, 6) NOT NULL,
  input_text TEXT,
  endpoint TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE gpt_usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy for viewing own usage logs
CREATE POLICY "Users can view their own usage logs"
  ON gpt_usage_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Create function to increment user token count
CREATE OR REPLACE FUNCTION increment_user_tokens(user_id UUID, tokens INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET gpt_token_total = COALESCE(gpt_token_total, 0) + tokens
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_gpt_usage_logs_user_id ON gpt_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_gpt_usage_logs_created_at ON gpt_usage_logs(created_at);

