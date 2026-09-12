import type { AccountState, StepUpReason } from './types.js';

/**
 * Structured, on-chain-only facts for one event -- the entire universe of
 * information the "Explain this" LLM call is allowed to see. Deliberately
 * excludes anything not already public in the event itself: no wallet
 * address, no other history, no free text, no ability to call back into
 * any Warden function. Two shapes, matching the two kinds of event this
 * feature covers (Phase 18's own spec: "any state transition or step-up
 * event").
 */
export type ExplanationInput =
  | {
      eventType: 'stepup_required';
      reason: StepUpReason;
      amount: string; // decimal string, already public in the stepup_required event
    }
  | {
      eventType: 'state_transition';
      previousState: AccountState;
      newState: AccountState;
    };

export interface Explanation {
  summary: string;
  factors: string[];
  nextSteps: string[];
}

export interface ExplanationResult extends Explanation {
  /** 'llm' when the model's response passed validation; 'fallback' when it
   * didn't (or the call failed) and the pre-written explanation was used
   * instead. Callers should surface this distinction in the UI, however
   * subtly -- it's the difference between "grounded" and "hardcoded". */
  source: 'llm' | 'fallback';
}

const ALL_STEP_UP_REASONS: StepUpReason[] = [
  'AmountExceeded',
  'NewRecipient',
  'VelocityExceeded',
  'HourlyVelocityExceeded',
  'FlaggedRecipient',
];

/**
 * Builds the exact system/user messages to send. The user message is
 * `JSON.stringify(input)` and nothing else -- no wallet address, no
 * conversation history, no instructions the model could reinterpret as
 * permission to do anything beyond describe these specific facts.
 */
export function buildExplainPrompt(input: ExplanationInput): { system: string; user: string } {
  const system = [
    'You explain a single Warden risk-policy event to a wallet owner, in plain, calm language.',
    'You are given ONLY the structured JSON facts in the next message. Do not invent, assume, or',
    'reference any fact, reason code, or account state that is not explicitly present in that JSON.',
    'You have no ability to change anything, approve anything, or call any function -- you only',
    'produce text for display.',
    'Respond with ONLY a JSON object matching exactly this shape, and nothing else -- no markdown,',
    'no code fences, no extra keys:',
    '{ "summary": string, "factors": string[], "next_steps": string[] }',
    '"summary" is one or two sentences summarizing what happened.',
    '"factors" lists the specific reasons this happened, each grounded in the input JSON.',
    '"next_steps" lists what the wallet owner can actually do next.',
  ].join(' ');

  return { system, user: JSON.stringify(input) };
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches a PascalCase token either as-is ("AmountExceeded") or
 * space-separated ("Amount Exceeded"), case-insensitive, at word
 * boundaries -- catches the model writing the reason code out in prose. */
function containsToken(text: string, token: string): boolean {
  const spaced = token.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const pattern = new RegExp(`\\b(${escapeRegExp(token)}|${escapeRegExp(spaced)})\\b`, 'i');
  return pattern.test(text);
}

/**
 * True if the explanation mentions a StepUpReason other than the one
 * actually in the input -- the model hallucinating a reason code it was
 * never told about. Deliberately scoped to StepUpReason only, not
 * AccountState: state names like "Normal" and "Watch" are ordinary English
 * words, and word-matching them would false-positive on completely
 * legitimate prose ("your account is back to normal"). StepUpReason values
 * (AmountExceeded, FlaggedRecipient, ...) are unambiguous enough to check
 * safely, and this is exactly the case the spec calls out by name
 * ("no ability to invent a reason code that isn't in the actual event data").
 */
function referencesUngroundedReasonCode(explanation: Explanation, input: ExplanationInput): boolean {
  if (input.eventType !== 'stepup_required') return false;

  const text = [explanation.summary, ...explanation.factors, ...explanation.nextSteps].join(' ');
  return ALL_STEP_UP_REASONS.some((reason) => reason !== input.reason && containsToken(text, reason));
}

/**
 * Validates a parsed model response against the fixed schema and against
 * the input it was given. Returns null on any deviation -- callers must
 * fall back to fallbackExplanation() rather than render a null result.
 * Deliberately strict: exactly three keys, all present, all the right
 * shape, no reason code the model wasn't told about.
 */
export function validateExplanationResponse(raw: unknown, input: ExplanationInput): Explanation | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const allowedKeys = ['summary', 'factors', 'next_steps'];
  const actualKeys = Object.keys(obj);
  if (actualKeys.length !== allowedKeys.length || !allowedKeys.every((key) => actualKeys.includes(key))) {
    return null;
  }

  const { summary, factors, next_steps: nextSteps } = obj;

  if (typeof summary !== 'string' || summary.trim().length === 0) return null;
  if (!isNonEmptyStringArray(factors)) return null;
  if (!isNonEmptyStringArray(nextSteps)) return null;

  const candidate: Explanation = { summary, factors, nextSteps };

  if (referencesUngroundedReasonCode(candidate, input)) return null;

  return candidate;
}

const STEP_UP_FALLBACKS: Record<StepUpReason, Explanation> = {
  AmountExceeded: {
    summary: 'This transfer is larger than the amount you set to go through without extra confirmation.',
    factors: ['The amount is above your configured no-confirmation limit.'],
    nextSteps: [
      'Confirm this transfer if you recognize it.',
      'Lower your no-confirmation limit in your policy if you want smaller transfers to require this too.',
    ],
  },
  NewRecipient: {
    summary: "You haven't sent to this recipient recently, so it's being treated as new.",
    factors: ["This address isn't on your trusted list, or your trust in it has decayed from disuse."],
    nextSteps: [
      'Confirm this transfer if you recognize the recipient.',
      'Add them as a trusted recipient to skip this check next time.',
    ],
  },
  VelocityExceeded: {
    summary: 'This transfer would put you over your daily spending limit.',
    factors: ['Your cumulative spending in the current 24-hour window is at or near your configured daily cap.'],
    nextSteps: [
      'Confirm this transfer if it is expected.',
      'Raise your daily limit in your policy if this happens often.',
    ],
  },
  HourlyVelocityExceeded: {
    summary: 'This transfer would put you over your hourly spending limit.',
    factors: [
      'Your cumulative spending in the last hour is at or near your configured hourly cap, even though your daily limit still has headroom.',
    ],
    nextSteps: [
      'Confirm this transfer if it is expected.',
      'Raise your hourly limit in your policy if you regularly send in bursts.',
    ],
  },
  FlaggedRecipient: {
    summary: 'This recipient has been flagged and always requires confirmation.',
    factors: [
      'The admin-managed flagged-address registry marks this address as one to always confirm, regardless of amount, trust, or velocity.',
    ],
    nextSteps: [
      'Only confirm this transfer if you are certain about this recipient.',
      'Contact support if you believe this address was flagged in error.',
    ],
  },
};

/**
 * The pre-written explanation shown when the model call fails, times out,
 * or its response doesn't pass validateExplanationResponse. Never network-
 * dependent, never references anything beyond the input itself.
 */
export function fallbackExplanation(input: ExplanationInput): Explanation {
  if (input.eventType === 'stepup_required') {
    return STEP_UP_FALLBACKS[input.reason];
  }

  return {
    summary: `Your account's state changed from ${input.previousState} to ${input.newState}.`,
    factors: [
      'Right now, the only mechanism that changes account state is guardian recovery: your guardians reached the required approval threshold and the recovery timelock elapsed.',
    ],
    nextSteps:
      input.newState === 'Normal'
        ? ['No action needed -- your account is back to normal operation.']
        : [
            'Review your recent activity.',
            'If you did not expect this, contact your guardians or check for a pending recovery proposal.',
          ],
  };
}
