/**
 * All monetary amounts in this SDK are exact decimal strings (e.g. "150.00"),
 * never a JS number. Converting to/from the on-chain i128 representation is
 * handled entirely by codec.ts using fixed-point string arithmetic.
 */

export interface Policy {
  owner: string;
  maxNoStepUp: string;
  dailyVelocityCap: string;
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: string[];
  updatedAt: bigint;
}

export interface VelocityWindow {
  windowStart: bigint;
  cumulativeAmount: string;
  txCount: number;
}

export type StepUpReason = 'AmountExceeded' | 'NewRecipient' | 'VelocityExceeded';

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
}
