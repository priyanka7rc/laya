# 🚀 Pre-Deployment Checklist

**Last Review:** December 22, 2025  
**Next Review:** Before production launch

---

## 📝 **OVERVIEW**

This checklist ensures:
- ✅ Code quality & security
- ✅ App store compliance
- ✅ User data protection
- ✅ Production readiness

**Required before:**
- Public beta testing
- App store submission
- Production deployment

---

## 🔐 **1. SECURITY AUDIT**

### **Environment Variables**
- [ ] All secrets in `.env.local` (web) / `.env` (mobile)
- [ ] `.env` files are gitignored
- [ ] No hardcoded API keys in codebase
- [ ] Service role key NEVER exposed client-side
- [ ] Anon key is safe (protected by RLS policies)

**Verify:**
```bash
# Should return NOTHING
grep -r "sk-proj-" . --exclude-dir=node_modules
grep -r "service_role" . --exclude-dir=node_modules --exclude="*.md"
```

### **Database Security**
- [ ] RLS (Row Level Security) enabled on all tables
- [ ] RLS policies tested for all user scenarios
- [ ] Service role client used ONLY server-side
- [ ] No public write access without auth

**Test:**
```sql
-- Run in Supabase SQL editor
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND rowsecurity = false;
-- Should return NOTHING
```

### **API Security**
- [ ] Rate limiting on all API routes
- [ ] Token usage limits enforced
- [ ] Authentication required for sensitive operations
- [ ] Input validation on all endpoints
- [ ] Error messages don't leak sensitive info

---

## 📱 **2. APP STORE COMPLIANCE**

### **Apple App Store**
- [ ] Privacy Policy created and hosted (`/privacy-policy`)
- [ ] Terms of Service created and hosted (`/terms`)
- [ ] Account deletion flow implemented
- [ ] Data export option (GDPR compliance)
- [ ] Privacy Nutrition Label filled out
- [ ] Sign in with Apple (if using social auth)
- [ ] Content rating: 4+ (or appropriate)
- [ ] App icon: 1024x1024px, no transparency
- [ ] Screenshots: All required device sizes
- [ ] No placeholder content or "Lorem ipsum"

### **Google Play Store**
- [ ] Privacy Policy URL provided
- [ ] Data Safety section completed
- [ ] Target API level 34+ (Android 14)
- [ ] Content rating questionnaire filled
- [ ] Feature graphic: 1024x500px
- [ ] Screenshots: Phone and tablet
- [ ] No misleading information

### **Both Platforms**
- [ ] App description written (max 4000 chars)
- [ ] Keywords/tags optimized
- [ ] Support email configured
- [ ] App version incremented
- [ ] Build number incremented

---

## 📄 **3. LEGAL DOCUMENTS**

### **Privacy Policy (REQUIRED)**

Must include:
- [ ] What data we collect (meals, groceries, user ID)
- [ ] How we use data (meal planning, AI generation)
- [ ] Third-party services (OpenAI, Supabase, PostHog)
- [ ] User rights (access, deletion, export)
- [ ] Data retention policy
- [ ] Contact information for privacy requests
- [ ] Last updated date

**Location:** `/privacy-policy` route  
**Template:** See `APP_STORE_COMPLIANCE.md`

### **Terms of Service (REQUIRED)**

Must include:
- [ ] Acceptable use policy
- [ ] AI-generated content disclaimer
- [ ] Liability limitations
- [ ] User responsibilities
- [ ] Account termination conditions
- [ ] Dispute resolution

**Location:** `/terms` route

### **Data Deletion Instructions (REQUIRED by Apple)**

Must include:
- [ ] In-app deletion button
- [ ] Clear confirmation dialog
- [ ] Deletion completes within 30 days
- [ ] User receives confirmation email

**Implementation:** `/api/user/delete` route

---

## 🧪 **4. TESTING**

### **Functional Testing**
- [ ] All core features work (meal plan, grocery list)
- [ ] Account creation & authentication
- [ ] Meal plan generation (AI)
- [ ] Grocery list regeneration
- [ ] Add/edit/delete meals
- [ ] Skip meals functionality
- [ ] Clear meal plan
- [ ] User settings

### **Cross-Platform Testing**
- [ ] iOS (iPhone, iPad)
- [ ] Android (phone, tablet)
- [ ] Web (desktop, mobile browsers)
- [ ] Different screen sizes
- [ ] Dark mode (if supported)

### **Edge Cases**
- [ ] Poor/no internet connection
- [ ] API rate limit hit
- [ ] Token limit exceeded
- [ ] Empty states (no data)
- [ ] Very long meal names
- [ ] Special characters in input

### **Performance Testing**
- [ ] App loads in < 3 seconds
- [ ] API responses < 2 seconds (except AI)
- [ ] No memory leaks
- [ ] Smooth scrolling (60fps)
- [ ] Low-end device performance

### **Security Testing**
- [ ] Cannot access other users' data
- [ ] Cannot bypass rate limits
- [ ] Cannot inject SQL
- [ ] Cannot XSS attack
- [ ] HTTPS enforced in production

---

## 🏗️ **5. BUILD & DEPLOYMENT**

### **Web App (Next.js)**
- [ ] `npm run build` succeeds
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Bundle size optimized (check Next.js output)
- [ ] Environment variables configured in Vercel/hosting
- [ ] Domain configured (if custom)
- [ ] SSL certificate valid
- [ ] Redirects configured (HTTP → HTTPS)

**Deploy:**
```bash
npm run build
# Check for errors, then deploy to Vercel/hosting
```

### **Mobile App (Expo)**

**Development Build:**
```bash
eas build --profile development --platform ios
eas build --profile development --platform android
```

**Production Build:**
```bash
# Set secrets first!
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "..."

# Build
eas build --profile production --platform ios
eas build --profile production --platform android
```

- [ ] EAS secrets configured (never use .env for prod builds)
- [ ] Build succeeds without errors
- [ ] App runs on physical device
- [ ] No dev dependencies in production bundle
- [ ] Code signing configured (iOS)
- [ ] Keystore configured (Android)

---

## 📊 **6. MONITORING & ANALYTICS**

### **Error Tracking**
- [ ] Error logging configured (Sentry, LogRocket, etc.)
- [ ] Critical errors alert team
- [ ] Error rates monitored

### **Analytics**
- [ ] PostHog configured (or alternative)
- [ ] Key events tracked:
  - [ ] Sign up / sign in
  - [ ] Meal plan generated
  - [ ] Grocery list created
  - [ ] Meal added/removed
- [ ] User retention tracked
- [ ] Feature usage tracked

### **Performance Monitoring**
- [ ] API response times tracked
- [ ] AI latency monitored
- [ ] Token usage logged
- [ ] Rate limit hits tracked

---

## 🎨 **7. ASSETS & BRANDING**

### **Icons**
- [ ] App icon (1024x1024 for iOS, 512x512 for Android)
- [ ] No transparency (iOS requirement)
- [ ] Adaptive icon (Android)
- [ ] Favicon (web)

### **Screenshots**
- [ ] iPhone 6.7" (Pro Max)
- [ ] iPhone 5.5" (Plus)
- [ ] iPad Pro 12.9"
- [ ] Android phone
- [ ] Android tablet
- [ ] Web desktop
- [ ] Web mobile

### **Marketing**
- [ ] Feature graphic (Google Play: 1024x500)
- [ ] App preview video (optional but recommended)
- [ ] Promotional text
- [ ] What's New text (for updates)

---

## 📝 **8. CONTENT**

### **In-App Content**
- [ ] No "Lorem ipsum" placeholder text
- [ ] No hardcoded test data visible to users
- [ ] All buttons have proper labels
- [ ] Error messages are user-friendly
- [ ] Loading states have feedback

### **App Store Listings**
- [ ] App name (max 30 chars)
- [ ] Subtitle (iOS, max 30 chars)
- [ ] Short description (Android, 80 chars)
- [ ] Long description (4000 chars)
- [ ] Keywords (iOS, 100 chars comma-separated)
- [ ] Categories selected
- [ ] Age rating determined

---

## 🚦 **9. PRE-SUBMISSION CHECKLIST**

### **Final Checks**
- [ ] Version number incremented in `package.json` / `app.json`
- [ ] Build number incremented
- [ ] Release notes written
- [ ] All team members reviewed
- [ ] Legal team approved (if applicable)
- [ ] Privacy policy reviewed by legal
- [ ] Terms reviewed by legal

### **Test Submission Flow**
- [ ] Create test account
- [ ] Go through entire app as new user
- [ ] Check all links work (privacy, terms, support)
- [ ] Test account deletion
- [ ] Test data export
- [ ] Check all buttons/features work

---

## ✅ **10. SUBMISSION**

### **Apple App Store**
1. **App Store Connect:**
   - [ ] App created
   - [ ] Build uploaded via Xcode or Transporter
   - [ ] Screenshots uploaded (all sizes)
   - [ ] Privacy Nutrition Label filled
   - [ ] App description added
   - [ ] Contact info added
   - [ ] Age rating set
   - [ ] Privacy policy URL added
   - [ ] Support URL added

2. **Submit for Review:**
   - [ ] Select build
   - [ ] Add release notes
   - [ ] Submit

**Review time:** 24-48 hours typically

### **Google Play Console**
1. **Production Release:**
   - [ ] Upload AAB (Android App Bundle)
   - [ ] Screenshots uploaded
   - [ ] Feature graphic uploaded
   - [ ] App description added
   - [ ] Content rating completed
   - [ ] Privacy policy URL added
   - [ ] Data safety section filled
   - [ ] Countries selected

2. **Submit for Review:**
   - [ ] Create new release
   - [ ] Add release notes
   - [ ] Submit

**Review time:** 1-7 days typically

---

## 🎯 **11. POST-LAUNCH**

### **Immediate (Day 1)**
- [ ] Monitor crash reports
- [ ] Check error logs
- [ ] Review user reviews
- [ ] Test critical flows on production
- [ ] Verify analytics working

### **First Week**
- [ ] Respond to user reviews
- [ ] Track key metrics (retention, usage)
- [ ] Monitor API costs (OpenAI, Supabase)
- [ ] Identify top user issues
- [ ] Plan first update

### **Ongoing**
- [ ] Weekly review of analytics
- [ ] Monthly review of compliance
- [ ] Quarterly security audit
- [ ] Update privacy policy if features change
- [ ] Keep dependencies updated

---

## 🚨 **COMMON REJECTION REASONS**

### **Apple:**
1. Missing privacy policy
2. No account deletion option
3. Crashes on launch
4. Placeholder content
5. Incomplete functionality
6. Misleading screenshots

### **Google:**
1. Missing privacy policy URL
2. Data safety section incomplete
3. Crashes during review
4. Violates content policies
5. Misleading information

---

## 📞 **EMERGENCY CONTACTS**

If app is rejected or critical issue found:

- **App Store Issues:** developer.apple.com/contact
- **Google Play Issues:** support.google.com/googleplay/android-developer
- **Security Issue:** Rotate keys immediately, submit urgent update
- **User Data Breach:** Follow breach notification laws (GDPR: 72 hours)

---

## ✅ **CURRENT STATUS**

**As of December 22, 2025:**

✅ **Ready for Development:**
- Security configured
- Cache management implemented
- Environment variables setup
- Mobile credentials secured

⚠️ **NOT Ready for Production:**
- Need privacy policy
- Need terms of service
- Need account deletion flow
- Need final testing

**Estimated time to production-ready:** 2-3 days focused work

---

## 📚 **RESOURCES**

- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Developer Policy](https://play.google.com/about/developer-content-policy/)
- [GDPR Compliance](https://gdpr.eu/)
- [CCPA Compliance](https://oag.ca.gov/privacy/ccpa)
- [OWASP Mobile Security](https://owasp.org/www-project-mobile-security-testing-guide/)

