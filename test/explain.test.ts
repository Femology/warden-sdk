import { describe, expect, it } from 'vitest';
import { buildExplainPrompt, fallbackExplanation, validateExplanationResponse } from '../src/explain.js';
import type { ExplanationInput } from '../src/explain.js';

const STEPUP_INPUT: ExplanationInput = {
  eventType: 'stepup_required',
  reason: 'AmountExceeded',
  amount: '200.00',
};

const STATE_INPUT: ExplanationInput = {
  eventType: 'state_transition',
  previousState: 'Restricted',
  newState: 'Normal',
};

const VALID_RESPONSE = {
  summary: 'This transfer is larger than your no-confirmation limit.',
  factors: ['The amount is above your configured threshold.'],
  next_steps: ['Confirm the transfer if you recognize it.'],
};

describe('buildExplainPrompt', () => {
  it('sends only the structured input as the user message, nothing else', () => {
    const { user } = buildExplainPrompt(STEPUP_INPUT);
    expect(JSON.parse(user)).toEqual(STEPUP_INPUT);
  });

  it('the system prompt names the exact required schema', () => {
    const { system } = buildExplainPrompt(STEPUP_INPUT);
    expect(system).toContain('"summary"');
    expect(system).toContain('"factors"');
    expect(system).toContain('"next_steps"');
  });
});

describe('validateExplanationResponse', () => {
  it('accepts a well-formed response', () => {
    const result = validateExplanationResponse(VALID_RESPONSE, STEPUP_INPUT);
    expect(result).toEqual({
      summary: VALID_RESPONSE.summary,
      factors: VALID_RESPONSE.factors,
      nextSteps: VALID_RESPONSE.next_steps,
    });
  });

  // Explicitly required by the spec: "Test explicitly: feed it a
  // fabricated/malformed model response and confirm the UI falls back
  // correctly rather than rendering it."
  it.each([
    ['not an object at all', 'just a plain string'],
    ['null', null],
    ['an array instead of an object', ['summary', 'factors', 'next_steps']],
    ['missing next_steps entirely', { summary: 'ok', factors: ['a'] }],
    ['an extra, unexpected key', { ...VALID_RESPONSE, confidence: 0.9 }],
    ['summary is not a string', { ...VALID_RESPONSE, summary: 42 }],
    ['summary is an empty string', { ...VALID_RESPONSE, summary: '   ' }],
    ['factors is a string instead of an array', { ...VALID_RESPONSE, factors: 'one factor' }],
    ['factors is an empty array', { ...VALID_RESPONSE, factors: [] }],
    ['factors contains a non-string element', { ...VALID_RESPONSE, factors: [42] }],
    ['next_steps contains only whitespace', { ...VALID_RESPONSE, next_steps: ['   '] }],
  ])('rejects a malformed response: %s', (_label, malformed) => {
    expect(validateExplanationResponse(malformed, STEPUP_INPUT)).toBeNull();
  });

  // Explicitly required by the spec: "A response referencing a reason code
  // not present in the input is discarded, not rendered."
  it('rejects a response that mentions a different reason code than the one in the input', () => {
    const hallucinated = {
      summary: 'This is flagged because the recipient was reported as a scam address.',
      factors: ['FlaggedRecipient triggered this step-up.'],
      next_steps: ['Do not proceed.'],
    };

    // The input's actual reason is AmountExceeded -- the model invented
    // FlaggedRecipient, a real StepUpReason value, but not the one it was
    // told about.
    expect(validateExplanationResponse(hallucinated, STEPUP_INPUT)).toBeNull();
  });

  it('rejects a response mentioning an ungrounded reason code even in prose form ("Flagged Recipient")', () => {
    const hallucinated = {
      summary: 'This looks like a Flagged Recipient case.',
      factors: ['Some other reason.'],
      next_steps: ['Confirm carefully.'],
    };

    expect(validateExplanationResponse(hallucinated, STEPUP_INPUT)).toBeNull();
  });

  it('accepts a response that correctly mentions the actual reason code from the input', () => {
    const grounded = {
      summary: 'AmountExceeded triggered this step-up.',
      factors: ['The amount is above your limit.'],
      next_steps: ['Confirm if expected.'],
    };

    expect(validateExplanationResponse(grounded, STEPUP_INPUT)).not.toBeNull();
  });

  it('does not apply the reason-code check to state_transition inputs (no reason-code concept there)', () => {
    // AccountState words like "Normal" are ordinary English and would
    // false-positive if checked the same way -- this input has no
    // StepUpReason field at all, so the check is skipped entirely.
    const response = {
      summary: 'Your account is back to normal after guardian recovery.',
      factors: ['Guardians approved and the timelock elapsed.'],
      next_steps: ['No action needed.'],
    };

    expect(validateExplanationResponse(response, STATE_INPUT)).not.toBeNull();
  });
});

describe('fallbackExplanation', () => {
  it('returns a distinct, grounded explanation for every StepUpReason', () => {
    const reasons: ExplanationInput[] = [
      { eventType: 'stepup_required', reason: 'AmountExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'NewRecipient', amount: '1' },
      { eventType: 'stepup_required', reason: 'VelocityExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'HourlyVelocityExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'FlaggedRecipient', amount: '1' },
    ];

    const summaries = reasons.map((input) => fallbackExplanation(input).summary);
    expect(new Set(summaries).size).toBe(reasons.length);

    for (const input of reasons) {
      const explanation = fallbackExplanation(input);
      expect(explanation.summary.length).toBeGreaterThan(0);
      expect(explanation.factors.length).toBeGreaterThan(0);
      expect(explanation.nextSteps.length).toBeGreaterThan(0);
    }
  });

  it('every fallback explanation itself passes validateExplanationResponse', () => {
    // Guards against ever hand-writing a fallback that would fail its own
    // schema check -- the fallback is the thing rendered when the model
    // fails, so it can never itself be invalid.
    const inputs: ExplanationInput[] = [
      { eventType: 'stepup_required', reason: 'AmountExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'NewRecipient', amount: '1' },
      { eventType: 'stepup_required', reason: 'VelocityExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'HourlyVelocityExceeded', amount: '1' },
      { eventType: 'stepup_required', reason: 'FlaggedRecipient', amount: '1' },
      { eventType: 'state_transition', previousState: 'Restricted', newState: 'Normal' },
      { eventType: 'state_transition', previousState: 'Frozen', newState: 'Watch' },
    ];

    for (const input of inputs) {
      const explanation = fallbackExplanation(input);
      const wireShape = { summary: explanation.summary, factors: explanation.factors, next_steps: explanation.nextSteps };
      expect(validateExplanationResponse(wireShape, input)).not.toBeNull();
    }
  });

  it('gives a distinct next-step message when recovery lands back at Normal vs. anywhere else', () => {
    const toNormal = fallbackExplanation({ eventType: 'state_transition', previousState: 'Restricted', newState: 'Normal' });
    const toWatch = fallbackExplanation({ eventType: 'state_transition', previousState: 'Restricted', newState: 'Watch' });

    expect(toNormal.nextSteps).not.toEqual(toWatch.nextSteps);
  });
});
