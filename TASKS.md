# RepeatOne 2.0 - Build Day tasks

`[x]` done and verified, `[~]` built, not yet verified, `[ ]` open, `[!]` blocked. Refs point at `RepeatOne2_SPEC.md` §4.

## Carried over from v1 (built, verify under v2)
- [~] Next.js + pnpm + Prisma/SQLite + Zod + Vitest + Playwright scaffold; lint, typecheck, unit tests, build pass
- [~] Opus planner over read-only tools, validated `propose_workflow`, plan approval gate [4.1]
- [~] Browser tools with network-layer allowlist, destructive-label guard, password guard, redaction [4.5]
- [~] Deterministic runner with assertions, CSV artifact, screenshots, cancel, timeout, max steps [4.2]

## v2 vertical slice
- [ ] Demo portal as server route with UI variants (classic / redesigned / export removed) + toggle API [4.3]
- [ ] Typed run state machine incl. `recovering`, `needs_approval`; illegal transitions rejected in DB update [4.2]
- [ ] Workflow versions + per-run definition snapshot; checkpoint row after each verified step [4.1, 4.4]
- [ ] Step records: attempts, timestamps, observation, assertion, evidence id [4.2]
- [ ] Recovery: locator failure -> bounded Opus proposal (selector only) -> engine validation -> policy (auto for read-only, ask for click/download) -> retry -> original assertions [4.3]
- [ ] Repair records + approve/reject API (stale decisions rejected) + approval timeout [4.3, 4.4]
- [ ] Budgets: max recovery attempts, max model calls / cost per run, observation size cap [4.2, 4.5]
- [ ] UI: variant toggle, success criteria, recovery panel (failure, proposal, validation, decision, retry, result) [§3, 4.3]

## Verification
- [ ] Unit: state transitions, repair validation/policy, budgets, plus existing safety/checks/schemas
- [ ] Integration (real Chromium, scripted proposer, labeled): auto repair verified, invalid/stale proposal, budget exhausted
- [ ] E2E: approve -> run -> CSV -> reload -> replay new input; rejected plan; unsafe origin/redirect; destructive click; unrecoverable stop
- [!] E2E with live Opus: plan + recovery on redesigned UI (needs `ANTHROPIC_API_KEY`) [4.6]
- [ ] Inspect rendered UI (console errors, contrast, dead controls)
- [ ] README: setup, architecture, env, limitations, demo reset, 2-minute demo script
- [ ] Ponytail review, fixes re-tested
