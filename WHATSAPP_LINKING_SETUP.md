# WhatsApp Linking Setup - Implementation Complete

**Date:** February 5, 2026  
**Status:** ✅ Ready for Testing

---

## Changes Implemented

### 1. Primary: WhatsApp Message with Direct URL

**File:** `src/lib/whatsapp-processor.ts`

✅ Updated the linking message sent to new/unlinked WhatsApp users to include:
- Direct URL to `/link-whatsapp` page
- User's phone number pre-filled in message
- Clear step-by-step instructions

**Message Format:**
```
👋 Welcome to Laya!

To get started, please link your account:

1. Visit: https://yourdomain.com/link-whatsapp
2. Sign in (or create an account)
3. Enter this phone number: +1234567890

Then message me again and I'll be ready to help! 🌿
```

### 2. Optional: Home Page Linking Card

**File:** `src/app/(tabs)/home/page.tsx`

✅ Added a small, non-prominent linking card that:
- Shows only if user has NOT linked WhatsApp
- Automatically hides once phone number is linked
- Appears at the top of the home page above tasks
- Simple blue accent card with clear CTA
- Clickable to navigate to `/link-whatsapp`

**Visual:**
```
┌────────────────────────────────────────────┐
│ 💬 Link WhatsApp – add tasks on the go    │
└────────────────────────────────────────────┘
```

---

## Environment Variable Required

Add this to your `.env.local` file:

```env
# App URL for WhatsApp linking
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

**For local development:**
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**For production:**
```env
NEXT_PUBLIC_APP_URL=https://app.laya.com  # Your actual domain
```

### Fallback Behavior
If `NEXT_PUBLIC_APP_URL` is not set, the system defaults to `http://localhost:3000`.

---

## Testing Checklist

### Local Testing

1. **Add env variable:**
   ```bash
   echo "NEXT_PUBLIC_APP_URL=http://localhost:3000" >> .env.local
   ```

2. **Restart dev server:**
   ```bash
   npm run dev
   ```

3. **Test home page card:**
   - Sign in to the app
   - Go to `/home`
   - You should see the blue "Link WhatsApp" card at the top
   - Click it → should navigate to `/link-whatsapp`

4. **Test linking flow:**
   - Enter phone number on `/link-whatsapp`
   - Submit
   - Return to `/home` → card should disappear

5. **Test WhatsApp message:**
   - Send a WhatsApp message from an unlinked number
   - Check that the message includes your actual domain URL
   - Verify phone number is included in the message

### Production Testing

1. **Set production URL:**
   ```env
   NEXT_PUBLIC_APP_URL=https://app.laya.com
   ```

2. **Deploy to production**

3. **Send test WhatsApp message:**
   - Use a new phone number
   - Should receive message with production URL
   - Link should be clickable on mobile WhatsApp

4. **Verify home page:**
   - Sign in on web
   - Home page should show linking card
   - After linking, card disappears

---

## User Flow

### New WhatsApp User Journey

1. **User sends first WhatsApp message** → "Hi, add milk to my tasks"

2. **Laya responds:**
   ```
   👋 Welcome to Laya!

   To get started, please link your account:

   1. Visit: https://app.laya.com/link-whatsapp
   2. Sign in (or create an account)
   3. Enter this phone number: +1234567890

   Then message me again and I'll be ready to help! 🌿
   ```

3. **User taps the link** → Opens `/link-whatsapp` in browser

4. **User signs in / creates account**

5. **User enters phone number** → Clicks "Link WhatsApp"

6. **Success message shown**

7. **User sends WhatsApp message again** → Task is created successfully

### Existing Web User Journey

1. **User signs in to web app**

2. **Home page shows blue card:** "💬 Link WhatsApp – add tasks on the go"

3. **User clicks card** → Navigates to `/link-whatsapp`

4. **User enters phone number** → Submits

5. **Card disappears from home page**

6. **User can now use WhatsApp to create tasks**

---

## Files Modified

1. **`src/lib/whatsapp-processor.ts`**
   - Updated linking message with direct URL
   - Added phone number to message
   - Reads `NEXT_PUBLIC_APP_URL` from environment

2. **`src/app/(tabs)/home/page.tsx`**
   - Added `isWhatsAppLinked` state
   - Queries `whatsapp_users` table in `fetchTodayData()`
   - Conditionally renders linking card
   - Card auto-hides once linked

---

## Architecture Notes

### Why NEXT_PUBLIC_APP_URL?

- **Client-side accessible:** Prefixed with `NEXT_PUBLIC_` so it's available in browser
- **Build-time injection:** URL is baked into the build for API routes
- **Industry standard:** Common Next.js convention for app URLs

### Why check auth_user_id in home page?

- Simple query: `SELECT auth_user_id FROM whatsapp_users WHERE auth_user_id = $1`
- Fast lookup: Uses existing unique index
- No additional table needed
- Automatically updates on link/unlink

### Why hide card after linking?

- **Progressive disclosure:** Only show when relevant
- **Reduces UI clutter:** Clean home page for linked users
- **Natural discovery:** New users see it immediately
- **Non-intrusive:** Small card, easy to dismiss mentally

---

## Deployment Checklist

- [ ] Add `NEXT_PUBLIC_APP_URL` to production environment variables
- [ ] Restart application after env change
- [ ] Test WhatsApp message includes correct URL
- [ ] Verify URL is clickable on mobile
- [ ] Confirm home page card appears for unlinked users
- [ ] Confirm card disappears after linking

---

## Rollback Plan

If issues arise:

1. **WhatsApp message broken:**
   - Set fallback in code: `const appUrl = 'https://app.laya.com';`
   - Remove env variable check temporarily

2. **Home card causes issues:**
   - Comment out the linking card block in `home/page.tsx`
   - Users can still access `/link-whatsapp` directly

---

**Status:** Implementation complete. Ready for environment variable configuration and testing.
