import { AssembledTransaction, Client as ContractClient, Spec } from '@stellar/stellar-sdk/contract';
import type { ErrorMessage, Result } from '@stellar/stellar-sdk/contract';
import type { Server } from '@stellar/stellar-sdk/rpc';

import { decimalToI128, i128ToDecimal } from './codec.js';
import { WardenErrorCode, WardenSdkError } from './errors.js';
import type { Decision, Policy, PortablePolicyRule, StepUpReason } from './types.js';

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
   * and useless -- instead, simulation failures are left to throw their raw
   * host error (verified: its message contains "Error(Contract, #N)"),
   * which mapContractError translates into a typed WardenSdkError.
   */
  private async build<T>(
    method: string,
    args: Record<string, unknown> | undefined,
    publicKey: string | undefined,
  ): Promise<AssembledTransaction<Result<T, ErrorMessage>>> {
    const spec = await this.getSpec();
    try {
      return await AssembledTransaction.build<Result<T, ErrorMessage>>({
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
  }

  private async fromSignedXdr<T>(
    signedXdr: string,
  ): Promise<AssembledTransaction<Result<T, ErrorMessage>>> {
    const spec = await this.getSpec();
    return AssembledTransaction.fromXdr<Result<T, ErrorMessage>>(
      {
        contractId: this.config.contractId,
        networkPassphrase: this.config.networkPassphrase,
        rpcUrl: this.config.rpcUrl,
        server: this.config.server,
      },
      signedXdr,
      spec,
    );
  }

  /** Submits an already-signed XDR and returns the unwrapped success value. */
  private async submit<T>(signedXdr: string): Promise<T> {
    try {
      const assembled = await this.fromSignedXdr<T>(signedXdr);
      const sent = await assembled.send();
      return sent.result.unwrap();
    } catch (error) {
      return mapContractError(error);
    }
  }

  async buildSetPolicy(wallet: string, rule: PortablePolicyRule): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'set_policy',
      {
        wallet,
        max_no_stepup: decimalToI128(rule.maxAmountNoStepUp, this.config.referenceAssetDecimals),
        daily_velocity_cap: decimalToI128(rule.dailyVelocityCap, this.config.referenceAssetDecimals),
        new_recipient_requires_stepup: rule.newRecipientRequiresStepUp,
      },
      wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitSetPolicy(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildAddTrustedRecipient(wallet: string, recipient: string): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>('add_trusted_recipient', { wallet, recipient }, wallet);
    return { xdr: tx.toXdr() };
  }

  async submitAddTrustedRecipient(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildRemoveTrustedRecipient(wallet: string, recipient: string): Promise<{ xdr: string }> {
    const tx = await this.build<undefined>(
      'remove_trusted_recipient',
      { wallet, recipient },
      wallet,
    );
    return { xdr: tx.toXdr() };
  }

  async submitRemoveTrustedRecipient(signedXdr: string): Promise<void> {
    await this.submit<undefined>(signedXdr);
  }

  async buildEvaluate(wallet: string, recipient: string, amount: string): Promise<{ xdr: string }> {
    const tx = await this.build<RawUnion>(
      'evaluate',
      {
        wallet,
        recipient,
        amount: decimalToI128(amount, this.config.referenceAssetDecimals),
      },
      wallet,
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
      return decodePolicy(tx.result.unwrap(), this.config.referenceAssetDecimals);
    } catch (error) {
      if (error instanceof WardenSdkError && error.code === WardenErrorCode.PolicyNotFound) {
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
  new_recipient_requires_stepup: boolean;
  trusted_recipients: string[];
  updated_at: bigint;
}

function decodePolicy(raw: RawPolicy, decimals: number): Policy {
  return {
    owner: raw.owner,
    maxNoStepUp: i128ToDecimal(raw.max_no_stepup, decimals),
    dailyVelocityCap: i128ToDecimal(raw.daily_velocity_cap, decimals),
    newRecipientRequiresStepUp: raw.new_recipient_requires_stepup,
    trustedRecipients: [...raw.trusted_recipients],
    updatedAt: raw.updated_at,
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
