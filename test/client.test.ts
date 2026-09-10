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
    mockBuild.mockResolvedValueOnce({ toXdr });

    const client = new WardenClient(CONFIG);
    const { xdr } = await client.buildSetPolicy('GWALLET', {
      version: 1,
      maxAmountNoStepUp: '150.00',
      dailyVelocityCap: '500.00',
      newRecipientRequiresStepUp: true,
      trustedRecipients: [],
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
    mockBuild.mockResolvedValueOnce({ toXdr });

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
    mockBuild.mockResolvedValueOnce({ toXdr });

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
    mockBuild.mockResolvedValueOnce({ toXdr });

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
      new_recipient_requires_stepup: true,
      trusted_recipients: ['GRECIPIENT'],
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
      newRecipientRequiresStepUp: true,
      trustedRecipients: ['GRECIPIENT'],
      updatedAt: 1234n,
    });

    const callArgs = mockBuild.mock.calls[0]?.[0];
    expect(callArgs.method).toBe('get_policy');
    expect(callArgs.publicKey).toBeUndefined();
  });

  it('getPolicy returns null on PolicyNotFound instead of throwing', async () => {
    mockBuild.mockRejectedValueOnce(new Error('HostError: Error(Contract, #3)'));

    const client = new WardenClient(CONFIG);
    const policy = await client.getPolicy('GWALLET');

    expect(policy).toBeNull();
  });

  it('getPolicy rethrows a different contract error rather than swallowing it', async () => {
    mockBuild.mockRejectedValueOnce(new Error('HostError: Error(Contract, #4)'));

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
});
