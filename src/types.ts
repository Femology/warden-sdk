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

export type StepUpReason =
  | 'AmountExceeded'
  | 'NewRecipient'
  | 'VelocityExceeded'
  | 'HourlyVelocityExceeded'
  | 'FlaggedRecipient';

export type Decision =
  | { type: 'Allow' }
  | { type: 'RequireStepUp'; reason: StepUpReason };

/**
 * Ordered least to most restrictive, matching warden-contract's own
 * declaration order exactly (Rust's derived Ord follows it directly). This
 * is the friendly, decoded shape this SDK exposes -- on the wire, even
 * though every variant is fieldless, stellar-sdk still encodes/decodes it
 * as a tagged union ({ tag: "Normal" }, no `values`), the same shape as
 * StepUpReason inside Decision. Assumed at first to be a bare string
 * (a CLI's own pretty-printing suggested that), which was wrong in both
 * directions: encoding a plain string into propose_recovery's target_state
 * argument fails client-side with "no such enum entry: undefined", and
 * get_account_state's raw result really is { tag: "Normal" }, not "Normal"
 * -- found by actually calling both against the live deployed contract.
 * client.ts wraps/unwraps this at the boundary so callers never see the
 * `{ tag }` shape.
 */
export type AccountState = 'Normal' | 'Watch' | 'Restricted' | 'Challenged' | 'Frozen';

export interface GuardianConfig {
  guardians: string[]; // max 7, enforced by the contract's set_guardians
  threshold: number; // 1 <= threshold <= guardians.length
}

export interface RecoveryProposal {
  proposer: string;
  targetState: AccountState;
  approvals: string[];
  proposedAt: bigint;
  timelockSeconds: bigint;
}

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
