import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mocks the @stellar/stellar-sdk/contract module boundary rather than a
 * live RPC network: WardenClient's own logic (correct method names, decimal
 * -> i128 argument encoding, XDR round trip, contract-error mapping) is what
 * these tests verify -- not the SDK's own transaction-assembly internals,
 * which are exercised for real in the live-network verification the SDK was
 * built against (see client.ts's design notes).
 */
const mockSpec = {
  funcArgsToScVals: vi.fn((_method: string, args: Record<string, unknown>) => args),
  funcResToNative: vi.fn(),
};

const mockClientFrom = vi.fn(async () => ({ spec: mockSpec }));
const mockBuild = vi.fn();
const mockFromXdr = vi.fn();

vi.mock('@stellar/stellar-sdk/contract', () => ({
  Client: { from: (...args: unknown[]) => mockClientFrom(...args) },
  AssembledTransaction: {
    build: (...args: unknown[]) => mockBuild(...args),
    fromXdr: (...args: unknown[]) => mockFromXdr(...args),
  },
}));

import { WardenClient } from '../src/client.js';

const CONFIG = {
  contractId: 'CTEST',
  rpcUrl: 'https://example.invalid',
  networkPassphrase: 'Test Passphrase',
  referenceAssetDecimals: 7,
};

beforeEach(() => {
  mockSpec.funcArgsToScVals.mockClear();
  mockSpec.funcResToNative.mockClear();
  mockClientFrom.mockClear();
  mockBuild.mockClear();
  mockFromXdr.mockClear();
});

describe('setPolicy build/submit round trip', () => {
  it('buildSetPolicy encodes decimal amounts and returns unsigned xdr', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    // build() now checks .result itself (fail-fast on a reverted
    // simulation before ever handing back signable XDR -- see build()'s
    // own doc comment for why), so every build* mock needs one even though
    // these tests only care about the returned xdr.
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildSetPolicy('GWALLET', {
      version: 1,
      maxAmountNoStepUp: '150.00',
      dailyVelocityCap: '500.00',
      newRecipientRequiresStepUp: true,
      trustedRecipients: [],
      hourlyVelocityCap: '200.00',
      trustDecaySeconds: 2_592_000,
    });

    expect(xdr).toBe('UNSIGNED_XDR');
    expect(mockBuild).toHaveBeenCalledTimes(1);

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('set_policy');
    expect(callArgs.publicKey).toBe('GWALLET');

    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('set_policy', {
      wallet: 'GWALLET',
      max_no_stepup: 1_500_000_000n,
      daily_velocity_cap: 5_000_000_000n,
      new_recipient_requires_stepup: true,
      hourly_velocity_cap: 2_000_000_000n,
      trust_decay_seconds: 2_592_000n,
    });
  });

  it('submitSetPolicy sends the signed xdr and resolves on success', async () => {
    const unwrap = vi.fn(() => undefined);
    const send = vi.fn(async () => ({ result: { unwrap } }));
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await client.submitSetPolicy('SIGNED_XDR');

    expect(mockFromXdr).toHaveBeenCalledTimes(1);
    expect(mockFromXdr.mock.calls[0]?.[1]).toBe('SIGNED_XDR');
    expect(send).toHaveBeenCalledTimes(1);
    expect(unwrap).toHaveBeenCalledTimes(1);
  });

  it('submitSetPolicy maps a contract error to a typed WardenSdkError', async () => {
    const send = vi.fn(async () => {
      throw new Error('Transaction simulation failed: HostError: Error(Contract, #5)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitSetPolicy('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 5,
    });
  });
});

describe('addTrustedRecipient round trip', () => {
  it('buildAddTrustedRecipient passes wallet and recipient through and returns unsigned xdr', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildAddTrustedRecipient('GWALLET', 'GRECIPIENT');

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('add_trusted_recipient');
    expect(callArgs.publicKey).toBe('GWALLET');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('add_trusted_recipient', {
      wallet: 'GWALLET',
      recipient: 'GRECIPIENT',
    });
  });

  it('submitAddTrustedRecipient sends the signed xdr and resolves on success', async () => {
    const unwrap = vi.fn(() => undefined);
    const send = vi.fn(async () => ({ result: { unwrap } }));
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await client.submitAddTrustedRecipient('SIGNED_XDR');

    expect(send).toHaveBeenCalledTimes(1);
    expect(unwrap).toHaveBeenCalledTimes(1);
  });

  it('submitAddTrustedRecipient maps RecipientAlreadyTrusted correctly', async () => {
    const send = vi.fn(async () => {
      throw new Error('HostError: Error(Contract, #6)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitAddTrustedRecipient('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 6,
    });
  });
});

describe('removeTrustedRecipient round trip', () => {
  it('buildRemoveTrustedRecipient passes wallet and recipient through and returns unsigned xdr', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildRemoveTrustedRecipient('GWALLET', 'GRECIPIENT');

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('remove_trusted_recipient');
    expect(callArgs.publicKey).toBe('GWALLET');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('remove_trusted_recipient', {
      wallet: 'GWALLET',
      recipient: 'GRECIPIENT',
    });
  });

  it('submitRemoveTrustedRecipient sends the signed xdr and resolves on success', async () => {
    const unwrap = vi.fn(() => undefined);
    const send = vi.fn(async () => ({ result: { unwrap } }));
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await client.submitRemoveTrustedRecipient('SIGNED_XDR');

    expect(send).toHaveBeenCalledTimes(1);
    expect(unwrap).toHaveBeenCalledTimes(1);
  });

  it('submitRemoveTrustedRecipient maps RecipientNotTrusted correctly', async () => {
    const send = vi.fn(async () => {
      throw new Error('HostError: Error(Contract, #7)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitRemoveTrustedRecipient('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 7,
    });
  });
});

describe('evaluate round trip', () => {
  it('buildEvaluate encodes the amount and returns unsigned xdr', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildEvaluate('GWALLET', 'GRECIPIENT', '42.5');

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('evaluate');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('evaluate', {
      wallet: 'GWALLET',
      recipient: 'GRECIPIENT',
      amount: 425_000_000n,
    });
  });

  it.each([
    [{ tag: 'Allow' }, { type: 'Allow' }],
    [
      { tag: 'RequireStepUp', values: [{ tag: 'AmountExceeded' }] },
      { type: 'RequireStepUp', reason: 'AmountExceeded' },
    ],
    [
      { tag: 'RequireStepUp', values: [{ tag: 'NewRecipient' }] },
      { type: 'RequireStepUp', reason: 'NewRecipient' },
    ],
    [
      { tag: 'RequireStepUp', values: [{ tag: 'VelocityExceeded' }] },
      { type: 'RequireStepUp', reason: 'VelocityExceeded' },
    ],
    [
      { tag: 'RequireStepUp', values: [{ tag: 'HourlyVelocityExceeded' }] },
      { type: 'RequireStepUp', reason: 'HourlyVelocityExceeded' },
    ],
  ])('submitEvaluate decodes %j into %j', async (raw, expected) => {
    const unwrap = vi.fn(() => raw);
    const send = vi.fn(async () => ({ result: { unwrap } }));
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    const decision = await client.submitEvaluate('SIGNED_XDR');

    expect(decision).toEqual(expected);
  });

  it('submitEvaluate maps InvalidAmount correctly', async () => {
    const send = vi.fn(async () => {
      throw new Error('HostError: Error(Contract, #4)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitEvaluate('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 4,
    });
  });
});

describe('getPolicy and getVelocity', () => {
  it('getPolicy decodes a configured policy', async () => {
    const rawPolicy = {
      owner: 'GWALLET',
      max_no_stepup: 1_500_000_000n,
      daily_velocity_cap: 5_000_000_000n,
      hourly_velocity_cap: 2_000_000_000n,
      new_recipient_requires_stepup: true,
      // What stellar-sdk's scValToNative actually returns for a Soroban
      // Map<Address, u64> -- an array of [key, value] tuples, since an
      // Address isn't a plain string/symbol key. Verified against a real
      // deployed contract; a plain object here would pass while missing
      // the exact bug this shape caused (see decodePolicy's comment).
      trusted_recipients: [['GRECIPIENT', 1_700_000_000n]] as [string, bigint][],
      trust_decay_seconds: 2_592_000n,
      updated_at: 1234n,
    };
    const unwrap = vi.fn(() => rawPolicy);
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const policy = await client.getPolicy('GWALLET');

    expect(policy).toEqual({
      owner: 'GWALLET',
      maxNoStepUp: '150',
      dailyVelocityCap: '500',
      hourlyVelocityCap: '200',
      newRecipientRequiresStepUp: true,
      trustedRecipients: { GRECIPIENT: 1_700_000_000n },
      trustDecaySeconds: 2_592_000n,
      updatedAt: 1234n,
    });

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('get_policy');
    expect(callArgs.publicKey).toBeUndefined();
  });

  // Real stellar-sdk behavior, verified against the live network: build()
  // itself resolves even when simulation reverted -- the throw happens
  // later, lazily, the moment `.result` is *accessed* (a getter, not a
  // plain property). A mock where mockBuild itself rejects (the shape the
  // two tests below used to have) never exercises that lazy-getter path,
  // and missed a real bug: getPolicy's catch block never routed the raw
  // error through mapContractError, so it never actually matched
  // `instanceof WardenSdkError` and PolicyNotFound was never caught in
  // practice -- getPolicy crashed on a real fresh wallet instead of
  // returning null as documented.
  function mockBuildWithRevertingResult(hostErrorMessage: string) {
    mockBuild.mockResolvedValueOnce({
      get result(): never {
        throw new Error(hostErrorMessage);
      },
    });
  }

  it('getPolicy returns null on PolicyNotFound instead of throwing', async () => {
    mockBuildWithRevertingResult('HostError: Error(Contract, #3)');

    const client = new WardenClient(CONFIG);
    const policy = await client.getPolicy('GWALLET');

    expect(policy).toBeNull();
  });

  it('getPolicy rethrows a different contract error rather than swallowing it', async () => {
    mockBuildWithRevertingResult('HostError: Error(Contract, #4)');

    const client = new WardenClient(CONFIG);
    await expect(client.getPolicy('GWALLET')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 4,
    });
  });

  it('getVelocity decodes a recorded window', async () => {
    const rawWindow = { window_start: 1000n, cumulative_amount: 250_000_000n, tx_count: 3 };
    const unwrap = vi.fn(() => rawWindow);
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const window = await client.getVelocity('GWALLET');

    expect(window).toEqual({ windowStart: 1000n, cumulativeAmount: '25', txCount: 3 });
  });

  it('getVelocity returns a zeroed window shape when no activity has occurred', async () => {
    const rawWindow = { window_start: 0n, cumulative_amount: 0n, tx_count: 0 };
    const unwrap = vi.fn(() => rawWindow);
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const window = await client.getVelocity('GWALLET');

    expect(window).toEqual({ windowStart: 0n, cumulativeAmount: '0', txCount: 0 });
  });

  it('getVelocity maps a reverted simulation to a WardenSdkError rather than a raw error', async () => {
    mockBuildWithRevertingResult('HostError: Error(Contract, #1)');

    const client = new WardenClient(CONFIG);
    await expect(client.getVelocity('GWALLET')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 1,
    });
  });
});

describe('flaggedAddress round trip', () => {
  it('buildAddFlaggedAddress defaults sourceAccount to admin and returns unsigned xdr', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildAddFlaggedAddress('GADMIN', 'GTARGET');

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('add_flagged_address');
    expect(callArgs.publicKey).toBe('GADMIN');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('add_flagged_address', {
      admin: 'GADMIN',
      address: 'GTARGET',
    });
  });

  it('buildAddFlaggedAddress fails fast on a reverted simulation rather than returning bad xdr', async () => {
    // The regression this guards: build() didn't used to check .result at
    // all for write-path (build*) callers, so a call whose simulation
    // reverted (e.g. an address that's already flagged) still produced
    // signable XDR -- found live, as a bare "tx_malformed" at submission
    // instead of a clean WardenSdkError at build time.
    mockBuild.mockResolvedValueOnce({
      toXdr: vi.fn(() => 'SHOULD_NOT_BE_REACHED'),
      get result(): never {
        throw new Error('HostError: Error(Contract, #9)');
      },
    });

    const client = new WardenClient(CONFIG);
    await expect(client.buildAddFlaggedAddress('GADMIN', 'GTARGET')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 9,
    });
  });

  it('submitRemoveFlaggedAddress sends the signed xdr and resolves on success', async () => {
    const unwrap = vi.fn(() => undefined);
    const send = vi.fn(async () => ({ result: { unwrap } }));
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await client.submitRemoveFlaggedAddress('SIGNED_XDR');

    expect(send).toHaveBeenCalledTimes(1);
    expect(unwrap).toHaveBeenCalledTimes(1);
  });

  it('submitAddFlaggedAddress maps NotAdmin correctly', async () => {
    const send = vi.fn(async () => {
      throw new Error('HostError: Error(Contract, #8)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitAddFlaggedAddress('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 8,
    });
  });
});

describe('guardians and recovery round trip', () => {
  it('buildSetGuardians defaults sourceAccount to wallet and passes guardians/threshold through', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildSetGuardians('GWALLET', ['GUARD1', 'GUARD2'], 2);

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.publicKey).toBe('GWALLET');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('set_guardians', {
      wallet: 'GWALLET',
      guardians: ['GUARD1', 'GUARD2'],
      threshold: 2,
    });
  });

  it('buildProposeRecovery encodes targetState as a tagged union and defaults sourceAccount to proposer, not wallet', async () => {
    // AccountState is fieldless in the contract but still wire-encoded as
    // { tag }, not a bare string -- verified live: a plain string here
    // throws "no such enum entry: undefined" from funcArgsToScVals.
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildProposeRecovery('GWALLET', 'GPROPOSER', 'Watch');

    expect(xdr).toBe('UNSIGNED_XDR');
    const callArgs = mockBuild.mock.calls[0]?.[0];
    // The proposer authorizes this call, not the wallet -- require_auth()
    // in the contract is on `proposer`.
    expect(callArgs.publicKey).toBe('GPROPOSER');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('propose_recovery', {
      wallet: 'GWALLET',
      proposer: 'GPROPOSER',
      target_state: { tag: 'Watch' },
    });
  });

  it('buildApproveRecovery defaults sourceAccount to guardian, not wallet', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    await client.buildApproveRecovery('GWALLET', 'GGUARDIAN');

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.publicKey).toBe('GGUARDIAN');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('approve_recovery', {
      wallet: 'GWALLET',
      guardian: 'GGUARDIAN',
    });
  });

  it('buildExecuteRecovery has no default sourceAccount -- it must be passed explicitly, and is never the wallet by assumption', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    // A relayer with no relationship to the wallet at all -- this is the
    // entire point of execute_recovery requiring no auth from any address.
    await client.buildExecuteRecovery('GWALLET', 'GRELAYER');

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.publicKey).toBe('GRELAYER');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('execute_recovery', { wallet: 'GWALLET' });
  });

  it('buildCancelRecovery defaults sourceAccount to wallet', async () => {
    const toXdr = vi.fn(() => 'UNSIGNED_XDR');
    mockBuild.mockResolvedValueOnce({ toXdr, result: { unwrap: () => undefined } });

    const client = new WardenClient(CONFIG);
    await client.buildCancelRecovery('GWALLET');

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.publicKey).toBe('GWALLET');
    expect(mockSpec.funcArgsToScVals).toHaveBeenCalledWith('cancel_recovery', { wallet: 'GWALLET' });
  });

  it('buildProposeRecovery fails fast with a clean WardenSdkError on an invalid target state, rather than bad xdr', async () => {
    // Found live: proposing a target_state that isn't actually less
    // restrictive than the current one used to build signable XDR anyway
    // and only fail at submission with a bare "tx_malformed".
    mockBuild.mockResolvedValueOnce({
      toXdr: vi.fn(() => 'SHOULD_NOT_BE_REACHED'),
      get result(): never {
        throw new Error('HostError: Error(Contract, #15)');
      },
    });

    const client = new WardenClient(CONFIG);
    await expect(
      client.buildProposeRecovery('GWALLET', 'GPROPOSER', 'Normal'),
    ).rejects.toMatchObject({ name: 'WardenSdkError', code: 15 });
  });

  it('submitExecuteRecovery maps TimelockNotElapsed correctly', async () => {
    const send = vi.fn(async () => {
      throw new Error('HostError: Error(Contract, #20)');
    });
    mockFromXdr.mockResolvedValueOnce({ send });

    const client = new WardenClient(CONFIG);
    await expect(client.submitExecuteRecovery('SIGNED_XDR')).rejects.toMatchObject({
      name: 'WardenSdkError',
      code: 20,
    });
  });
});

describe('getAccountState, getGuardians, getRecoveryProposal', () => {
  it('getAccountState unwraps the tagged-union wire shape into a plain string', async () => {
    const unwrap = vi.fn(() => ({ tag: 'Watch' }));
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const state = await client.getAccountState('GWALLET');

    expect(state).toBe('Watch');
  });

  it('getGuardians decodes a configured guardian list', async () => {
    const rawConfig = { guardians: ['GUARD1', 'GUARD2'], threshold: 2 };
    const unwrap = vi.fn(() => rawConfig);
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const config = await client.getGuardians('GWALLET');

    expect(config).toEqual({ guardians: ['GUARD1', 'GUARD2'], threshold: 2 });
  });

  it('getGuardians returns null on GuardiansNotConfigured instead of throwing', async () => {
    mockBuild.mockResolvedValueOnce({
      get result(): never {
        throw new Error('HostError: Error(Contract, #13)');
      },
    });

    const client = new WardenClient(CONFIG);
    const config = await client.getGuardians('GWALLET');

    expect(config).toBeNull();
  });

  it('getRecoveryProposal decodes a pending proposal, including its tagged-union target_state', async () => {
    const rawProposal = {
      proposer: 'GPROPOSER',
      target_state: { tag: 'Normal' },
      approvals: ['GPROPOSER', 'GGUARD2'],
      proposed_at: 1000n,
      timelock_seconds: 172_800n,
    };
    const unwrap = vi.fn(() => rawProposal);
    mockBuild.mockResolvedValueOnce({ result: { unwrap } });

    const client = new WardenClient(CONFIG);
    const proposal = await client.getRecoveryProposal('GWALLET');

    expect(proposal).toEqual({
      proposer: 'GPROPOSER',
      targetState: 'Normal',
      approvals: ['GPROPOSER', 'GGUARD2'],
      proposedAt: 1000n,
      timelockSeconds: 172_800n,
    });
  });

  it('getRecoveryProposal returns null on RecoveryNotFound instead of throwing', async () => {
    mockBuild.mockResolvedValueOnce({
      get result(): never {
        throw new Error('HostError: Error(Contract, #17)');
      },
    });

    const client = new WardenClient(CONFIG);
    const proposal = await client.getRecoveryProposal('GWALLET');

    expect(proposal).toBeNull();
  });
});
