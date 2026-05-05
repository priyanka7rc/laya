/**
 * Golden fixture tests for interpretTurn().
 *
 * Runs every fixture in interpretTurn.fixtures.ts and asserts on
 * action types and execution plan step kinds. Dates are NOT asserted
 * (they are relative and would fail in CI without mocking time).
 *
 * Run with: npm test interpretTurn.fixtures
 */

import { describe, it, expect } from 'vitest';
import { interpretTurn } from '@/lib/turnInterpreter';
import { INTERPRET_FIXTURES } from './fixtures/interpretTurn.fixtures';

describe('interpretTurn golden fixtures', () => {
  for (const fixture of INTERPRET_FIXTURES) {
    it(fixture.label, async () => {
      const result = await interpretTurn(fixture.input, fixture.convState, {
        channel: fixture.channel,
      });

      const actualActionTypes = result.detectedActions.map((a) => a.type);
      const actualStepKinds = result.executionPlan.map((s) => s.kind);

      expect(actualActionTypes).toEqual(fixture.expectedActionTypes);
      expect(actualStepKinds).toEqual(fixture.expectedStepKinds);

      if (fixture.expectsClarification) {
        expect(result.needsClarification).toBe(true);
      }
    });
  }
});
