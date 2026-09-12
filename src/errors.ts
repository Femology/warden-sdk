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
  NotAdmin = 8,
  AddressAlreadyFlagged = 9,
  AddressNotFlagged = 10,
  InvalidGuardianConfig = 11,
  GuardianConfigLocked = 12,
  GuardiansNotConfigured = 13,
  NotGuardian = 14,
  InvalidTargetState = 15,
  RecoveryAlreadyProposed = 16,
  RecoveryNotFound = 17,
  AlreadyApproved = 18,
  InsufficientApprovals = 19,
  TimelockNotElapsed = 20,
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
  [WardenErrorCode.NotAdmin]: 'This address is not the contract admin.',
  [WardenErrorCode.AddressAlreadyFlagged]: 'This address is already flagged.',
  [WardenErrorCode.AddressNotFlagged]: 'This address is not currently flagged.',
  [WardenErrorCode.InvalidGuardianConfig]:
    'Invalid guardian configuration: at most 7 guardians, and threshold must be between 1 and the number of guardians.',
  [WardenErrorCode.GuardianConfigLocked]:
    'Guardians can only be configured while the account is Normal or Watch.',
  [WardenErrorCode.GuardiansNotConfigured]: 'This wallet has not configured any guardians yet.',
  [WardenErrorCode.NotGuardian]: 'This address is not one of the wallet\'s configured guardians.',
  [WardenErrorCode.InvalidTargetState]:
    'The proposed target state must be strictly less restrictive than the current one.',
  [WardenErrorCode.RecoveryAlreadyProposed]: 'A recovery proposal is already pending for this wallet.',
  [WardenErrorCode.RecoveryNotFound]: 'No recovery proposal is currently pending for this wallet.',
  [WardenErrorCode.AlreadyApproved]: 'This guardian has already approved the current proposal.',
  [WardenErrorCode.InsufficientApprovals]: 'Not enough guardians have approved this proposal yet.',
  [WardenErrorCode.TimelockNotElapsed]: 'The recovery timelock has not elapsed yet.',
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
