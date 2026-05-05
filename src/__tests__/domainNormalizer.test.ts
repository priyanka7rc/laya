/**
 * Tests for domain normalization pre-pass.
 *
 * Run: npx tsx src/__tests__/domainNormalizer.test.ts
 *
 * Covers:
 *   1. Temporal shorthand expansion (tmrw, tmr, wknd, morn, eve, evng)
 *   2. Politeness shorthand (pls, plz)
 *   3. Household domain aliases (groc, grocs, eb, ptm, appt, doc, schl)
 *   4. Task shorthand (w/, rc, cb)
 *   5. Mixed-case shorthand (case-insensitive matching)
 *   6. Multi-expansion in one string
 *   7. Basic cleanup (smart quotes, em-dash, repeated spaces, line breaks)
 *   8. No-change path: plain text → changed: false, expansionsApplied: []
 *   9. Word-boundary safety: no expansion inside longer words
 *  10. originalText always preserved
 */

import {
  normalizeDomainText,
  getDomainNormalizationMapSnapshot,
} from '@/lib/domainNormalizer';
import {
  validateNormalizationMap,
  NormalizationMapValidationError,
  buildExpansionRulesFromMap,
  DOMAIN_NORMALIZATION_MAP,
  type DomainNormalizationMap,
} from '@/lib/domainNormalizationMap';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function runTests(): void {
  // ── 1. Temporal shorthand ──────────────────────────────────────────────────

  console.log('1a. tmrw → tomorrow');
  {
    const r = normalizeDomainText('call dentist tmrw');
    assert(r.normalizedText === 'call dentist tomorrow', `got "${r.normalizedText}"`);
    assert(r.meta.changed, 'changed flag');
    assert(r.meta.expansionsApplied.some((e) => e.includes('tmrw')), 'expansion listed');
  }

  console.log('1b. tmr → tomorrow');
  {
    const r = normalizeDomainText('pay rent tmr');
    assert(r.normalizedText === 'pay rent tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('1c. tomoro → tomorrow');
  {
    const r = normalizeDomainText('do it tomoro');
    assert(r.normalizedText === 'do it tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('1d. wknd → weekend');
  {
    const r = normalizeDomainText('clean house wknd');
    assert(r.normalizedText === 'clean house weekend', `got "${r.normalizedText}"`);
  }

  console.log('1e. morn → morning');
  {
    const r = normalizeDomainText('call bank morn');
    assert(r.normalizedText === 'call bank morning', `got "${r.normalizedText}"`);
  }

  console.log('1f. evng → evening');
  {
    const r = normalizeDomainText('dinner evng');
    assert(r.normalizedText === 'dinner evening', `got "${r.normalizedText}"`);
  }

  console.log('1g. nxt → next');
  {
    const r = normalizeDomainText('meeting nxt monday');
    assert(r.normalizedText === 'meeting next monday', `got "${r.normalizedText}"`);
  }

  // ── 2. Politeness shorthand ────────────────────────────────────────────────

  console.log('2a. pls → please');
  {
    const r = normalizeDomainText('pls buy milk');
    assert(r.normalizedText === 'please buy milk', `got "${r.normalizedText}"`);
  }

  console.log('2b. plz → please');
  {
    const r = normalizeDomainText('plz remind me');
    assert(r.normalizedText === 'please remind me', `got "${r.normalizedText}"`);
  }

  // ── 3. Household domain ────────────────────────────────────────────────────

  console.log('3a. groc → groceries');
  {
    const r = normalizeDomainText('pick up groc today');
    assert(r.normalizedText === 'pick up groceries today', `got "${r.normalizedText}"`);
  }

  console.log('3b. grocs → groceries');
  {
    const r = normalizeDomainText('add to grocs');
    assert(r.normalizedText === 'add to groceries', `got "${r.normalizedText}"`);
  }

  console.log('3c. eb → electricity bill');
  {
    const r = normalizeDomainText('pay eb tmrw');
    assert(r.normalizedText === 'pay electricity bill tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('3d. ptm → parent teacher meeting');
  {
    const r = normalizeDomainText('ptm on friday');
    assert(r.normalizedText === 'parent teacher meeting on friday', `got "${r.normalizedText}"`);
  }

  console.log('3e. appt → appointment');
  {
    const r = normalizeDomainText('dentist appt tomorrow');
    assert(r.normalizedText === 'dentist appointment tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('3f. doc → doctor');
  {
    const r = normalizeDomainText('see doc today');
    assert(r.normalizedText === 'see doctor today', `got "${r.normalizedText}"`);
  }

  console.log('3g. schl → school');
  {
    const r = normalizeDomainText('drop kids schl');
    assert(r.normalizedText === 'drop kids school', `got "${r.normalizedText}"`);
  }

  // ── 4. Task shorthand ──────────────────────────────────────────────────────

  console.log('4a. rc → return call');
  {
    const r = normalizeDomainText('rc plumber');
    assert(r.normalizedText === 'return call plumber', `got "${r.normalizedText}"`);
  }

  console.log('4b. cb → call back');
  {
    const r = normalizeDomainText('cb the school tmrw');
    assert(r.normalizedText === 'call back the school tomorrow', `got "${r.normalizedText}"`);
  }

  // ── 5. Mixed-case shorthand ────────────────────────────────────────────────

  console.log('5a. TMR (uppercase) → tomorrow');
  {
    const r = normalizeDomainText('book flight TMR');
    assert(r.normalizedText === 'book flight tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('5b. PLZ (uppercase) → please');
  {
    const r = normalizeDomainText('PLZ send report');
    assert(r.normalizedText === 'please send report', `got "${r.normalizedText}"`);
  }

  console.log('5c. GROC (uppercase) → groceries');
  {
    const r = normalizeDomainText('buy GROC today');
    assert(r.normalizedText === 'buy groceries today', `got "${r.normalizedText}"`);
  }

  // ── 6. Multi-expansion in one string ──────────────────────────────────────

  console.log('6. Multiple expansions in one string');
  {
    const r = normalizeDomainText('pls pay eb tmrw');
    assert(r.normalizedText === 'please pay electricity bill tomorrow', `got "${r.normalizedText}"`);
    assert(r.meta.expansionsApplied.length >= 2, `expected >=2 expansions, got ${r.meta.expansionsApplied.length}`);
  }

  // ── 7. Basic cleanup ──────────────────────────────────────────────────────

  console.log('7a. Smart quotes → straight quotes');
  {
    const r = normalizeDomainText('\u2018call mom\u2019');
    assert(r.normalizedText === "'call mom'", `got "${r.normalizedText}"`);
  }

  console.log('7b. Em-dash → hyphen-space');
  {
    const r = normalizeDomainText('meeting\u2014tomorrow');
    assert(r.normalizedText === 'meeting - tomorrow', `got "${r.normalizedText}"`);
  }

  console.log('7c. Repeated spaces collapsed');
  {
    const r = normalizeDomainText('call  the   bank');
    assert(r.normalizedText === 'call the bank', `got "${r.normalizedText}"`);
  }

  console.log('7d. Line break → space');
  {
    const r = normalizeDomainText('buy milk\ncall dentist');
    assert(r.normalizedText === 'buy milk call dentist', `got "${r.normalizedText}"`);
  }

  console.log('7e. Non-breaking space → regular space');
  {
    const r = normalizeDomainText('buy\u00A0milk');
    assert(r.normalizedText === 'buy milk', `got "${r.normalizedText}"`);
  }

  // ── 8. No-change path ─────────────────────────────────────────────────────

  console.log('8a. Plain text with no expansion → changed: false');
  {
    const r = normalizeDomainText('buy milk today');
    assert(r.normalizedText === 'buy milk today', `got "${r.normalizedText}"`);
    assert(!r.meta.changed, 'should not be marked changed');
    assert(r.meta.expansionsApplied.length === 0, 'no expansions should be listed');
  }

  console.log('8b. originalText is always preserved');
  {
    const input = 'pls buy groc tmrw';
    const r = normalizeDomainText(input);
    assert(r.originalText === input, 'originalText must equal raw input');
    assert(r.normalizedText !== r.originalText, 'normalizedText should differ');
  }

  // ── 9. Word-boundary safety ────────────────────────────────────────────────

  console.log('9a. "tmrw" inside "tomorrow" not double-expanded');
  {
    // Already expanded "tomorrow" should not be re-expanded
    const r = normalizeDomainText('meeting tomorrow morning');
    assert(r.normalizedText === 'meeting tomorrow morning', `got "${r.normalizedText}"`);
  }

  console.log('9b. "groc" should not expand inside "groceries"');
  {
    // "groceries" contains "grocer" not "groc" at a word boundary
    const r = normalizeDomainText('pick up groceries');
    assert(r.normalizedText === 'pick up groceries', `got "${r.normalizedText}"`);
  }

  console.log('9c. "doc" should not expand inside "document"');
  {
    const r = normalizeDomainText('send the document');
    assert(r.normalizedText === 'send the document', `got "${r.normalizedText}"`);
  }

  console.log('9d. "cb" at word boundary — not expanded inside "cab" or "callback"');
  {
    const r = normalizeDomainText('take a cab home');
    // "cab" starts with "ca" not "cb" — should not trigger cb→call back
    assert(r.normalizedText === 'take a cab home', `got "${r.normalizedText}"`);
  }

  console.log('9e. "eb" inside "web" should not expand');
  {
    const r = normalizeDomainText('check the web today');
    assert(!r.normalizedText.includes('electricity bill'), `should not expand "web": got "${r.normalizedText}"`);
  }

  // ── 10. originalText always preserved (even with cleanup changes) ──────────

  console.log('10. originalText preserved with smart quotes');
  {
    const input = '\u201CHello world\u201D';
    const r = normalizeDomainText(input);
    assert(r.originalText === input, 'originalText must match raw input including curly quotes');
    assert(r.normalizedText === '"Hello world"', `got "${r.normalizedText}"`);
  }

  // ── 11. Curated map structure & validation ─────────────────────────────────

  console.log('11a. Production map passes validateNormalizationMap');
  {
    validateNormalizationMap(DOMAIN_NORMALIZATION_MAP);
  }

  console.log('11b. Duplicate variant with conflicting canonicals throws');
  {
    const badMap: DomainNormalizationMap = {
      timeDate: { simple: [] },
      politeness: { simple: [] },
      householdAdmin: { simple: [] },
      schoolKids: { simple: [] },
      groceryList: {
        simple: [
          { variants: ['dupalias'], canonical: 'first meaning' },
          { variants: ['dupalias'], canonical: 'second meaning' },
        ],
      },
      productivity: { simple: [] },
    };
    let threw = false;
    try {
      validateNormalizationMap(badMap);
    } catch (e) {
      threw = e instanceof NormalizationMapValidationError;
    }
    assert(threw, 'expected NormalizationMapValidationError for conflicting duplicate');
  }

  console.log('11c. getDomainNormalizationMapSnapshot is the live curated map');
  {
    const snap = getDomainNormalizationMapSnapshot();
    assert(snap === DOMAIN_NORMALIZATION_MAP, 'snapshot should be same reference as DOMAIN_NORMALIZATION_MAP');
  }

  // ── 12. Data-driven rules from a synthetic map ───────────────────────────

  console.log('12. Custom map rules expand via normalizeDomainText override');
  {
    const synthetic: DomainNormalizationMap = {
      timeDate: { simple: [{ variants: ['zzaudit'], canonical: 'audit token expanded' }] },
      politeness: { simple: [] },
      householdAdmin: { simple: [] },
      schoolKids: { simple: [] },
      groceryList: { simple: [] },
      productivity: { simple: [] },
    };
    validateNormalizationMap(synthetic);
    const customRules = buildExpansionRulesFromMap(synthetic);
    const r = normalizeDomainText('please zzaudit today', customRules);
    assert(
      r.normalizedText.includes('audit token expanded'),
      `expected synthetic expansion, got "${r.normalizedText}"`
    );
    assert(r.meta.expansionsApplied.some((l) => l.includes('zzaudit')), 'label logged');
  }

  console.log('\nAll domainNormalizer tests passed.');
}

runTests();
