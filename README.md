# warden-sdk

The TypeScript client library for [`warden-contract`](https://github.com/Femology/warden-contract). It is the only supported way another application talks to Warden — nobody should hand-build a Soroban invocation against this contract directly.

**This SDK never signs anything and never touches a private key.** Every mutating contract call is exposed as a `build*`/`submit*` pair: `build*` constructs and simulates the transaction, returning unsigned XDR; `submit*` takes an already-signed XDR, sends it, and returns the typed result. Getting the transaction signed — via passkey-kit or any other signer — is entirely the calling application's job.

It also owns the **portable policy rule shape**: a chain-neutral JSON representation of a policy, so a future non-Stellar integration is a translation exercise against a stable interface, not a rewrite of client logic.

## Install

```bash
npm install warden-sdk
```

ESM only, Node ≥18.

## Money never touches a float

Every amount in and out of this SDK is a decimal string (`"150.00"`), never a JS `number`. Converting to and from the on-chain `i128` representation is exact fixed-point string arithmetic in `codec.ts` — it never routes through `parseFloat` or `Number`.

## `WardenClient`

```ts
import { WardenClient } from 'warden-sdk';

const client = new WardenClient({
  contractId: 'C...',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  referenceAssetDecimals: 7,
});
```

`referenceAssetDecimals` is a config value, not a network lookup — v1 uses one fixed reference asset per deployment, so there's no reason to spend an RPC round trip fetching a value that doesn't change.

### Mutating calls — build, sign elsewhere, submit

```ts
const { xdr } = await client.buildSetPolicy(wallet, {
  version: 1,
  maxAmountNoStepUp: '150.00',
  dailyVelocityCap: '500.00',
  newRecipientRequiresStepUp: true,
  trustedRecipients: [],
});
// hand `xdr` to whatever signs on the wallet's behalf, then:
await client.submitSetPolicy(signedXdr);
```

- **`buildSetPolicy(wallet, rule: PortablePolicyRule) -> { xdr }`** / **`submitSetPolicy(signedXdr) -> void`** — throws a mapped `WardenSdkError` on `InvalidPolicyParams`.
- **`buildAddTrustedRecipient(wallet, recipient) -> { xdr }`** / **`submitAddTrustedRecipient(signedXdr) -> void`** — throws on `PolicyNotFound` or `RecipientAlreadyTrusted`.
- **`buildRemoveTrustedRecipient(wallet, recipient) -> { xdr }`** / **`submitRemoveTrustedRecipient(signedXdr) -> void`** — throws on `PolicyNotFound` or `RecipientNotTrusted`.
- **`buildEvaluate(wallet, recipient, amount) -> { xdr }`** / **`submitEvaluate(signedXdr) -> Decision`** — `amount` is a decimal string; throws on `PolicyNotFound` or `InvalidAmount`.

### Read-only calls — a single method each

```ts
const policy = await client.getPolicy(wallet); // Policy | null
const window = await client.getVelocity(wallet); // VelocityWindow
```

- **`getPolicy(wallet) -> Policy | null`** — `null` when the contract reports `PolicyNotFound`. This is an expected, common state (a wallet that hasn't configured a policy yet), not an error the caller should have to catch.
- **`getVelocity(wallet) -> VelocityWindow`** — never `null`; mirrors the contract's own behavior of returning a zeroed fresh window when no activity has occurred yet.

## Types

```ts
interface Policy {
  owner: string;
  maxNoStepUp: string;               // decimal string
  dailyVelocityCap: string;          // decimal string
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: string[];
  updatedAt: bigint;                 // ledger timestamp
}

interface VelocityWindow {
  windowStart: bigint;
  cumulativeAmount: string;          // decimal string
  txCount: number;
}

type StepUpReason = 'AmountExceeded' | 'NewRecipient' | 'VelocityExceeded';

type Decision =
  | { type: 'Allow' }
  | { type: 'RequireStepUp'; reason: StepUpReason };
```

### `PortablePolicyRule` — the chain-neutral shape

```ts
interface PortablePolicyRule {
  version: 1;
  maxAmountNoStepUp: string;       // decimal string, e.g. "150.00"
  dailyVelocityCap: string;        // decimal string
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: string[];     // addresses in whatever format the target chain uses
}
```

This is the interface a future non-Stellar (e.g. EVM) integration would actually consume. `codec.ts` is what translates between this shape and the on-chain `i128`/`Vec<Address>` representation — a future adapter implements the same interface against a different contract without needing to know anything about how the Stellar side encodes it.

## Errors

Every `submit*` method throws a `WardenSdkError` on a contract-level failure, never a bare string:

```ts
try {
  await client.submitSetPolicy(signedXdr);
} catch (error) {
  if (error instanceof WardenSdkError) {
    console.log(error.code, error.message); // e.g. WardenErrorCode.InvalidPolicyParams
  }
}
```

The numeric codes mirror `WardenError` in `warden-contract` exactly (`NotInitialized = 1` through `RecipientNotTrusted = 7`).

**A note on how this works internally**, since it isn't obvious from the contract's own docs: `warden-contract`'s error enum carries no Rust doc comments, so `@stellar/stellar-sdk`'s built-in error-message mapping (which reads those doc comments) comes back empty. This SDK doesn't rely on it — instead it regex-matches the host's own raw failure text (`Error(Contract, #N)`, the same format the Stellar CLI prints) and maps the numeric code directly. Verified against a real deployed contract instance, not assumed.

## Building and testing

```bash
npm run build   # tsc
npm test        # vitest run
```

Unit tests mock the `@stellar/stellar-sdk/contract` module boundary — they don't require a live deployed contract to run. End-to-end integration tests against an actual testnet deployment belong in `warden-app`'s test suite, once that repo exists.
