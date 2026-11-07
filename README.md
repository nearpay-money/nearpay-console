# nearpay-console

> Internal operations: merchant review, KYB, compliance cases, screening hits, execution explorer, verification holds, audit log.

|                                       |                                            |
| ------------------------------------- | ------------------------------------------ |
| Group                                 | Frontends                                  |
| Kind                                  | static SPA (internal)                      |
| Ships as                              | ops.nearpay.money behind Cloudflare Access |
| Owns                                  | — (stateless)                              |
| Depends on (published artifacts only) | spec (internal ops scopes), gateway        |
| First built in                        | Stage 2 (step 2.3)                         |

## Documentation

This repo stays surgical: design docs live in [`nearpay-brain`](../nearpay-brain/README.md), not here.

- `nearpay-brain/lld/dashboard-and-console.md` — **low-level design (dev-ready; implement from this)**
- `nearpay-brain/lld/audits/dashboard-and-console.md` — audit findings already folded into the LLD
- `nearpay-brain/roadmap/development-plan.md` — stage and step this repo is built in
- `nearpay-brain/architecture/hld.md` — system design
- `nearpay-brain/architecture/repositories.md` — repo topology and dependency rules
- `nearpay-brain/architecture/security.md`

## Layout

```
nearpay-console/
├── src/
│   ├── app/            shell, routing, session/expiry, step-up dialog
│   ├── features/       overview, merchants, kyb, cases, blocklist, holds (executions + review),
│   │                   refunds, sentinel, reconciliation, audit, auth (sign-in, enrolment)
│   ├── lib/            API client (OPS_ROUTES only), errors, session, permissions, formatting,
│   │                   assets, reconciliation maths + CSV, review checks
│   └── ui/             console building blocks the kit does not have yet
├── test/
│   ├── unit/           Vitest (coverage gate ≥ 90 % branches/lines on src/lib)
│   └── e2e/            Playwright against an in-process, spec-validating mock of OPS_ROUTES
├── deploy/             nginx site + headers for the image
├── Dockerfile          Vite build → unprivileged nginx
└── .github/workflows/  ci.yml (pnpm verify, dist artefact, image build)
```

## Develop

```sh
pnpm install            # @nearpay/* and @nearpay-internal/* from the local registry (.npmrc)
pnpm dev                # Vite; /api is proxied to https://ops.nearpay.localhost (Compose stack)
pnpm verify             # typecheck, Biome, unit + coverage, build, Playwright (system Chrome)
NP_SHOTS_DIR=/tmp/shots pnpm e2e screens   # 1440/390 screenshots of every main screen
```

- Strict CSP in `index.html` (no `unsafe-inline`, no `unsafe-eval`, no third-party origins); `src/zod-csp.ts` keeps zod from probing `new Function`.
- Session, CSRF token and every fetched object live in memory only — nothing is written to web storage.

## Status

Stage 2 (step 2.3): all console pages from the LLD on `@nearpay-internal/ui` 0.2.0 and `@nearpay-internal/spec` 0.2.0.

## Built with

Libraries are listed here as they are added (hackathon rule Q-005): React 19, Vite, TypeScript, zod 4, `@simplewebauthn/browser`, `@nearpay-internal/ui` (DM Sans via `@fontsource-variable/dm-sans`, OFL), Biome, Vitest, Playwright. Code and documentation are written with AI assistance (Claude) under human direction and review.
