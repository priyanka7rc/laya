# WhatsApp Opt-Out (STOP/START) Implementation

## Summary

Added STOP/START handling to WhatsApp webhook processing for compliance and user control.

## Changes Made

### 1. Database Schema

**File:** `supabase/migrations/20260206000000_add_opted_out_to_whatsapp_users.sql`

- Added `opted_out` BOOLEAN column to `whatsapp_users` table (default: false)
- Added index for filtering opted-out users
- Migration is idempotent (safe to run multiple times)

### 2. Webhook Processing

**File:** `src/lib/whatsapp-processor.ts`

Added early detection for STOP/START commands (case-insensitive):

**STOP triggers:**
- `stop`
- `stopall`
- `unsubscribe`

**Behavior:**
- Sets `opted_out = true` in `whatsapp_users`
- Sends confirmation: *"You've been unsubscribed. You won't receive any more messages from Laya. To start again, reply START."*
- Exits processing (no task creation, no other actions)

**START trigger:**
- `start`

**Behavior:**
- Sets `opted_out = false` in `whatsapp_users`
- Sends confirmation: *"Welcome back! You're all set to use Laya again. 🌿 Send me a task and I'll help you stay on top of things."*
- Exits processing

### 3. Template Message Sending

**File:** `src/lib/whatsapp-client.ts`

Updated `sendGupshupTemplate()` to check `opted_out` flag:

- Queries `whatsapp_users` for `opted_out` status before sending
- If `opted_out = true`, logs skip and returns `null`
- Templates are only blocked; free-form replies within 24-hour session window may still respond

## Behavior Summary

| Scenario | Free-form Reply | Template Message |
|----------|-----------------|------------------|
| User sends message (within 24h) | ✅ Allowed | ✅ Sent |
| User has opted out (STOP) | ⚠️ Still allowed (user-initiated) | ❌ Blocked |
| User has opted in (START) | ✅ Allowed | ✅ Sent |

## Rationale

- **Free-form replies allowed even after opt-out:** WhatsApp's 24-hour session window allows responses to user-initiated messages. If a user sends "STOP" but then sends another message, we can still reply (they initiated contact).
- **Templates blocked after opt-out:** Proactive/scheduled messages (reminders, digests) respect opt-out.
- **Simple binary flag:** No complex preference management (as requested).

## Testing

### Manual Test Plan

1. **Test STOP command:**
   ```
   User: "STOP"
   Expected: Confirmation message, opted_out = true in DB
   ```

2. **Test START command:**
   ```
   User: "START"
   Expected: Confirmation message, opted_out = false in DB
   ```

3. **Test case insensitivity:**
   ```
   User: "Stop" or "STOP" or "stop"
   Expected: All work identically
   ```

4. **Test template blocking:**
   ```
   - User sends STOP
   - Attempt to send template message
   Expected: Template send returns null, no message sent
   ```

5. **Test free-form replies still work:**
   ```
   - User sends STOP
   - User sends "Add milk to tasks"
   Expected: Task created, confirmation sent (within 24h window)
   ```

### Database Verification

```sql
-- Check opt-out status
SELECT phone_number, opted_out, created_at, last_active
FROM whatsapp_users
ORDER BY last_active DESC;

-- Count opted-out users
SELECT COUNT(*) FROM whatsapp_users WHERE opted_out = true;
```

## Migration Instructions

1. **Apply migration:**
   ```bash
   supabase db push
   ```

2. **Verify column exists:**
   ```sql
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'whatsapp_users' AND column_name = 'opted_out';
   ```

3. **Deploy code changes:**
   - `src/lib/whatsapp-processor.ts`
   - `src/lib/whatsapp-client.ts`

## Notes

- STOP/START confirmation messages are sent even after opt-out (required for user feedback)
- No changes to free-form message sending logic (`sendWhatsAppMessage()`) — it doesn't check opt-out
- Template sending (`sendGupshupTemplate()`) checks opt-out before sending
- Opted-out users remain in `whatsapp_users` table with flag set to `true`
