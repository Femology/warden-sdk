/**
 * Numeric codes mirror WardenError in warden-contract exactly:
 * https://github.com/Femology/warden-contract/blob/main/contracts/warden/src/errors.rs
 */
export enum WardenErrorCode {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  PolicyNotFound = 3,
  InvalidAmount = 4,
  InvalidPolicyParams = 5,
  RecipientAlreadyTrusted = 6,
  RecipientNotTrusted = 7,
}

const MESSAGES: Record<WardenErrorCode, string> = {
  [WardenErrorCode.NotInitialized]: 'The contract has not been initialized yet.',
  [WardenErrorCode.AlreadyInitialized]: 'The contract has already been initialized.',
  [WardenErrorCode.PolicyNotFound]: 'This wallet has not configured a policy yet.',
  [WardenErrorCode.InvalidAmount]: 'The amount must be greater than zero.',
  [WardenErrorCode.InvalidPolicyParams]:
    'Invalid policy parameters: max_no_stepup must be non-negative, and daily_velocity_cap must be at least max_no_stepup.',
  [WardenErrorCode.RecipientAlreadyTrusted]: 'This recipient is already trusted.',
  [WardenErrorCode.RecipientNotTrusted]: 'This recipient is not currently trusted.',
};

/**
 * Thrown by every submit* method on WardenClient when the contract call
 * fails with a typed WardenError. Never a bare string -- callers can branch
 * on .code.
 */
export class WardenSdkError extends Error {
  readonly code: WardenErrorCode;

  constructor(code: WardenErrorCode) {
    super(MESSAGES[code]);
    this.name = 'WardenSdkError';
    this.code = code;
  }

  static fromContractErrorCode(code: number): WardenSdkError {
    if (!(code in MESSAGES)) {
      throw new Error(`Unrecognized WardenError code from contract: ${code}`);
    }
    return new WardenSdkError(code as WardenErrorCode);
  }
}
