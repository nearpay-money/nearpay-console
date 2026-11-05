# nearpay-console

> Internal operations: merchant review, KYB, compliance cases, screening hits, execution explorer, verification holds, audit log.

| | |
|---|---|
| Group | Frontends |
| Kind | static SPA (internal) |
| Ships as | ops.nearpay.money behind Cloudflare Access |
| Owns | — (stateless) |
| Depends on (published artifacts only) | spec (internal ops scopes), gateway |
| Roadmap phase | P1 Core payments |

## Documentation

This repo stays surgical: design docs live in [`nearpay-brain`](../nearpay-brain/README.md), not here.

- `nearpay-brain/architecture/hld.md` — system design
- `nearpay-brain/architecture/repositories.md` — repo topology and dependency rules
- `nearpay-brain/architecture/security.md`

## Layout

```
nearpay-console/
├── src/
│   ├── features/
│   │   ├── audit/
│   │   ├── cases/
│   │   ├── executions/
│   │   ├── holds/
│   │   ├── kyb/
│   │   └── merchants/
│   └── lib/
├── test/
└── .github/
    └── workflows/
```

## Status

Scaffold only. Implementation starts in phase **P1 Core payments** (`nearpay-brain/roadmap/roadmap.md`).
