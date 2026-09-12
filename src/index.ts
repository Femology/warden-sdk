export { WardenClient } from './client.js';
export type { WardenClientConfig } from './client.js';

export { decimalToI128, i128ToDecimal } from './codec.js';

export { WardenErrorCode, WardenSdkError } from './errors.js';

export type {
  AccountState,
  Decision,
  GuardianConfig,
  Policy,
  PortablePolicyRule,
  RecoveryProposal,
  StepUpReason,
  VelocityWindow,
} from './types.js';

export {
  buildExplainPrompt,
  fallbackExplanation,
  validateExplanationResponse,
} from './explain.js';
export type { ExplanationInput, ExplanationResult } from './explain.js';
