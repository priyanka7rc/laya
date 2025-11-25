# WhatsApp Integration Testing Guide

## Prerequisites Checklist

Before testing, ensure you have:

- [x] Database migration run in Supabase
- [x] Environment variables added to `.env.local`
- [ ] WhatsApp Business Account set up
- [ ] Next.js dev server running
- [ ] ngrok installed (for local testing)

## Step-by-Step Testing

### 1. Run Database Migration

```bash
# Go to Supabase SQL Editor
# Copy contents of supabase-whatsapp-migration.sql
# Run the query

# Verify tables were created:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('user_phone_numbers', 'groceries', 'moods');
```

### 2. Add Environment Variables

Add to `/Users/priyankavijayakumar/laya/.env.local`:

```bash
# Generate a verify token:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env.local:
WHATSAPP_VERIFY_TOKEN=<generated-token>

# For now, leave these blank (will add during Meta setup):
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
```

### 3. Start Dev Server

```bash
cd /Users/priyankavijayakumar/laya
npm run dev

# Server should start on http://localhost:3000
# You should see: "Ready" message
```

### 4. Set Up ngrok

```bash
# Install ngrok (if not already installed)
npm install -g ngrok

# Or download from: https://ngrok.com/download

# Start ngrok in a new terminal
ngrok http 3000

# You'll see output like:
# Forwarding: https://abc123.ngrok.io -> http://localhost:3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
```

### 5. Test Webhook Locally (Without WhatsApp)

```bash
# Test GET verification
curl "http://localhost:3000/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=test123"

# Should return: test123

# Test POST (simulated WhatsApp message)
curl -X POST http://localhost:3000/api/whatsapp-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "field": "messages",
        "value": {
          "messages": [{
            "from": "1234567890",
            "id": "test-msg-1",
            "timestamp": "1234567890",
            "type": "text",
            "text": {
              "body": "Remind me to buy milk tomorrow"
            }
          }]
        }
      }]
    }]
  }'

# Check terminal logs - you should see:
# - "📨 Processing message from 1234567890"
# - "🧠 Processing with Laya..."
# - "✅ Message processed successfully"
# - "📤 [STUB] Would send WhatsApp message:" (since credentials aren't set yet)
```

### 6. Check Database

```sql
-- Check if user was created
SELECT * FROM user_phone_numbers;

-- Check if message was saved
SELECT * FROM messages WHERE channel = 'whatsapp';

-- Check if task was extracted
SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5;
```

### 7. View Dashboard

Navigate to: http://localhost:3000/whatsapp-dashboard

You should see:
- 1 user listed (phone number 1234567890)
- Click on the user to see conversation details
- Tasks section should show the extracted task

### 8. Set Up WhatsApp Business API

1. Go to https://business.facebook.com
2. Navigate to your Meta Business Account (or create one)
3. In left sidebar, click "WhatsApp" → "Getting Started"
4. Follow the wizard to:
   - Create a WhatsApp Business App
   - Add a phone number
   - Get API credentials

5. Get your credentials:
   - **Access Token**: WhatsApp → API Setup → Temporary access token
   - **Phone Number ID**: WhatsApp → API Setup → Phone number ID
   - **Business Account ID**: Settings → Business settings → WhatsApp Business Accounts

6. Add to `.env.local`:
```bash
WHATSAPP_ACCESS_TOKEN=your-access-token-here
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id-here
WHATSAPP_BUSINESS_ACCOUNT_ID=your-business-account-id-here
```

7. Restart Next.js server:
```bash
# Stop server (Ctrl+C)
npm run dev
```

### 9. Configure Webhook in Meta

1. In Meta Business Manager:
   - Go to WhatsApp → Configuration
   - Click "Edit" next to Webhook
   - Callback URL: `https://your-ngrok-url.ngrok.io/api/whatsapp-webhook`
   - Verify Token: (paste your WHATSAPP_VERIFY_TOKEN)
   - Click "Verify and Save"

2. Subscribe to webhook fields:
   - Check "messages"
   - Click "Subscribe"

### 10. Send Real WhatsApp Message

1. From your phone, send a WhatsApp message to your test number
2. Example: "Remind me to buy groceries tomorrow at 5pm"

3. Check terminal logs:
   - Should see message processing
   - Should see Laya's response
   - Should see "✅ Message sent" (not [STUB])

4. Check your phone - you should receive Laya's response!

5. Check dashboard: http://localhost:3000/whatsapp-dashboard
   - Your phone number should appear
   - Click to see conversation, tasks, etc.

### 11. Test Audio Message

1. From your phone, send a voice note to the WhatsApp Business number
2. Say: "Buy eggs and milk this evening"

3. Check terminal:
   - "🎤 Transcribing audio message..."
   - "📝 Transcription: ..."
   - "🧠 Processing with Laya..."
   - "✅ Message processed successfully"

4. You should receive a text reply with the task confirmation

### 12. Test Multiple Message Types

Test these scenarios:

- **Simple task**: "Call mom at 3pm"
- **Grocery list**: "Get eggs, milk, and bread"
- **Emotional message**: "I'm feeling overwhelmed today"
- **Question**: "What's on my to-do list?"
- **Multiple tasks**: "Remind me to pay bills and book doctor appointment"

## Troubleshooting

### Webhook Not Receiving Messages

```bash
# Check ngrok is running
ngrok http 3000

# Check webhook is configured in Meta
# Go to WhatsApp → Configuration → Webhook

# Check dev server logs
# Should see "📥 WhatsApp Webhook:" when message arrives
```

### "No authenticated user" Error

```bash
# Check database function exists
SELECT routine_name FROM information_schema.routines 
WHERE routine_name = 'get_or_create_user_by_phone';

# If not, re-run the migration
```

### Audio Transcription Failing

```bash
# Check OpenAI API key is set
echo $OPENAI_API_KEY

# Check Whisper model access
# Whisper is included in standard OpenAI API

# Check audio file download
# Terminal should show: "🎤 Transcribing audio message..."
```

### Laya Not Responding Appropriately

The Laya system prompt is in `src/lib/laya-brain.ts`. You can:
- Adjust the tone/style
- Add more examples
- Modify task extraction rules
- Change response length

### Rate Limiting / Token Quota

```sql
-- Check token usage
SELECT * FROM user_token_usage;

-- Check usage logs
SELECT * FROM gpt_usage_logs ORDER BY created_at DESC LIMIT 10;

-- Increase limit (in .env.local)
TOKEN_LIMIT_PER_USER=200000
```

## Next Steps: Production Deployment

Once local testing works:

1. Deploy to Vercel (see WHATSAPP_SETUP.md)
2. Update webhook URL in Meta to Vercel production URL
3. Get permanent WhatsApp access token
4. Set up monitoring (PostHog, Sentry, etc.)
5. Test with multiple users
6. Monitor costs (OpenAI usage dashboard)

## Success Criteria

✅ Webhook verification works
✅ Text messages processed correctly
✅ Audio messages transcribed and processed
✅ Tasks/groceries extracted accurately
✅ Laya responds with appropriate tone
✅ Database stores all data correctly
✅ Dashboard shows user data
✅ WhatsApp delivers responses successfully

## Cost Estimation

For 100 messages/day:
- GPT-4o-mini: ~$0.50-1.00/day
- Whisper (audio): ~$0.30/minute
- Total: ~$20-30/month for active testing

For production (1000 users, 10 messages/day):
- ~$150-300/month depending on audio usage

