# 📱 App Store & Google Play Compliance Checklist

**Last Updated:** December 22, 2025  
**Project:** Laya - AI Meal Planner

---

## ✅ CURRENT COMPLIANCE STATUS

### 🔐 **Security & Privacy**

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| API keys in environment variables | ✅ | `.env.local` (gitignored) |
| No hardcoded credentials | ✅ | All secrets in env vars |
| HTTPS only (production) | ✅ | Vercel/deployment enforces |
| Secure headers | ✅ | `next.config.ts` headers |
| User data encryption | ✅ | Supabase handles at rest |
| No data sent to unauthorized servers | ✅ | Only OpenAI, Supabase |

### 📋 **Required Documentation**

| Document | Status | Location |
|----------|--------|----------|
| Privacy Policy | ⚠️ **REQUIRED** | Need to create |
| Terms of Service | ⚠️ **REQUIRED** | Need to create |
| Data Deletion Instructions | ⚠️ **REQUIRED** | Need to add to privacy policy |
| Third-party Services Disclosure | ⚠️ **REQUIRED** | OpenAI, Supabase, PostHog |

### 🔒 **Data Collection & Usage**

**What we collect:**
- ✅ User ID (for auth)
- ✅ Meal plans (stored in Supabase)
- ✅ Grocery lists (stored in Supabase)
- ✅ Usage analytics (PostHog - anonymous)

**What we DON'T collect:**
- ❌ Location data
- ❌ Contacts
- ❌ Photos/camera
- ❌ Health data (future: may need declaration)
- ❌ Payment info (not yet implemented)

### 🎯 **App Store Specific**

#### **Apple App Store Requirements:**
- [ ] Privacy Nutrition Label (declare all data collection)
- [ ] Account deletion mechanism
- [ ] Sign in with Apple (if using social auth)
- [ ] Content ratings (4+ likely)
- [ ] App icon (1024x1024px)
- [ ] Screenshots (various sizes)
- [ ] App description

#### **Google Play Store Requirements:**
- [ ] Data Safety section disclosure
- [ ] Privacy Policy URL
- [ ] Target API level 34+ (Android 14)
- [ ] Content rating questionnaire
- [ ] Feature graphic (1024x500px)
- [ ] Screenshots
- [ ] App description

---

## 🚨 **CRITICAL: Must Implement Before Launch**

### 1. **Privacy Policy** (REQUIRED)

**Must include:**
- What data we collect (user ID, meal plans, grocery lists)
- How we use it (meal planning, grocery generation)
- Third-party services:
  - OpenAI (recipe compilation)
  - Supabase (data storage)
  - PostHog (analytics)
- User rights (access, deletion, export)
- Data retention policy
- Contact information

**Action:** Create `privacy-policy.md` and host at `/privacy-policy` route

---

### 2. **Terms of Service** (REQUIRED)

**Must include:**
- Acceptable use policy
- Liability limitations
- AI-generated content disclaimer
- User responsibilities
- Account termination conditions

**Action:** Create `terms-of-service.md` and host at `/terms` route

---

### 3. **Account Deletion Flow** (REQUIRED by Apple)

**Apple requires:**
- In-app account deletion (not just email request)
- Clear instructions
- Confirmation before deletion
- Data deletion within 30 days

**Action:** Add deletion route + UI in settings

**Implementation:**
```typescript
// src/app/api/user/delete/route.ts
export async function DELETE(request: NextRequest) {
  // 1. Verify user auth
  // 2. Delete user data from Supabase
  // 3. Delete auth account
  // 4. Return confirmation
}
```

---

### 4. **Data Export (GDPR Compliance)** (NICE TO HAVE)

**Action:** Add export route

```typescript
// src/app/api/user/export/route.ts
export async function GET(request: NextRequest) {
  // Return all user data as JSON
}
```

---

## 🔒 **Security Best Practices (Already Implemented)**

### ✅ **Environment Variables**
```bash
# .env.local (gitignored)
OPENAI_API_KEY=sk-...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### ✅ **No Client-Side Secrets**
- Service role key ONLY used server-side
- API routes validate auth before operations
- RLS policies in Supabase

### ✅ **Secure Headers** (Production)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## 🎨 **Content Ratings**

### **Apple App Store:**
- **Rating:** 4+ (suitable for all ages)
- **Content:** Food/meal planning (no objectionable content)
- **No warnings needed**

### **Google Play Store:**
- **Rating:** Everyone
- **Content:** Reference/meal planning
- **No warnings needed**

---

## 📊 **Third-Party Services Disclosure**

### **Services Used:**

1. **OpenAI (AI Recipe Compilation)**
   - Purpose: Generate recipe instructions
   - Data sent: Dish names only (no personal info)
   - Privacy: https://openai.com/policies/privacy-policy

2. **Supabase (Database & Auth)**
   - Purpose: Store user data, meal plans
   - Data sent: All user-created content
   - Privacy: https://supabase.com/privacy

3. **PostHog (Analytics)**
   - Purpose: Usage analytics
   - Data sent: Anonymous usage events
   - Privacy: https://posthog.com/privacy

### **Data Flow:**
```
User → Laya App → Supabase (storage)
              → OpenAI (recipe generation)
              → PostHog (analytics)
```

---

## 🚀 **Pre-Launch Checklist**

### **Before Submitting to App Stores:**

#### **Documentation**
- [ ] Create and publish Privacy Policy
- [ ] Create and publish Terms of Service
- [ ] Add privacy policy link to app settings
- [ ] Add terms link to signup flow

#### **Features**
- [ ] Implement account deletion flow
- [ ] Add data export option (optional but recommended)
- [ ] Add "About" section with version, credits
- [ ] Add "Contact Us" email/form

#### **Testing**
- [ ] Test all features work without crashes
- [ ] Test on low-end devices
- [ ] Test offline behavior (graceful errors)
- [ ] Test account deletion flow

#### **Assets**
- [ ] App icon (1024x1024 for iOS, 512x512 for Android)
- [ ] Screenshots (iPhone, iPad, Android phone, tablet)
- [ ] Feature graphic (Google Play)
- [ ] App description (max 4000 chars)
- [ ] Keywords (Apple) / Tags (Google)

#### **Build**
- [ ] Remove console.logs (or use proper logging)
- [ ] Enable production mode
- [ ] Test production build locally
- [ ] Verify no dev dependencies in production

---

## 📝 **Recommended App Descriptions**

### **Short Description (80 chars)**
"AI-powered Indian meal planning & smart grocery lists. Plan weekly, shop smart."

### **Long Description (4000 chars max)**

**Laya - AI Meal Planner for Indian Cuisine**

Plan your weekly meals effortlessly with AI-powered recipe suggestions tailored to Indian home cooking. Generate smart grocery lists that consolidate ingredients across all your meals.

**Features:**
• AI-powered weekly meal planning
• Smart grocery list generation
• 100+ Indian recipes (continuously growing)
• Customizable meal slots (breakfast, lunch, dinner)
• Skip meals when eating out or traveling
• Ingredient normalization for accurate shopping

**Perfect for:**
• Busy families planning weekly meals
• Home cooks exploring new recipes
• Anyone who wants to reduce food waste
• People tired of "what's for dinner?" decisions

**How It Works:**
1. Generate a weekly meal plan (or fill specific days)
2. Review and customize your meals
3. Auto-generate grocery lists from your plan
4. Shop with a consolidated ingredient list

**Privacy:**
Your data stays secure. We use industry-standard encryption and never share your personal information. See our privacy policy for details.

**Powered by AI:**
Recipe suggestions generated using OpenAI technology, with human-curated Indian recipes for authentic taste.

---

## ⚠️ **Common Rejection Reasons (Avoid These)**

### **Apple:**
1. ❌ No privacy policy
2. ❌ No account deletion option
3. ❌ Hardcoded placeholder content
4. ❌ Crashes on launch
5. ❌ Missing required screenshots
6. ❌ App doesn't match description

### **Google:**
1. ❌ No privacy policy URL
2. ❌ Misleading screenshots
3. ❌ Crashes during review
4. ❌ Violates data safety disclosures
5. ❌ Missing content rating

---

## 🔄 **Ongoing Compliance**

### **When Adding Features:**
- [ ] Update privacy policy if collecting new data
- [ ] Update data safety sections in stores
- [ ] Review security implications
- [ ] Test on latest OS versions

### **Regular Maintenance:**
- [ ] Keep dependencies updated (security patches)
- [ ] Monitor for API deprecations
- [ ] Review analytics for crash reports
- [ ] Respond to user privacy requests within 30 days

---

## 📞 **Resources**

- **Apple App Store Guidelines:** https://developer.apple.com/app-store/review/guidelines/
- **Google Play Policies:** https://play.google.com/about/developer-content-policy/
- **GDPR Compliance:** https://gdpr.eu/
- **CCPA Compliance:** https://oag.ca.gov/privacy/ccpa

---

## ✅ **Current Status: PRE-MVP**

**Ready for:**
- ✅ Development testing
- ✅ Internal beta testing

**NOT ready for:**
- ❌ Public app store submission (need privacy docs)
- ❌ Production launch (need deletion flow)

**Timeline to launch-ready:**
- Privacy Policy: 2-4 hours
- Terms of Service: 2-4 hours
- Account Deletion: 4-6 hours
- Testing: 8-12 hours
- **Total: 2-3 days of focused work**

