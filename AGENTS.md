# AGENTS.md — nearpay-console

You are working in **nearpay-console**, one of 26 NearPay repositories (`nearpay-brain/architecture/repositories.md`).
Scope: Internal operations: merchant review, KYB, compliance cases, screening hits, execution explorer, verification holds, audit log.

## Before changing anything

1. Read `../nearpay-brain/AGENTS.md`, then the docs listed in this repo's README.
2. Contracts (requests, responses, events, errors) come from `@nearpay/spec`. If one must change, open a PR in `nearpay-spec` first; never hand-write contract types here.
3. Check your change against invariants INV-1…INV-9 in `nearpay-brain/product/requirements.md`.

## Rules for this repo

- Ops scopes only; every action is audited server-side; never cache PII in browser storage.

## Never

- Import source code from another NearPay repo (depend on published packages/images only).
- Read or write another service's database.
- Add design documents here — update `nearpay-brain` and link to it.
- Commit secrets, private keys or real customer data.
- Merge changes to paths listed in `.github/CODEOWNERS` without the required human review.
