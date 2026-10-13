# RepeatOne 2.0 - Build Day tasks

`[x]` done and verified, `[~]` built, not yet verified, `[ ]` open, `[!]` blocked. Refs point at `RepeatOne2_SPEC.md` §4.

## Foundation
- [x] Next.js + pnpm + Prisma/SQLite + Zod + Vitest + Playwright; lint, typecheck, test, build pass
- [~] Opus planner over read-only tools, validated `propose_workflow` [4.1] (code path built, never called live: no key)
- [x] Plan approval gate, rejection runs nothing (E2E) [4.1]
- [x] Browser tools: network-layer allowlist, redirect containment, destructive and password guards, redaction [4.5]

## v2 vertical slice
- [x] Demo portal route with variants (classic / redesigned / export removed) + toggle API [4.3]
- [x] Typed run state machine incl. `recovering`, `needs_approval`; compare-and-set transitions [4.2]
- [x] Workflow versions + per-run definition snapshot; checkpoint row after each verified step [4.1, 4.4]
- [x] Step records: attempts, timestamps, observation, failures with evidence [4.2]
- [x] Recovery engine: locator failure -> proposal -> engine validation -> policy -> retry -> original assertions (real browser, scripted proposer) [4.3]
- [~] Recovery with live Opus proposer [4.3] (code path built and fails truthfully without a key)
- [x] Repair records + approve/reject API, stale decisions rejected, approval timeout [4.3, 4.4]
- [x] Budgets: recovery attempts, model calls/cost, observation size cap, run timeout, max steps [4.2, 4.5]
- [x] UI: variant toggle, success criteria, recovery panel, approval buttons; inspected at 1440 and 760 px, no console errors [§3, 4.6]

## Verification
- [x] Unit: state transitions, safety, checks, schemas (24 tests)
- [x] Integration, real Chromium + scripted proposer: auto repair, approval, rejection, destructive/stale/invalid proposals, budget exhausted, unrecoverable, no-key (9 tests)
- [x] E2E, real app + Chromium: approve -> run -> CSV -> reload -> replay; duplicate submit; rejected plan; blocked origin/link/redirect; destructive click; failed postcondition; cancel; form errors; changed UI without key; export removed (15 pass, incl. CSRF guard)
- [!] E2E with live Opus: planning + recovery (2 tests skip; needs `ANTHROPIC_API_KEY` in `.env`) [4.1, 4.3, 4.6]
- [!] Prompt-injection check against live Opus [4.5] (tool-level blocking verified; model behaviour not)
- [x] README: setup, architecture, env, limitations, demo reset, 2-minute demo script
- [x] Ponytail review: 5 findings fixed (JSON guard on cancel/re-plan, observe redaction, shared test plan, CSRF test, sidebar reconcile); gate re-run green
