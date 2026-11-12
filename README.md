# nearpay-console

The internal operations console: merchants, business details, compliance cases, screening hits and the blocklist, the execution explorer, verification holds, refunds, sentinel (kill switch and audit findings), reconciliation and the audit log.

Part of [NearPay](https://github.com/nearpay-money/nearpay) — start there for the live demo, the architecture diagram and the full "do X, see Y" walkthrough.

- **Where it sits:** a static single-page app for NearPay operators, served on its own host (`ops.<domain>`) behind Cloudflare Access; it is not a public surface. It calls only the `/ops/…` routes of identity, compliance, payments, rails and sentinel through the gateway, with operator sessions and step-up; sensitive actions (suspending a merchant, releasing the kill switch) follow the two-person rule enforced by those services.
- **Status:** NearPay runs on NEAR mainnet as a closed beta (https://nearpay.money). Under open onboarding (ADR-0024) there is no business review to do here by default: the KYB queue is used only when compliance runs with `NP_KYB_MODE=manual`.

|                                       |                                            |
| ------------------------------------- | ------------------------------------------ |
| Group                                 | Frontends                                  |
| Kind                                  | static SPA (internal)                      |
| Ships as                              | ops.nearpay.money behind Cloudflare Access |
| Owns                                  | — (stateless)                              |
| Depends on (published artifacts only) | spec (internal ops scopes), gateway        |
| First built in                        | Stage 2 (step 2.3)                         |

## Documentation

Design docs live in [`nearpay-brain`](https://github.com/nearpay-money/nearpay-brain), not here.

- [`lld/dashboard-and-console.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/lld/dashboard-and-console.md) — low-level design this repo is implemented from
- [`lld/audits/dashboard-and-console.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/lld/audits/dashboard-and-console.md) — audit findings already folded into the LLD
- [`roadmap/development-plan.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/roadmap/development-plan.md) — stage and step this repo is built in
- [`architecture/hld.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/hld.md) — system design
- [`architecture/repositories.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/repositories.md) — repo topology and dependency rules
- [`architecture/security.md`](https://github.com/nearpay-money/nearpay-brain/blob/main/architecture/security.md)

## Layout

```
nearpay-console/
├── src/
│   ├── app/            shell, routing, session/expiry, step-up dialog
│   ├── features/       overview, merchants, kyb, cases, blocklist, holds (executions + review),
│   │                   refunds, sentinel, reconciliation, audit, auth (sign-in, enrolment)
│   ├── lib/            API client (OPS_ROUTES only), errors, session, permissions, formatting,
│   │                   assets, reconciliation maths + CSV, review checks
│   └── ui/             console building blocks on the kit (sections, dialogs, approval card, Ops lock-up)
├── test/
│   ├── unit/           Vitest (coverage gate ≥ 90 % branches/lines on src/lib)
│   └── e2e/            Playwright against an in-process, spec-validating mock of OPS_ROUTES
├── deploy/             nginx site + headers for the image
├── Dockerfile          Vite build → unprivileged nginx
└── .github/workflows/  ci.yml (pnpm verify, dist artefact, image build)
```

## Verify this repo

Needs Node 22 (`.nvmrc`), pnpm 9 and, for step 4, Google Chrome. No Docker. `.npmrc` points the `@nearpay-money` and `@nearpay-internal` scopes at a local package registry, so start that first.

1. Start the local registry (no Docker, Node 22 only):
   `git clone https://github.com/nearpay-money/nearpay-deploy ../nearpay-deploy && ../nearpay-deploy/scripts/registry.sh start`
   → `curl http://127.0.0.1:4873/-/ping` answers `{}`.
2. `pnpm install --frozen-lockfile` → ends with `Done in …`, no registry errors.
3. `pnpm test` (unit tests of the API client, permissions, formatting, reconciliation maths and review checks) → `Test Files  4 passed (4)`, `Tests  45 passed (45)`.
4. `pnpm verify` (the full gate: typecheck, lint, unit tests with the coverage gate of ≥ 90 % branches and lines on `src/lib`, build, then Playwright against the built app and an in-process, spec-validating mock of the ops routes) → exits 0; the Playwright list ends with `24 passed` and `1 skipped` (under a minute). The browser is the system Chrome at `/usr/bin/google-chrome`; set `NP_CHROME_PATH` to another path if needed.

## Develop

```sh
pnpm install --frozen-lockfile   # NearPay packages from the local registry (see "Verify this repo")
pnpm dev                # Vite; /api is proxied to https://ops.nearpay.localhost (Compose stack)
pnpm verify             # typecheck, Biome, unit + coverage, build, Playwright (system Chrome)
NP_SHOTS_DIR=/tmp/shots pnpm e2e screens   # 1440/390 screenshots of every main screen
```

- Strict CSP in `index.html` (no `unsafe-inline`, no `unsafe-eval`, no third-party origins); `src/zod-csp.ts` keeps zod from probing `new Function`.
- Session, CSRF token and every fetched object live in memory only — nothing is written to web storage.

## Status

Stage 2 (step 2.3): all console pages from the LLD on `@nearpay-internal/spec` 0.2.0. Design v2 (2026-11-11): `@nearpay-internal/ui` 0.5.0 — kit AppShell v2 with the navy sidebar like the merchant dashboard; the console is told apart by the "NearPay Ops" lock-up (mark + wordmark + "Ops" badge), a thin violet line along the top of the window and an app-icon favicon with a violet dot (`public/`, generated from the kit's brand geometry).

Since then: the network of bridge asset ids in the 1Click `.omdep.near` and `1cs_v1:` shapes is named through the spec's `parseAssetId`. Current pins (`package.json`): `@nearpay-money/spec` 0.5.2, `@nearpay-internal/spec` 0.2.0, `@nearpay-internal/ui` 0.5.0.

## Built with

- Runtime: React 19, zod 4, `@nearpay-money/spec` and `@nearpay-internal/spec` (contracts), `@simplewebauthn/browser` (operator passkeys), `@nearpay-internal/ui` (Instrument Sans via `@fontsource-variable/instrument-sans`, OFL).
- Development: Vite, TypeScript, Biome, Vitest, Playwright; the image is an unprivileged nginx serving the build.
- Licence: Apache-2.0 (`LICENSE`).

Code and documentation are written with AI assistance (Claude) under human direction and review. Built for the NEAR Hackathon (Nov 2026).
