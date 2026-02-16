# WhatsApp Session-Aware Message Routing

## Overview

Implements intelligent message routing based on WhatsApp's 24-hour session window policy.

## 24-Hour Session Window Rule

WhatsApp Business API enforces a strict messaging window:

- **Within 24 hours** of user's last message → Free-form messages allowed
- **Outside 24 hours** → Only pre-approved template messages allowed

## Implementation

### New Function: `sendWhatsAppMessageWithFallback()`

**File:** `src/lib/whatsapp-client.ts`

**Purpose:** Automatically route messages to free-form or template based on session window.

```typescript
await sendWhatsAppMessageWithFallback({
  phoneNumber: "919876543210",
  userId: "user-uuid",
  message: "Your task reminder: Buy milk",
  templateId: "reminder_template_id",
  templateParams: ["Buy milk", "Today at 5pm"]
});
```

### Decision Flow

```
┌─────────────────────────────────┐
│ sendWhatsAppMessageWithFallback │
└─────────────┬───────────────────┘
              │
              ▼
     ┌────────────────┐
     │ Check opt-out? │
     └────┬───────────┘
          │
     ┌────┴────┐
     │ opted_out = true?
     │         │
     │   Yes   │   No
     ▼         ▼
   BLOCKED   Continue
              │
              ▼
     ┌────────────────────┐
     │ Check 24h window   │
     └────┬───────────────┘
          │
     ┌────┴──────────────────────┐
     │ Last inbound < 24h ago?   │
     │                           │
   Yes │                         │ No
     ▼                           ▼
┌─────────────────┐    ┌──────────────────┐
│ sendWhatsApp    │    │ sendGupshup      │
│ Message()       │    │ Template()       │
│ (free-form)     │    │ (template)       │
└─────────────────┘    └──────────────────┘
     │                           │
     └────────────┬──────────────┘
                  ▼
           Return message ID
```

## Logging

### Within 24-hour window:
```
✅ Within 24h window → sending free-form message
```

### Outside 24-hour window:
```
⏰ Outside 24h window → sending template message
```

### User opted out:
```
🚫 User 919876543210 has opted out, message blocked
```

### Missing template (outside window):
```
❌ Outside 24h window but no template provided
```

## Usage Guidelines

### 1. User-Initiated Replies (Use existing function)

For responses to user messages (always within 24h):

```typescript
// Direct free-form send - no routing needed
await sendWhatsAppMessage(
  phoneNumber,
  "Task created: Buy milk"
);
```

**Rationale:** User just sent a message, so we're guaranteed to be within the 24h window.

### 2. Proactive/Scheduled Messages (Use router)

For reminders, digests, or any message NOT triggered by user input:

```typescript
// Use router to respect 24h window
await sendWhatsAppMessageWithFallback({
  phoneNumber: whatsappUser.phone_number,
  userId: whatsappUser.id,
  message: "⏰ Reminder: Buy milk (due today at 5pm)",
  templateId: "task_reminder",
  templateParams: ["Buy milk", "today at 5pm"]
});
```

**Rationale:** User may not have messaged recently, so we need to fall back to templates.

### 3. Daily Digest (Use router)

```typescript
await sendWhatsAppMessageWithFallback({
  phoneNumber: user.phone_number,
  userId: user.id,
  message: `Good morning! You have ${taskCount} tasks due today:\n\n${taskList}`,
  templateId: "daily_digest",
  templateParams: [taskCount.toString(), taskList]
});
```

## Template Requirements

For the router to work outside 24h window, you must:

1. **Create templates in Gupshup dashboard**
   - Go to Gupshup → Templates
   - Create template with placeholders
   - Wait for WhatsApp approval (1-2 business days)

2. **Pass template ID and params**
   ```typescript
   templateId: "task_reminder",        // From Gupshup dashboard
   templateParams: ["Task title", "due time"]  // Must match template placeholders
   ```

3. **Fallback behavior if no template:**
   - Logs error: `❌ Outside 24h window but no template provided`
   - Returns `null`
   - Message is NOT sent

## Session Window Check

**Function:** `canSendFreeformMessage(userId)`

**Logic:**
1. Query `messages` table for last inbound message from user
2. Calculate hours since last message
3. Return `true` if < 24 hours, `false` otherwise

**Database Query:**
```sql
SELECT created_at
FROM messages
WHERE user_id = :userId
  AND direction = 'inbound'
ORDER BY created_at DESC
LIMIT 1;
```

## Opt-Out Integration

The router respects user opt-out preferences:

- Checks `whatsapp_users.opted_out` before routing
- Blocks ALL messages (free-form AND template) if `opted_out = true`
- Exception: STOP/START confirmation messages (sent directly, bypass router)

## Testing

### Test Within 24h Window

```typescript
// 1. User sends a message (simulated or real)
// 2. Immediately call router
await sendWhatsAppMessageWithFallback({
  phoneNumber: "919876543210",
  userId: "test-user-id",
  message: "Test free-form message",
  templateId: "test_template",
  templateParams: []
});

// Expected log: ✅ Within 24h window → sending free-form message
```

### Test Outside 24h Window

```typescript
// 1. Wait 25+ hours after last user message
// 2. Call router with template
await sendWhatsAppMessageWithFallback({
  phoneNumber: "919876543210",
  userId: "test-user-id",
  message: "Test message",
  templateId: "test_template",
  templateParams: ["param1", "param2"]
});

// Expected log: ⏰ Outside 24h window → sending template message
```

### Test Opted-Out User

```sql
-- Set user as opted out
UPDATE whatsapp_users
SET opted_out = true
WHERE phone_number = '919876543210';
```

```typescript
await sendWhatsAppMessageWithFallback({
  phoneNumber: "919876543210",
  userId: "test-user-id",
  message: "Test message",
});

// Expected log: 🚫 User 919876543210 has opted out, message blocked
// Expected return: null
```

## Migration Path

### Current Code (Direct Sends)

```typescript
// Old: Always free-form, no window check
await sendWhatsAppMessage(phoneNumber, message);
```

### Updated Code (Session-Aware)

```typescript
// New: Automatic routing based on window
await sendWhatsAppMessageWithFallback({
  phoneNumber,
  userId,
  message,
  templateId: "fallback_template",
  templateParams: []
});
```

## Environment Variables

No new environment variables required. Uses existing:

- `GUPSHUP_API_KEY`
- `GUPSHUP_SOURCE_NUMBER`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Notes

- **Direct sends still work:** `sendWhatsAppMessage()` and `sendGupshupTemplate()` can still be called directly if routing logic is not needed
- **No mixing:** Router never sends both free-form AND template for the same message
- **Fail-open on error:** If session window check fails, assumes within window (sends free-form)
- **Template creation is async:** Allow 1-2 business days for WhatsApp to approve templates
