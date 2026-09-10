# Contributing to warden-sdk

Thanks for looking at this. Contributions of any size are welcome.

## Before you start

- **Money never touches a float.** Every amount is a decimal string in and out of this
  SDK; conversion to/from `i128` is exact fixed-point string arithmetic in `codec.ts`.
- **No `any` used to sidestep modeling a type properly.**
- **This SDK never signs anything.** No private key handling belongs here, ever.
- **No placeholders or stubs.** Every commit should leave working, tested code.

## Local setup

```bash
git clone https://github.com/Femology/warden-sdk.git
cd warden-sdk
npm install
npm test
```

## Making a change

1. Open an issue first for anything beyond a trivial fix.
2. Branch from `main`.
3. One logical change per commit (`feat`, `fix`, `test`, `docs`, `chore`).
4. `npm test` must pass locally before you open a PR.
5. Open a PR against `main`. CI (`vitest`) must pass, and the PR needs one approval
   before it can merge.

## Reporting a bug

Open an issue with a minimal reproduction — ideally a failing test case. For a security
issue, see `SECURITY.md` instead of a public issue.

## Code style

- `camelCase` for functions and fields, `PascalCase` for types and classes.
- Every public method has an explicit return type — never rely on inference for the
  public API surface.
