<div align="center">

# Warden — SDK

**TypeScript client library for `warden-contract`. Never signs anything, never touches
a private key.**

[![CI](https://github.com/Femology/warden-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Femology/warden-sdk/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-not%20yet%20published-lightgrey)](https://github.com/Femology/warden-sdk)

[Warden org](https://github.com/Femology) · [warden-contract](https://github.com/Femology/warden-contract) · [warden-app](https://github.com/Femology/warden-app) · [warden-monitor](https://github.com/Femology/warden-monitor) · [Discussions](https://github.com/Femology/warden-sdk/discussions)

</div>

---


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
  hourlyVelocityCap: '200.00',
  newRecipientRequiresStepUp: true,
  trustedRecipients: [],
  trustDecaySeconds: 2_592_000, // 30 days
});
// hand `xdr` to whatever signs on the wallet's behalf, then:
await client.submitSetPolicy(signedXdr);
```

Every `build*` method's third-or-later parameter is an optional `sourceAccount`, defaulting to whichever address the contract actually calls `require_auth()` on for that call — pass it explicitly when the account paying/submitting the transaction differs from that address (a sponsor, a relayer, a keeper).

**Policy and velocity:**
- **`buildSetPolicy(wallet, rule: PortablePolicyRule, sourceAccount?) -> { xdr }`** / **`submitSetPolicy(signedXdr) -> void`** — throws on `InvalidPolicyParams`.
- **`buildAddTrustedRecipient(wallet, recipient, sourceAccount?) -> { xdr }`** / **`submitAddTrustedRecipient(signedXdr) -> void`** — throws on `PolicyNotFound` or `RecipientAlreadyTrusted`.
- **`buildRemoveTrustedRecipient(wallet, recipient, sourceAccount?) -> { xdr }`** / **`submitRemoveTrustedRecipient(signedXdr) -> void`** — throws on `PolicyNotFound` or `RecipientNotTrusted`.
- **`buildEvaluate(wallet, recipient, amount, sourceAccount?) -> { xdr }`** / **`submitEvaluate(signedXdr) -> Decision`** — `amount` is a decimal string; throws on `PolicyNotFound` or `InvalidAmount`.

**Flagged-address registry** (admin-only — `sourceAccount` defaults to `admin`, not the address being flagged):
- **`buildAddFlaggedAddress(admin, address, sourceAccount?) -> { xdr }`** / **`submitAddFlaggedAddress(signedXdr) -> void`** — throws on `NotAdmin` or `AddressAlreadyFlagged`.
- **`buildRemoveFlaggedAddress(admin, address, sourceAccount?) -> { xdr }`** / **`submitRemoveFlaggedAddress(signedXdr) -> void`** — throws on `NotAdmin` or `AddressNotFlagged`.

**Guardian and recovery subsystem:**
- **`buildSetGuardians(wallet, guardians: string[], threshold, sourceAccount?) -> { xdr }`** / **`submitSetGuardians(signedXdr) -> void`** — throws on `GuardianConfigLocked` (state worse than `Watch`) or `InvalidGuardianConfig`.
- **`buildProposeRecovery(wallet, proposer, targetState: AccountState, sourceAccount?) -> { xdr }`** / **`submitProposeRecovery(signedXdr) -> void`** — `sourceAccount` defaults to `proposer`, not `wallet` (the contract calls `require_auth()` on the proposer). Throws on `GuardiansNotConfigured`, `NotGuardian`, `RecoveryAlreadyProposed`, or `InvalidTargetState`.
- **`buildApproveRecovery(wallet, guardian, sourceAccount?) -> { xdr }`** / **`submitApproveRecovery(signedXdr) -> void`** — `sourceAccount` defaults to `guardian`. Throws on `NotGuardian`, `RecoveryNotFound`, or `AlreadyApproved`.
- **`buildExecuteRecovery(wallet, sourceAccount) -> { xdr }`** / **`submitExecuteRecovery(signedXdr) -> void`** — **`sourceAccount` is required, with no default.** The contract calls no `require_auth()` on any address at all here (the entire point of guardian recovery is routing around a compromised or unavailable owner key), so unlike every other `build*` method there's no sensible address to default to — pass whichever funded account is actually submitting this. Throws on `GuardiansNotConfigured`, `RecoveryNotFound`, `InsufficientApprovals`, or `TimelockNotElapsed`.
- **`buildCancelRecovery(wallet, sourceAccount?) -> { xdr }`** / **`submitCancelRecovery(signedXdr) -> void`** — the owner's veto. Throws on `RecoveryNotFound`.

**A build-time safety net that applies to every method above**: if the contract call would revert (any of the errors listed), the relevant `build*` method throws that `WardenSdkError` immediately — it never hands back XDR for a call that's already known to fail. Found live: this wasn't always true (see [Errors](#errors) below for the story), so a signed-and-submitted call against a doomed simulation used to fail with an opaque network-level `tx_malformed` instead.

### Read-only calls — a single method each

```ts
const policy = await client.getPolicy(wallet); // Policy | null
const window = await client.getVelocity(wallet); // VelocityWindow
const state = await client.getAccountState(wallet); // AccountState
const guardians = await client.getGuardians(wallet); // GuardianConfig | null
const proposal = await client.getRecoveryProposal(wallet); // RecoveryProposal | null
```

- **`getPolicy(wallet) -> Policy | null`** — `null` when the contract reports `PolicyNotFound`. This is an expected, common state (a wallet that hasn't configured a policy yet), not an error the caller should have to catch.
- **`getVelocity(wallet) -> VelocityWindow`** — never `null`; mirrors the contract's own behavior of returning a zeroed fresh window when no activity has occurred yet.
- **`getAccountState(wallet) -> AccountState`** — never `null`; absence on-chain means `'Normal'`, same reasoning as `getVelocity`.
- **`getGuardians(wallet) -> GuardianConfig | null`** — `null` when `set_guardians` was never called. Unlike `getAccountState`, "never configured" and "configured with an empty list" are genuinely different states here, so this does distinguish absence, the same way `getPolicy` does.
- **`getRecoveryProposal(wallet) -> RecoveryProposal | null`** — `null` when nothing is currently pending.

## Types

```ts
interface Policy {
  owner: string;
  maxNoStepUp: string;               // decimal string
  dailyVelocityCap: string;          // decimal string
  hourlyVelocityCap: string;         // decimal string, <= dailyVelocityCap
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: Record<string, bigint>; // address -> last_paid_at (ledger timestamp)
  trustDecaySeconds: bigint;
  updatedAt: bigint;                 // ledger timestamp
}

interface VelocityWindow {
  windowStart: bigint;
  cumulativeAmount: string;          // decimal string
  txCount: number;
}

type StepUpReason =
  | 'AmountExceeded'
  | 'NewRecipient'
  | 'VelocityExceeded'
  | 'HourlyVelocityExceeded'
  | 'FlaggedRecipient';

type Decision =
  | { type: 'Allow' }
  | { type: 'RequireStepUp'; reason: StepUpReason };

// Ordered least to most restrictive, matching the contract's own
// declaration order.
type AccountState = 'Normal' | 'Watch' | 'Restricted' | 'Challenged' | 'Frozen';

interface GuardianConfig {
  guardians: string[]; // max 7
  threshold: number;   // 1 <= threshold <= guardians.length
}

interface RecoveryProposal {
  proposer: string;
  targetState: AccountState;
  approvals: string[];
  proposedAt: bigint;
  timelockSeconds: bigint;
}
```

### `PortablePolicyRule` — the chain-neutral shape

```ts
interface PortablePolicyRule {
  version: 1;
  maxAmountNoStepUp: string;       // decimal string, e.g. "150.00"
  dailyVelocityCap: string;        // decimal string
  hourlyVelocityCap: string;       // decimal string, must be <= dailyVelocityCap
  newRecipientRequiresStepUp: boolean;
  trustedRecipients: string[];     // addresses in whatever format the target chain uses -- unused by buildSetPolicy itself, kept for shape symmetry with Policy (see note below)
  trustDecaySeconds: number;       // seconds; converted to BigInt at the contract-call boundary
}
```

This is the interface a future non-Stellar (e.g. EVM) integration would actually consume. `codec.ts` is what translates between this shape and the on-chain `i128` representation — a future adapter implements the same interface against a different contract without needing to know anything about how the Stellar side encodes it.

Note: `trustedRecipients` here is a no-op as far as `buildSetPolicy` is concerned — `warden-contract`'s `set_policy` has no trusted-recipients parameter at all; that list is managed exclusively through `buildAddTrustedRecipient`/`buildRemoveTrustedRecipient`. The field exists on this type only so `PortablePolicyRule` and `Policy` stay shape-symmetric.

## Errors

Every `build*` and `submit*` method throws a `WardenSdkError` on a contract-level failure, never a bare string:

```ts
try {
  await client.submitSetPolicy(signedXdr);
} catch (error) {
  if (error instanceof WardenSdkError) {
    console.log(error.code, error.message); // e.g. WardenErrorCode.InvalidPolicyParams
  }
}
```

The numeric codes mirror `WardenError` in `warden-contract` exactly (`NotInitialized = 1` through `TimelockNotElapsed = 20`).

**`build*` fails fast, before any XDR reaches a signer.** `.result` on the underlying `AssembledTransaction` is a lazy getter — for a call whose simulation genuinely reverted, the throw happens the moment `.result` is *accessed*, not synchronously from the initial build/simulate call. Skipping that check (as this SDK's `v0.2.0`/earlier internals did for every `build*` write method) means `tx.toXdr()` still succeeds, producing XDR that signs and submits without complaint, then fails at the network with a bare `tx_malformed` instead of the specific `WardenError` the simulation already knew about — found live, while verifying `buildProposeRecovery` against an invalid target state on the real deployed contract. Every `build*` method now checks this internally before returning, so a doomed call is rejected with a typed `WardenSdkError` immediately.

**A note on how this works internally**, since it isn't obvious from the contract's own docs: `warden-contract`'s error enum carries no Rust doc comments, so `@stellar/stellar-sdk`'s built-in error-message mapping (which reads those doc comments) comes back empty. This SDK doesn't rely on it — instead it regex-matches the host's own raw failure text (`Error(Contract, #N)`, the same format the Stellar CLI prints) and maps the numeric code directly. Verified against a real deployed contract instance, not assumed.

## Building and testing

```bash
npm run build   # tsc
npm test        # vitest run
```

Unit tests mock the `@stellar/stellar-sdk/contract` module boundary — they don't require a live deployed contract to run. End-to-end integration tests against an actual testnet deployment belong in `warden-app`'s test suite, once that repo exists.

---

## Maintainers

| Name | GitHub | Contact |
|---|---|---|
| Femology | [@Femology](https://github.com/Femology) | femimi1234@gmail.com |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Found a security issue? See
[SECURITY.md](SECURITY.md) instead of opening a public issue.

<a href="https://github.com/Femology/warden-sdk/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Femology/warden-sdk" alt="Contributors" />
</a>
