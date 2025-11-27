# WhatsApp Integration Setup Guide

## 1. Add Environment Variables

Add these to your `/Users/priyankavijayakumar/laya/.env.local` file:

```bash
# Gupshup Configuration
GUPSHUP_APP_ID=your-app-id-here
GUPSHUP_APP_NAME=your-app-name-here
GUPSHUP_API_KEY=your-api-key-here
GUPSHUP_SOURCE_NUMBER=919876543210

# Conversation Context Window (configurable for testing)
CONVERSATION_CONTEXT_ENABLED=true
CONVERSATION_CONTEXT_HOURS=48
CONVERSATION_CONTEXT_MAX_MESSAGES=20
```

### How to get WhatsApp credentials:

1. **WHATSAPP_VERIFY_TOKEN** (create your own):
   - Generate a secure random token:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   - Save this token - you'll need it when configuring the webhook

2. **WHATSAPP_ACCESS_TOKEN**:
   - Go to https://business.facebook.com
   - Navigate to your Meta Business Account
   - Go to WhatsApp > API Setup
   - Copy the "Temporary access token" (for testing) or create a permanent token

3. **WHATSAPP_PHONE_NUMBER_ID**:
   - In the same API Setup page
   - Find "Phone number ID" under your test number
   - Copy this ID

4. **WHATSAPP_BUSINESS_ACCOUNT_ID** (optional):
   - In Meta Business Manager
   - Settings > Business Settings > WhatsApp Business Accounts
   - Copy your WhatsApp Business Account ID

## 2. Run Database Migration

Run the WhatsApp schema migration in your Supabase SQL Editor:

1. Go to https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in the left sidebar
4. Open a new query
5. Copy the contents of `supabase-whatsapp-migration.sql`
6. Run the query

Verify it worked:
```sql
SELECT * FROM user_phone_numbers LIMIT 1;
SELECT * FROM groceries LIMIT 1;
SELECT * FROM moods LIMIT 1;
```

## 3. Local Testing Setup (with ngrok)

For local testing, you need to expose your localhost to the internet:

```bash
# Install ngrok globally
npm install -g ngrok

# Start your Next.js dev server
npm run dev

# In a new terminal, start ngrok
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
```

Then configure this URL as your webhook in Meta Business Manager:
- Webhook URL: `https://abc123.ngrok.io/api/whatsapp-webhook`
- Verify Token: (use your WHATSAPP_VERIFY_TOKEN)

## 4. Production Deployment (Vercel)

Once local testing is complete:

```bash
# Deploy to Vercel
npx vercel --prod

# Add all environment variables in Vercel dashboard:
# - OPENAI_API_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - TOKEN_LIMIT_PER_USER
# - WHATSAPP_VERIFY_TOKEN
# - WHATSAPP_ACCESS_TOKEN
# - WHATSAPP_PHONE_NUMBER_ID
# - WHATSAPP_BUSINESS_ACCOUNT_ID
```

Update your WhatsApp webhook to production URL:
- Webhook URL: `https://your-app.vercel.app/api/whatsapp-webhook`

## 5. Test the Integration

Send a test message to your WhatsApp Business number:
- Text message: "Remind me to buy milk tomorrow"
- Audio message: Record a voice note with a task

Check:
- Database for new message entry
- Laya's response in WhatsApp
- Task created in tasks table
- Dashboard shows the conversation

## Troubleshooting

### Webhook not receiving messages
- Check ngrok is running
- Verify webhook URL in Meta Business Manager
- Check WHATSAPP_VERIFY_TOKEN matches

### Messages received but no response
- Check Next.js dev server logs
- Verify OPENAI_API_KEY is set
- Check SUPABASE_SERVICE_ROLE_KEY is correct

### Audio transcription failing
- Verify OpenAI Whisper API access
- Check audio file download from WhatsApp
- Review token quota limits

## Next Steps

After successful setup:
1. Test with multiple message types (text, audio)
2. Verify task extraction works
3. Check grocery and mood detection
4. Test dashboard displays correctly
5. Monitor OpenAI token usage
6. Set up production WhatsApp Business number

