/**
 * All monetary amounts in this SDK are exact decimal strings (e.g. "150.00"),
 * never a JS number. Converting to/from the on-chain i128 representation is
 * handled entirely by codec.ts using fixed-point string arithmetic.
 */

export interface Policy {
  owner: string;
  maxNoStepUp: string;
  dailyVelocityCap: string;
  hourlyVelocityCap: string;
  newRecipientRequiresStepUp: boolean;
  /** Address -> last_paid_at (ledger timestamp of the most recent transfer
   * evaluate() saw to this recipient, or when they were added if never
   * paid since). A plain object, not a Map, since this is decoded straight
   * from the contract's own Map<Address, u64> via the dynamic contract
   * spec and JSON-serializes cleanly either way. */
  trustedRecipients: Record<string, bigint>;
  trustDecaySeconds: bigint;
  updatedAt: bigint;
}

export interface VelocityWindow {
  windowStart: bigint;
  cumulativeAmount: string;
  txCount: number;
}

export type StepUpReason = 'AmountExceeded' | 'NewRecipient' | 'VelocityExceeded' | 'HourlyVelocityExceeded';

export type Decision =
  | { type: 'Allow' }
  | { type: 'RequireStepUp'; reason: StepUpReason };

/**
 * The chain-neutral policy rule shape. A future non-Stellar (e.g. EVM)
 * integration consumes this same interface against a different contract --
 * it does not need to know anything about how the Stellar side encodes it.
 */
export interface PortablePolicyRule {
  version: 1;
  maxAmountNoStepUp: string;
  dailyVelocityCap: string;
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: string[];
  /** Decimal string, e.g. "50.00". Must be <= dailyVelocityCap -- the
   * contract rejects otherwise (InvalidPolicyParams). */
  hourlyVelocityCap: string;
  /** Duration in seconds a trusted recipient stays trusted without a
   * payment. A plain number is safe here (realistic decay durations never
   * approach u64/Number.MAX_SAFE_INTEGER); converted to a BigInt at the
   * contract-call boundary regardless, since that field is u64 on-chain. */
  trustDecaySeconds: number;
}
