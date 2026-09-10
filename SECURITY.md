# Security Policy

## Unaudited -- use at your own risk

**`warden-sdk` has not had a third-party security audit**, and neither has
[`warden-contract`](https://github.com/Femology/warden-contract), which it wraps. It has
34 passing unit tests but no independent security review. Do not build a production
integration handling real funds on this SDK without an audit of both this library and
the underlying contract.

## Reporting a vulnerability

Report privately rather than opening a public issue -- especially anything involving:
incorrect amount encoding/decoding that could misrepresent a value, an error case that
silently swallows a contract failure instead of surfacing it, or anything that could
cause a caller to sign or submit something other than what they intended.

**Contact:** femimi1234@gmail.com

Include a description, reproduction steps (ideally a failing test), and impact
assessment. You'll get an acknowledgment within a few days.

## Scope

In scope: this SDK's own logic (`src/`) -- encoding, decoding, error mapping. Out of
scope: `@stellar/stellar-sdk` itself, the Stellar network, and `warden-contract`'s own
logic (report contract issues to that repo instead).
