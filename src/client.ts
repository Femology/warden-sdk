import { AssembledTransaction, Client as ContractClient, Spec } from '@stellar/stellar-sdk/contract';
import type { ErrorMessage, Result } from '@stellar/stellar-sdk/contract';
import type { Server } from '@stellar/stellar-sdk/rpc';

import { decimalToI128, i128ToDecimal } from './codec.js';
import { WardenErrorCode, WardenSdkError } from './errors.js';
import type {
  AccountState,
  Decision,
  GuardianConfig,
  Policy,
  PortablePolicyRule,
  RecoveryProposal,
  StepUpReason,
  VelocityWindow,
} from './types.js';

export interface WardenClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  referenceAssetDecimals: number;
  /**
   * Injectable for tests -- if omitted, a real rpc.Server is constructed
   * from rpcUrl. Never used to sign anything; this client never touches a
   * private key.
   */
  server?: Server;
}

/**
 * Matches the exact wire format of a Soroban contract-level failure, e.g.
 * "HostError: Error(Contract, #3)" -- verified against a real deployed
 * warden-contract instance, not assumed.
 */
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;

function mapContractError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(CONTRACT_ERROR_PATTERN);
  if (match) {
    throw WardenSdkError.fromContractErrorCode(Number(match[1]));
  }
  throw error;
}

export class WardenClient {
  private readonly config: WardenClientConfig;
  private specPromise: Promise<Spec> | undefined;

  constructor(config: WardenClientConfig) {
    if (!config.contractId) {
      throw new Error('WardenClient: contractId is required.');
    }
    if (!config.rpcUrl) {
      throw new Error('WardenClient: rpcUrl is required.');
    }
    if (!config.networkPassphrase) {
      throw new Error('WardenClient: networkPassphrase is required.');
    }
    if (!Number.isInteger(config.referenceAssetDecimals) || config.referenceAssetDecimals < 0) {
      throw new Error('WardenClient: referenceAssetDecimals must be a non-negative integer.');
    }
    this.config = config;
  }

  /**
   * Fetches the contract's on-chain spec once and caches it. The spec is
   * what lets funcArgsToScVals/funcResToNative encode and decode every call
   * correctly without this SDK hand-rolling XDR construction.
   */
  private async getSpec(): Promise<Spec> {
    if (!this.specPromise) {
      this.specPromise = ContractClient.from({
        contractId: this.config.contractId,
        rpcUrl: this.config.rpcUrl,
        networkPassphrase: this.config.networkPassphrase,
        server: this.config.server,
      }).then((client) => client.spec);
    }
    return this.specPromise;
  }

  /**
   * Builds and simulates a contract call, returning the AssembledTransaction.
   * Deliberately omits errorTypes: warden-contract's WardenError variants
   * carry no doc comments, so the SDK's own error-message mapping is empty
   * and useless -- instead, simulation failures are mapped by explicitly
   * checking `.result` below (see unwrapSimulated's own doc comment for why
   * that check can't be skipped), via the same mapContractError this
   * method's own try/catch uses for a build-time/network failure.
   *
   * That explicit check matters even for build* (write) callers that only
   * want the XDR to hand off for signing, not the decoded value: skipping
   * it and calling `tx.toXdr()` straight off a *reverted* simulation still
   * produces XDR that signs and submits without complaint, then fails at
   * the network with a bare "tx_malformed" instead of the specific
   * WardenError the simulation already knew about -- found by calling
   * proposeRecovery with a target_state that isn't actually less
   * restrictive against the live deployed contract, where it produced
   * exactly that cryptic tx_malformed instead of a clean
   * InvalidTargetState.
   */
  private async build<T>(
    method: string,
    args: Record<string, unknown> | undefined,
    publicKey: string | undefined,
  ): Promise<AssembledTransaction<Result<T, ErrorMessage>>> {
    const spec = await this.getSpec();
    let tx: AssembledTransaction<Result<T, ErrorMessage>>;
    try {
      tx = await AssembledTransaction.build<Result<T, ErrorMessage>>({
        method,
        args: args ? spec.funcArgsToScVals(method, args) : undefined,
        contractId: this.config.contractId,
        networkPassphrase: this.config.networkPassphrase,
        rpcUrl: this.config.rpcUrl,
        server: this.config.server,
        publicKey,
        parseResultXdr: (xdr) => spec.funcResToNative(method, xdr) as Result<T, ErrorMessage>,
      });
    } catch (error) {
      return mapContractError(error);
    }
    // Discards the decoded value on purpose -- this call exists solely for
    // its throwing side effect. Every actual caller either re-reads
    // tx.result itself right after (getPolicy and friends) or only wanted
    // the XDR in the first place (every build* method); calling the lazy
    // getter here and again there is harmless, not a double-unwrap bug.
    this.unwrapSimulated(tx);
    return tx;
  }

  /**
   * Unwraps a simulate-only AssembledTransaction's result. `.result` is a
   * lazy getter -- for a read call whose simulation genuinely reverted (e.g.
   * get_policy against a wallet with no policy), the throw happens here,
   * *after* build() already returned successfully, not inside build()'s own
   * try/catch. Skipping this and calling `tx.result.unwrap()` directly
   * leaves that throw as a raw, untranslated stellar-sdk error instead of a
   * WardenSdkError -- found by actually calling getPolicy against a fresh
   * wallet on the live network, where it crashed instead of returning null
   * as documented.
   */
  private unwrapSimulated<T>(tx: { result: Result<T, ErrorMessage> }): T {
    try {
      return tx.result.unwrap();
    } catch (error) {
      return mapContractError(error);
    }
  }

  private async fromSignedXdr<T>(
    signedXdr: string,
  ): Promise<AssembledTransaction<Result<T, ErrorMessage>>> {
    const spec = await this.getSpec();
    const tx = AssembledTransaction.fromXdr<Result<T, ErrorMessage>>(
      {
        contractId: this.config.contractId,
        networkPassphrase: this.config.networkPassphrase,
        rpcUrl: this.config.rpcUrl,
        server: this.config.server,
      },
      signedXdr,
      spec,
    );
    // AssembledTransaction.fromXdr only populates .built, never .signed --
    // it has no way to know the XDR it was given already carries
    // signatures. Since this method's entire contract is "the caller
    // already signed this", mark it explicitly: .send() throws "not yet
    // signed" otherwise, even against a fully-signed envelope. Found by
    // actually running a submit* call against the live deployed contract,
    // not by reading the types.
    tx.signed = tx.built;
    return tx;
  }

  /** Submits an already-signed XDR and returns the unwrapped success value. */
  private async submit<T>(signedXdr: string): Promise<T> {
    try {
      const assembled = await this.fromSignedXdr<T>(signedXdr);
      const sent = await assembled.send();
      return this.unwrapSimulated(sent);
    } catch (error) {
      return mapContractError(error);
    }
  }

  async buildSetPolicy(
    wallet: string,
    rule: PortablePolicyRule,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'set_policy',
      {
        wallet,
        max_no_stepup: decimalToI128(rule.maxAmountNoStepUp, this.config.referenceAssetDecimals),
        daily_velocity_cap: decimalToI128(rule.dailyVelocityCap, this.config.referenceAssetDecimals),
        new_recipient_requires_stepup: rule.newRecipientRequiresStepUp,
        hourly_velocity_cap: decimalToI128(rule.hourlyVelocityCap, this.config.referenceAssetDecimals),
        trust_decay_seconds: BigInt(rule.trustDecaySeconds),
      },
      sourceAccount ?? wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitSetPolicy(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildAddTrustedRecipient(
    wallet: string,
    recipient: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'add_trusted_recipient',
      { wallet, recipient },
      sourceAccount ?? wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitAddTrustedRecipient(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildRemoveTrustedRecipient(
    wallet: string,
    recipient: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'remove_trusted_recipient',
      { wallet, recipient },
      sourceAccount ?? wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitRemoveTrustedRecipient(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildEvaluate(
    wallet: string,
    recipient: string,
    amount: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<RawUnion>(
      'evaluate',
      {
        wallet,
        recipient,
        amount: decimalToI128(amount, this.config.referenceAssetDecimals),
      },
      sourceAccount ?? wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitEvaluate(signedXdr: string): Promise<Decision> {
    const raw = await this.submit<RawUnion>(signedXdr);
    return decodeDecision(raw);
  }

  /**
   * Simulate-only, no signing, no submission. Returns null on PolicyNotFound
   * -- a wallet that has not configured a policy yet is an expected, common
   * state, not an error the caller should have to catch.
   */
  async getPolicy(wallet: string): Promise<Policy | null> {
    try {
      const tx = await this.build<RawPolicy>('get_policy', { wallet }, undefined);
      return decodePolicy(this.unwrapSimulated(tx), this.config.referenceAssetDecimals);
    } catch (error) {
      if (error instanceof WardenSdkError && error.code === WardenErrorCode.PolicyNotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Simulate-only. Never returns null -- mirrors the contract's own
   * behavior of returning a zeroed fresh window when no activity has
   * occurred yet, rather than treating "no activity" as an error.
   */
  async getVelocity(wallet: string): Promise<VelocityWindow> {
    const tx = await this.build<RawVelocityWindow>('get_velocity', { wallet }, undefined);
    return decodeVelocityWindow(this.unwrapSimulated(tx), this.config.referenceAssetDecimals);
  }

  async buildAddFlaggedAddress(
    admin: string,
    address: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'add_flagged_address',
      { admin, address },
      sourceAccount ?? admin,
    );
    return { xdr: tx.toXdr() };
  }

  async submitAddFlaggedAddress(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildRemoveFlaggedAddress(
    admin: string,
    address: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'remove_flagged_address',
      { admin, address },
      sourceAccount ?? admin,
    );
    return { xdr: tx.toXdr() };
  }

  async submitRemoveFlaggedAddress(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildSetGuardians(
    wallet: string,
    guardians: string[],
    threshold: number,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'set_guardians',
      { wallet, guardians, threshold },
      sourceAccount ?? wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitSetGuardians(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  /** Requires the *proposer*'s auth, not the wallet's -- sourceAccount
   * defaults to proposer, matching who the contract actually calls
   * require_auth() on. */
  async buildProposeRecovery(
    wallet: string,
    proposer: string,
    targetState: AccountState,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'propose_recovery',
      // AccountState is fieldless in the contract but still wire-encoded as
      // a tagged union, not a bare symbol/string -- { tag } is required
      // here or funcArgsToScVals throws "no such enum entry: undefined".
      { wallet, proposer, target_state: encodeAccountState(targetState) },
      sourceAccount ?? proposer,
    );
    return { xdr: tx.toXdr() };
  }

  async submitProposeRecovery(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  /** Requires the guardian's auth, not the wallet's -- sourceAccount
   * defaults to guardian. */
  async buildApproveRecovery(
    wallet: string,
    guardian: string,
    sourceAccount?: string,
  ): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>('approve_recovery', { wallet, guardian }, sourceAccount ?? guardian);
    return { xdr: tx.toXdr() };
  }

  async submitApproveRecovery(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  /**
   * execute_recovery has no require_auth() call on any address in the
   * contract -- the entire point of guardian recovery is routing around a
   * compromised or unavailable owner key. sourceAccount is still required
   * here (a Stellar transaction envelope always needs a fee-paying source
   * account and its own classic signature), but deliberately has no
   * default the way every other build* method here defaults to its
   * primary address: defaulting to `wallet` would misleadingly suggest the
   * wallet needs to be involved at all. Pass whichever funded account is
   * actually submitting this -- a guardian's, a keeper's, anyone's.
   */
  async buildExecuteRecovery(wallet: string, sourceAccount: string): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>('execute_recovery', { wallet }, sourceAccount);
    return { xdr: tx.toXdr() };
  }

  async submitExecuteRecovery(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildCancelRecovery(wallet: string, sourceAccount?: string): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>('cancel_recovery', { wallet }, sourceAccount ?? wallet);
    return { xdr: tx.toXdr() };
  }

  async submitCancelRecovery(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  /** Simulate-only. Never errors on absence -- every wallet has an
   * AccountState even if it never called set_guardians; absence means
   * Normal, same reasoning as getVelocity's zeroed-window default. */
  async getAccountState(wallet: string): Promise<AccountState> {
    const tx = await this.build<RawUnion>('get_account_state', { wallet }, undefined);
    return decodeAccountState(this.unwrapSimulated(tx));
  }

  /** Simulate-only. Returns null if set_guardians was never called --
   * "never configured" and "configured with an empty list" are genuinely
   * different states, so unlike getAccountState this does distinguish
   * absence, the same way getPolicy does. */
  async getGuardians(wallet: string): Promise<GuardianConfig | null> {
    try {
      const tx = await this.build<RawGuardianConfig>('get_guardians', { wallet }, undefined);
      return decodeGuardianConfig(this.unwrapSimulated(tx));
    } catch (error) {
      if (error instanceof WardenSdkError && error.code === WardenErrorCode.GuardiansNotConfigured) {
        return null;
      }
      throw error;
    }
  }

  /** Simulate-only. Returns null if nothing is currently pending, rather
   * than throwing -- "no recovery in progress" is an expected, common
   * state, not an error the caller should have to catch. */
  async getRecoveryProposal(wallet: string): Promise<RecoveryProposal | null> {
    try {
      const tx = await this.build<RawRecoveryProposal>('get_recovery_proposal', { wallet }, undefined);
      return decodeRecoveryProposal(this.unwrapSimulated(tx));
    } catch (error) {
      if (error instanceof WardenSdkError && error.code === WardenErrorCode.RecoveryNotFound) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * The wire shape soroban-sdk decodes a Rust #[contracttype] enum into:
 * a unit variant like Decision::Allow becomes { tag: "Allow" }, and a tuple
 * variant like Decision::RequireStepUp(reason) becomes
 * { tag: "RequireStepUp", values: [reasonRawUnion] } -- verified against
 * the SDK's own spec-decoding source, since this shape is not otherwise
 * documented plainly.
 */
interface RawUnion {
  tag: string;
  values?: unknown[];
}

interface RawPolicy {
  owner: string;
  max_no_stepup: bigint;
  daily_velocity_cap: bigint;
  hourly_velocity_cap: bigint;
  new_recipient_requires_stepup: boolean;
  // Decoded from the contract's Map<Address, u64>. Verified against a real
  // deployed Phase 14 contract, not assumed: stellar-sdk's scValToNative
  // decodes a Soroban map whose keys aren't plain strings/symbols (an
  // Address is neither) as an array of [key, value] tuples, *not* a plain
  // object -- {...trusted_recipients} on that array silently produces
  // {"0": [address, timestamp]} instead of throwing, which is exactly the
  // kind of shape bug that only shows up against a live network.
  trusted_recipients: [string, bigint][];
  trust_decay_seconds: bigint;
  updated_at: bigint;
}

function decodePolicy(raw: RawPolicy, decimals: number): Policy {
  return {
    owner: raw.owner,
    maxNoStepUp: i128ToDecimal(raw.max_no_stepup, decimals),
    dailyVelocityCap: i128ToDecimal(raw.daily_velocity_cap, decimals),
    hourlyVelocityCap: i128ToDecimal(raw.hourly_velocity_cap, decimals),
    newRecipientRequiresStepUp: raw.new_recipient_requires_stepup,
    trustedRecipients: Object.fromEntries(raw.trusted_recipients),
    trustDecaySeconds: raw.trust_decay_seconds,
    updatedAt: raw.updated_at,
  };
}

interface RawVelocityWindow {
  window_start: bigint;
  cumulative_amount: bigint;
  tx_count: number;
}

function decodeVelocityWindow(raw: RawVelocityWindow, decimals: number): VelocityWindow {
  return {
    windowStart: raw.window_start,
    cumulativeAmount: i128ToDecimal(raw.cumulative_amount, decimals),
    txCount: raw.tx_count,
  };
}

interface RawGuardianConfig {
  guardians: string[];
  threshold: number;
}

function decodeGuardianConfig(raw: RawGuardianConfig): GuardianConfig {
  return { guardians: raw.guardians, threshold: raw.threshold };
}

/**
 * AccountState is fieldless in the contract, but still wire-encoded/decoded
 * as a tagged union ({ tag: "Normal" }, no `values`), not a bare symbol --
 * verified against the live deployed contract (a CLI's own pretty-printing
 * of it as a plain string was misleading). These two functions are the only
 * place that shape is dealt with; every public method takes/returns the
 * plain string type.
 */
function encodeAccountState(state: AccountState): RawUnion {
  return { tag: state };
}

function decodeAccountState(raw: RawUnion): AccountState {
  return raw.tag as AccountState;
}

interface RawRecoveryProposal {
  proposer: string;
  target_state: RawUnion;
  approvals: string[];
  proposed_at: bigint;
  timelock_seconds: bigint;
}

function decodeRecoveryProposal(raw: RawRecoveryProposal): RecoveryProposal {
  return {
    proposer: raw.proposer,
    targetState: decodeAccountState(raw.target_state),
    approvals: raw.approvals,
    proposedAt: raw.proposed_at,
    timelockSeconds: raw.timelock_seconds,
  };
}

function decodeDecision(raw: RawUnion): Decision {
  if (raw.tag === 'Allow') {
    return { type: 'Allow' };
  }
  if (raw.tag === 'RequireStepUp') {
    const reasonRaw = raw.values?.[0] as RawUnion | undefined;
    if (!reasonRaw) {
      throw new Error('Malformed RequireStepUp decision: missing reason.');
    }
    return { type: 'RequireStepUp', reason: reasonRaw.tag as StepUpReason };
  }
  throw new Error(`Unrecognized Decision tag from contract: ${raw.tag}`);
}
