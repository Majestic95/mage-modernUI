# webclient

Modern React + TypeScript front-end for the Mage WebApi. Phase 4 work.
The first slice (this scaffold) only confirms the toolchain is wired;
real screens (login, lobby, card library) land in subsequent slices.

## Stack

Locked in [ADR 0002](../docs/decisions/0002-tech-stack.md):

- **React 19** + **TypeScript 6** (strict mode, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`)
- **Vite 8** for dev server + bundling
- **Tailwind CSS v4** via the `@tailwindcss/vite` plugin
- **Zustand 5** for client state
- **Zod 4** for runtime validation of every WebSocket / REST payload
- **Vitest 4** + **Testing Library** for tests
- **ESLint 10** flat config

Tauri v2 desktop wrap is deferred to Phase 7.

## Prerequisites

- Node 20+ (24.14.0 verified)
- pnpm (install via `npm install -g pnpm` if Corepack lacks permission
  to write to `C:\Program Files\nodejs`)

## Scripts

```bash
pnpm install        # install deps
pnpm dev            # Vite dev server on http://localhost:5173
pnpm build          # production build to dist/
pnpm preview        # preview the production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint flat-config
pnpm test           # vitest run (one-shot)
pnpm test:watch     # vitest watch mode
pnpm test:ui        # vitest UI
pnpm check          # typecheck + lint + test
```

## Talking to the WebApi

Default backend: `http://localhost:18080`. The WebApi is the Java module
at [`Mage.Server.WebApi/`](../Mage.Server.WebApi/) — boot it via
`pnpm` ... actually no, it's a Java jar; see
[`docs/dev-setup.md`](../docs/dev-setup.md). Real wiring (login + WS)
lands in the next slice.

## Layout

```
webclient/
├── src/
│   ├── main.tsx          # React entry point
│   ├── App.tsx           # placeholder root component (scaffold only)
│   ├── App.test.tsx      # scaffold smoke test
│   ├── index.css         # Tailwind import + project-wide vars
│   └── setupTests.ts     # Vitest + Testing Library bootstrap
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.ts        # Vite + Vitest config
├── tsconfig.app.json     # strict TS settings
├── eslint.config.js      # ESLint flat config
├── package.json
└── pnpm-lock.yaml
```

## Conventions

Per [CLAUDE.md](../CLAUDE.md):

- No `any` (use `unknown` and narrow, or define proper types)
- No default exports except React components and the Vite-required entry
- Functional components only
- 400-line soft cap, 500-line hard cap per source file
- Test files mirror source paths: `App.tsx` → `App.test.tsx`
- Every WebSocket / REST payload parsed through a Zod schema before
  reaching component code
