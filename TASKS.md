# RepeatOne - Build Day tasks

Dependency order. `[x]` done and verified, `[~]` built but not verified, `[ ]` open, `[!]` blocked.
Spec refs in brackets point at `RepeatOne_SPEC.md` §4.

## Foundation
- [ ] Scaffold Next.js (App Router, TS strict), pnpm, ESLint, Vitest, Playwright test, Prisma+SQLite, `.env.example`
- [ ] Demo invoice dashboard fixture at `/demo/invoices.html` (deterministic data, marked as demo) [4.5]

## Core modules (interfaces)
- [ ] `lib/schemas.ts` - Zod: inputs, steps, checks, workflow create; `{{input}}` templating [4.1]
- [ ] `lib/safety.ts` - URL allowlist (prefix + scheme), destructive-label guard, redaction [4.4]
- [ ] `lib/browser.ts` - isolated Chromium session, route-level origin blocking, tools: navigate/observe/click/fill/select/wait/extract/download/screenshot/assert [4.2]
- [ ] `lib/planner.ts` - Opus 5.5 tool loop over read-only tools → `propose_workflow`; max model calls, cost ceiling, usage [4.1, 4.4]
- [ ] `lib/runner.ts` - execute approved steps, postconditions, evidence, cancel, max steps, hard timeout, cleanup, one active run per workflow [4.2, 4.3, 4.5]

## API + UI
- [ ] API: workflows CRUD, plan/re-plan, approve/reject (server-enforced), runs, cancel, artifacts [4.1–4.3]
- [ ] UI: workflow list (create/open/rename/delete), create form, review/approve, run panel with editable inputs, run detail with evidence/CSV/screenshots, all states [4.5, §3]

## Verification
- [ ] Unit tests: allowlist, templating/inputs, checks, CSV parse, redaction, destructive guard, schemas [4.6]
- [ ] E2E (real Chromium): approve → run → verify CSV → reload → replay w/ new minimumAmount → both runs [4.6]
- [ ] E2E negative: blocked origin does not execute; destructive click blocked; missing selector → truthful failure + re-plan [4.6]
- [ ] E2E with live Opus planning (needs `ANTHROPIC_API_KEY`) [4.1]
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass
- [ ] README: setup, architecture, env vars, limitations, 2-minute demo script [4.6]
- [ ] Ponytail review pass; fixes re-tested
