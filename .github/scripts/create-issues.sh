#!/usr/bin/env bash
set -euo pipefail

gh issue create \
  --title "chore(sdk): publish warden-sdk to npm" \
  --label "enhancement,complexity: small" \
  --body "## Summary
warden-sdk is currently only installable as a git dependency
(\`warden-sdk@github:Femology/warden-sdk#v0.1.2\`), which is how \`warden-app\` and
\`warden-monitor\`'s dashboard currently consume it. Publishing to npm makes it a normal
\`npm install warden-sdk\` for any future integrator.

## Acceptance Criteria
- [ ] Confirm the \`warden-sdk\` package name is available on npm, or pick a scoped
      alternative if not.
- [ ] Set up an npm publish step in CI, gated on a version tag.
- [ ] Publish v0.1.2 (the current tagged version) as the first npm release.
- [ ] Update warden-app and warden-monitor's dependency from the git URL to the
      published npm version.

## Tech Stack
npm, GitHub Actions."

gh issue create \
  --title "test(sdk): add integration tests against a live Testnet deployment" \
  --label "enhancement,complexity: medium" \
  --body "## Summary
Current tests mock the \`@stellar/stellar-sdk/contract\` module boundary -- they verify
this SDK's own logic (argument encoding, error mapping, XDR round trip) without a live
contract. A smaller suite of true end-to-end tests against the actual deployed
\`warden-contract\` Testnet instance would catch drift between this SDK's assumptions and
the real contract's behavior that unit tests structurally cannot.

## Acceptance Criteria
- [ ] Add a separate test command (e.g. \`npm run test:e2e\`) that is not part of the
      default \`npm test\` / CI run, since it needs a funded Testnet account and network
      access.
- [ ] Cover at minimum: setPolicy round trip, evaluate returning each Decision variant
      against a real policy, and error mapping for at least one real contract failure.
- [ ] Document how to run it locally in CONTRIBUTING.md.

## Tech Stack
vitest, a funded Testnet keypair for the test run."

gh issue create \
  --title "feat(sdk): surface every simultaneously-true step-up reason (depends on warden-contract#4)" \
  --label "enhancement,complexity: medium" \
  --body "## Summary
Depends on [warden-contract#4](https://github.com/Femology/warden-contract/issues/4).
If that lands, \`Decision\`'s \`RequireStepUp\` variant needs to carry every applicable
reason, not just the first match -- a breaking change to this SDK's \`types.ts\` and
\`submitEvaluate\`'s decoding.

## Acceptance Criteria
- [ ] Do not start this until warden-contract#4's return shape is finalized.
- [ ] Update \`Decision\` type: \`RequireStepUp\` carries \`reasons: StepUpReason[]\`, or
      whatever shape that issue settles on.
- [ ] Update \`submitEvaluate\`'s decoding and every affected test.
- [ ] This is a breaking change for warden-app's StepUpConfirmModal -- coordinate before
      shipping.

## Tech Stack
TypeScript. Cross-repo dependency: warden-contract, warden-app."

echo "Done. Created 3 issues."
