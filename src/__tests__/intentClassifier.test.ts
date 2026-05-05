/**
 * Tests for the intent classifier observability layer.
 *
 * Architecture: rules always run first; LLM is only used as a gap-filler when
 * rules return 0 actions. Five scenarios are verified without real OpenAI calls:
 *   1. rules_only_mode      — USE_LLM_CLASSIFICATION=false → rules path, no LLM
 *   2. llm_missing_api_key  — rules return 0, flag on, key missing → empty result
 *   3. llm_gap_fill         — rules return 0, LLM mock returns valid JSON → llm_gap_fill
 *   4. llm_runtime_error    — rules return 0, LLM mock throws → empty result
 *   5. llm_schema_validation_failed — rules return 0, LLM mock returns bad shape
 *
 * Run with:
 *   npx tsx src/__tests__/intentClassifier.test.ts
 */

import { classifyIntent, _setOpenAIClientForTest } from '../lib/intentClassifier';
import type { ClassificationReasonCode, ClassifierMode, ClassificationSource } from '../lib/intentClassifier';
import OpenAI from 'openai';

// ============================================================
// Minimal test helpers
// ============================================================

let passed = 0;
let failed = 0;

function pass(desc: string) {
  console.log(`  ✅ ${desc}`);
  passed++;
}

function fail(desc: string, details: string) {
  console.error(`  ❌ ${desc}`);
  console.error(`     ${details}`);
  failed++;
}

function assert(condition: boolean, desc: string, details = '') {
  if (condition) pass(desc);
  else fail(desc, details || 'Assertion failed');
}

function eq<T>(a: T, b: T, desc: string) {
  if (a === b) pass(desc);
  else fail(desc, `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ============================================================
// Helpers
// ============================================================

function makeMockOpenAI(
  response: string | null | (() => never)
): OpenAI {
  const chatCreate =
    typeof response === 'function'
      ? response
      : async () => ({
          choices: response === null
            ? [{ message: { content: null } }]
            : [{ message: { content: response } }],
          usage: { total_tokens: 42 },
        });

  return {
    chat: {
      completions: {
        create: chatCreate,
      },
    },
  } as unknown as OpenAI;
}

const VALID_LLM_RESPONSE = JSON.stringify({
  actions: [
    {
      type: 'create_task',
      title: 'Book dentist appointment',
      due_date: null,
      due_time: null,
      category: null,
    },
  ],
});

const INVALID_LLM_RESPONSE = JSON.stringify({
  totally_wrong_shape: true,
});

// ============================================================
// Scenarios
// ============================================================

(async () => {
  const originalLLMFlag = process.env.USE_LLM_CLASSIFICATION;
  const originalAPIKey = process.env.OPENAI_API_KEY;

  // ── Scenario 1: rules_only_mode ──────────────────────────────────────────
  console.log('\nScenario 1: rules_only_mode (USE_LLM_CLASSIFICATION=false)');
  {
    process.env.USE_LLM_CLASSIFICATION = 'false';
    delete process.env.OPENAI_API_KEY;
    _setOpenAIClientForTest(null);

    const result = await classifyIntent('Buy milk and eggs', { channel: 'web' });
    const { meta } = result;

    eq<ClassifierMode>(meta.classifierMode, 'rules', 'classifierMode=rules');
    eq<ClassificationSource>(meta.classificationSource, 'rules', 'classificationSource=rules');
    eq<ClassificationReasonCode>(meta.reasonCode, 'rules_only_mode', 'reasonCode=rules_only_mode');
    eq(meta.fallbackUsed, false, 'fallbackUsed=false');
    eq(meta.llmEnabled, false, 'llmEnabled=false');
    eq(meta.channel, 'web', 'channel=web');
    assert(typeof meta.turnId === 'string' && meta.turnId.length > 0, 'turnId is set');
    assert(meta.timings.totalMs >= 0, 'totalMs >= 0');
    assert(meta.timings.llmMs === undefined, 'llmMs not set for rules path');
  }

  // ── Scenario 2: llm_missing_api_key ──────────────────────────────────────
  // Use input that rules return 0 actions for (no task/list pattern), so we
  // reach the LLM gate and hit the missing-key branch.
  console.log('\nScenario 2: llm_missing_api_key (flag on, key missing, rules return 0)');
  {
    process.env.USE_LLM_CLASSIFICATION = 'true';
    delete process.env.OPENAI_API_KEY;
    _setOpenAIClientForTest(null);

    const result = await classifyIntent('Not sure what my priorities are', { channel: 'whatsapp' });
    const { meta } = result;

    eq<ClassifierMode>(meta.classifierMode, 'llm_with_rules_fallback', 'classifierMode=llm_with_rules_fallback');
    eq<ClassificationSource>(meta.classificationSource, 'llm_failed_rules_used', 'classificationSource=llm_failed_rules_used');
    eq<ClassificationReasonCode>(meta.reasonCode, 'llm_missing_api_key', 'reasonCode=llm_missing_api_key');
    eq(meta.fallbackUsed, true, 'fallbackUsed=true');
    eq(meta.llmEnabled, true, 'llmEnabled=true');
    eq(meta.channel, 'whatsapp', 'channel=whatsapp');
    assert(meta.timings.rulesMs !== undefined, 'rulesMs set for fallback path');
  }

  // ── Scenario 3: llm_gap_fill ──────────────────────────────────────────────
  // Rules return 0 actions; LLM fills the gap. reasonCode is now 'llm_gap_fill'.
  console.log('\nScenario 3: llm_gap_fill (rules return 0, mock LLM returns valid JSON)');
  {
    process.env.USE_LLM_CLASSIFICATION = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    _setOpenAIClientForTest(makeMockOpenAI(VALID_LLM_RESPONSE));

    // Deliberately vague input so rules return 0 actions
    const result = await classifyIntent('Something for my schedule this weekend', {
      channel: 'web',
      turnId: 'test-turn-abc',
    });
    const { meta, actions } = result;

    eq<ClassifierMode>(meta.classifierMode, 'llm', 'classifierMode=llm');
    eq<ClassificationSource>(meta.classificationSource, 'llm', 'classificationSource=llm');
    eq<ClassificationReasonCode>(meta.reasonCode, 'llm_gap_fill', 'reasonCode=llm_gap_fill');
    eq(meta.fallbackUsed, false, 'fallbackUsed=false');
    eq(meta.turnId, 'test-turn-abc', 'turnId threaded from context');
    eq(meta.tokenCount, 42, 'tokenCount captured from usage');
    assert(meta.timings.llmMs !== undefined, 'llmMs set for LLM path');
    assert(meta.timings.rulesMs !== undefined, 'rulesMs set (rules always run first)');
    assert(actions.length === 1, 'one action returned');
    eq(actions[0].type, 'create_task', 'action type=create_task');
  }

  // ── Scenario 4: llm_runtime_error ────────────────────────────────────────
  // Rules return 0 actions; LLM is attempted but throws.
  console.log('\nScenario 4: llm_runtime_error (rules return 0, mock throws)');
  {
    process.env.USE_LLM_CLASSIFICATION = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    _setOpenAIClientForTest(makeMockOpenAI(() => {
      throw new Error('network timeout');
    }));

    // Vague input so rules return 0 actions
    const result = await classifyIntent('Not sure what I need to sort out', { channel: 'web' });
    const { meta } = result;

    eq<ClassifierMode>(meta.classifierMode, 'llm_with_rules_fallback', 'classifierMode=llm_with_rules_fallback');
    eq<ClassificationSource>(meta.classificationSource, 'llm_failed_rules_used', 'classificationSource=llm_failed_rules_used');
    eq<ClassificationReasonCode>(meta.reasonCode, 'llm_runtime_error', 'reasonCode=llm_runtime_error');
    eq(meta.fallbackUsed, true, 'fallbackUsed=true');
    assert(meta.timings.llmMs !== undefined, 'llmMs set even on failure');
    assert(meta.timings.rulesMs !== undefined, 'rulesMs set (rules always run first)');
  }

  // ── Scenario 5: llm_schema_validation_failed ─────────────────────────────
  // Rules return 0 actions; LLM returns wrong shape.
  console.log('\nScenario 5: llm_schema_validation_failed (rules return 0, mock returns wrong shape)');
  {
    process.env.USE_LLM_CLASSIFICATION = 'true';
    process.env.OPENAI_API_KEY = 'test-key';
    _setOpenAIClientForTest(makeMockOpenAI(INVALID_LLM_RESPONSE));

    // Vague input so rules return 0 actions
    const result = await classifyIntent('Maybe I should figure out my week', { channel: 'web' });
    const { meta } = result;

    eq<ClassifierMode>(meta.classifierMode, 'llm_with_rules_fallback', 'classifierMode=llm_with_rules_fallback');
    eq<ClassificationReasonCode>(meta.reasonCode, 'llm_schema_validation_failed', 'reasonCode=llm_schema_validation_failed');
    eq(meta.fallbackUsed, true, 'fallbackUsed=true');
  }

  // ── Restore environment ───────────────────────────────────────────────────
  if (originalLLMFlag !== undefined) {
    process.env.USE_LLM_CLASSIFICATION = originalLLMFlag;
  } else {
    delete process.env.USE_LLM_CLASSIFICATION;
  }
  if (originalAPIKey !== undefined) {
    process.env.OPENAI_API_KEY = originalAPIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  _setOpenAIClientForTest(null);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
