# RepeatOne 2.0 — Product Specification

**Status:** Approved concept / Build Day MVP spec  
**Product:** RepeatOne 2.0 — Resilient AI Workflow Engine  
**Builder:** Claude Code with Claude Opus 5.5 (`claude-opus-5-5`)  
**Objective:** Ship a real, locally runnable browser workflow that detects a failure, uses bounded AI-guided recovery, verifies the outcome, and retains evidence. This is **not** a prompt-to-Playwright-script generator.

## 1. Product and differentiator

**One-liner:** Describe a recurring web task; RepeatOne executes it, detects unexpected UI failures, repairs the plan where safe, and proves whether the task finished correctly.

**Engineering thesis:** Separate **agent reasoning** from **deterministic orchestration**. Opus proposes plans or recovery actions; the engine owns validation, permissions, workflow state, retries, checkpoints, outcome assertions, and persisted history. A successful click is not a successful workflow.

**Primary user:** A developer or operations user automating read-only, structured tasks in permitted web applications. Build Day is **single-user, local-first, controlled-demo only**.

**Canonical demo (non-negotiable):**
1. Open the bundled local **invoice portal** with searchable/filterable invoice rows, unpaid status, and CSV export.
2. User asks: **“Export unpaid invoices above $X to CSV.”** Opus observes the page and prepares a structured workflow with explicit postconditions.
3. User approves. Playwright executes in a real isolated browser context, verifies filtered data, and saves a valid CSV artifact.
4. Modify the portal's UI using a **demo-only UI variant toggle** (e.g., change label/structure while preserving business semantics); replay the **saved** workflow with a different $X. A deterministic locator first fails, a bounded Opus recovery investigates the actual page, proposes a revised locator/action, and the engine verifies it before proceeding.
5. Show **what failed, what changed, why recovery was permitted, the step evidence, and final verified result**. Both runs remain available after refresh. Also demonstrate a failure that **cannot** be safely repaired and ends in a truthful blocked/failed state.

**Do not fake the recovery:** The same browser executor must perform the normal and repaired steps against the running fixture. UI variants are for test repeatability, not a way to send the model the answer.

## 2. Technology stack

| Area | Choice |
| --- | --- |
| App | Next.js App Router, React, strict TypeScript; Node.js LTS, pnpm |
| Styling | CSS Modules / plain CSS tokens, Lucide icons; no large UI framework required |
| AI | Anthropic TypeScript SDK, Messages API/tool use, **`claude-opus-5-5`** |
| Browser | Playwright + Chromium, isolated context per run; explicit validated browser-tool adapter |
| Orchestration | Small typed state machine + persisted step/run records; **not** Temporal or an unnecessary agent framework for MVP |
| Storage | Prisma + SQLite; store workflow definition separately from each run, steps, proposed repairs, and artifacts |
| Validation | Zod at API, tool, workflow and persistence boundaries |
| Testing | Vitest for state/permission/recovery logic, Playwright for real browser/E2E |
| Hosting | **Local Node.js process** and a locally hosted demo portal; no serverless/Edge browser runner |

Prefer **one repository** and a small number of cohesive services/modules. Use approved libraries before implementing custom browser machinery. Anthropic API key stays server-side in `.env` (provide `.env.example`).

## 3. UI/UX — ScopeRoom-inspired charcoal and muted gold

Use read-only references to [ScopeRoom tokens](https://github.com/cyrusnguyen/scoperoom-ai/blob/main/src/styles/tokens.css) and [portfolio styles](https://github.com/cyrusnguyen/cyrus-portfolio/blob/main/styles/globals.css). Do not edit either source repository.

| Token | Value |
| --- | --- |
| Background | `#191C1A` |
| Surface | `#222623` |
| Raised surface | `#2B302C` |
| Text | `#EEEEE7` |
| Muted text | `#B0B5AC` |
| Gold accent | `#B49C65` |
| Gold hover | `#C4AD77` |
| Border | `#3C433D` |
| Focus ring | `#D3B97C` |
| Portfolio bright gold (rare) | `#FFD700` |

**Design:** Minimal, precise developer tool; subtle borders, compact status chips, monospace logs, 6–8 px radii; gold for a **single important action or selection**, not large saturated surfaces. No cream background, giant pill buttons, neon gradient, glassmorphism, ornamental AI art, or italic marketing headings.

**Desktop layout:** Left = saved workflows / runs; center = selected workflow, step timeline, controls; right = evidence, AI investigation, change approval. Fold the right panel at narrower widths. Key screens: Workflows, Create, Workflow detail, Run/Recovery detail. Empty/loading/error/rejected/cancelled/succeeded states must be real.

## 4. Detailed Definition of Done

**`[MVP]` is necessary to claim Build Day complete; `[Later]` is optional and must not hold up the demonstration.**

### 4.1 Plan and save

- [ ] **[MVP]** User provides an approved local portal URL, natural-language task, and a named input `minimumAmount`.
- [ ] **[MVP]** Opus observes the actual page via restricted tools and outputs a validated structured plan: actions, inputs, safe preconditions and concrete postconditions. Invalid/unsupported output cannot reach the executor.
- [ ] **[MVP]** User reviews the plan and explicitly approves **before the first run**. Rejection creates no execution side effects.
- [ ] **[MVP]** Workflow definition is versioned and persists separately from runs; input substitution does not mutate past run records.
- [ ] **[MVP]** UI displays planned steps and which outcomes will count as success; errors on malformed inputs are actionable.

### 4.2 Real browser execution and verification

- [ ] **[MVP]** Playwright performs genuine navigation/filter/extraction against the local invoice portal; no prerecorded responses or model-generated fake rows.
- [ ] **[MVP]** Runtime records a typed run lifecycle: `queued → running → (needs_approval | recovering) → succeeded | failed | cancelled`; illegal transitions are rejected.
- [ ] **[MVP]** For every completed step record: attempt count, timestamps, tool/action, actual observation, assertion result and sanitized evidence ID. The UI exposes the real timeline.
- [ ] **[MVP]** Explicit, deterministic assertions validate visible unpaid rows, `minimumAmount` filtering, row count and generated CSV contents. A click, model claim, or navigation event alone cannot mark success.
- [ ] **[MVP]** Save and download a genuine CSV artifact. Replay after refresh with a different input yields a demonstrably different, correctly verified CSV.
- [ ] **[MVP]** At least one real screenshot is viewable in run details; failed runs retain relevant screenshots/step errors.
- [ ] **[MVP]** Cancellation, timeouts, max steps, max recovery attempts and max model calls prevent unbounded work; resources are closed on exit.

### 4.3 Safe AI-guided recovery — core differentiator

- [ ] **[MVP]** The demo-only portal can switch from a known working UI variant to an equivalent but changed variant without changing the intended invoice business outcome.
- [ ] **[MVP]** Replaying the saved plan against the changed UI produces a **real failure** (e.g., expected locator missing), recorded before the recovery attempt.
- [ ] **[MVP]** Recovery receives bounded **real browser observations + failed step + intended postcondition**. Opus returns a typed proposed repair, not free-form executable code.
- [ ] **[MVP]** Engine validates the proposal against allowed tools, permitted origin, expected action class, and original task. A repair cannot silently change business intent, data scope or required assertions.
- [ ] **[MVP]** For the controlled **read-only** locator repair, engine may continue with an approved/allowlisted safe fix after verifying the repaired step. Other actions, scope changes or uncertain consequences require explicit human approval.
- [ ] **[MVP]** UI shows **failure → proposed repair → approval if needed → retried step → verified result**, preserving the original failure evidence. Repair does not imply success until the original assertions pass.
- [ ] **[MVP]** Model cannot loop forever: bounded attempts; failed recovery/invalid model response becomes `failed` or `needs_approval` with reason. A case with an unavailable target must demonstrate this safe stop.
- [ ] **[MVP]** Replay is safe: verified read-only steps may be re-executed; external writes/submissions are disallowed, not blindly repeated. Document that MVP does **not** guarantee exactly-once execution for arbitrary websites.
- [ ] **[Later]** Durable restart-after-process-crash recovery, isolated worker leases, idempotency keys for supported write actions, backoff scheduling, workflow branching and sophisticated selectors/self-healing across arbitrary sites.

### 4.4 Checkpoints, audit and state integrity

- [ ] **[MVP]** Persist a checkpoint **after each verified step**, including workflow version, run ID, ordered step state, postcondition outcome, and last known sanitized evidence reference.
- [ ] **[MVP]** UI refresh during a run must not invent success; status is derived from persisted run records and clearly reports interruption if its worker vanished.
- [ ] **[MVP]** Any manual restart/retry is a **new auditable attempt** or validated step retry. Already exported CSV artifacts must not be silently duplicated by a refresh/retry action.
- [ ] **[MVP]** Run history and prior repair decisions survive application restart; each run has separate evidence and input values.
- [ ] **[MVP]** Tests cover illegal state transitions, duplicate run submissions, failed postconditions, stale/invalid repair plans, and exhausted recovery budget.
- [ ] **[Later]** True process-crash continuation with leased workers and state reconciliation. **Do not claim this exists until tested by killing/restarting the worker.**

### 4.5 Authorization, security and cost

- [ ] **[MVP]** Domain/origin allowlist is enforced **inside browser tools**; local demo origin explicitly permitted; block other loopback/private-network destinations, redirects outside scope, dangerous schemes and SSRF.
- [ ] **[MVP]** No payments, sending messages, publishing, deletion, purchases, account changes or external submission in MVP. Future side effects require narrowly defined permissions and fresh human approval.
- [ ] **[MVP]** Webpage content is untrusted **data**, not agent instructions. Test an injected “ignore instructions” string in the demo page and confirm it does not override task/tool permissions.
- [ ] **[MVP]** Per-run isolated browser contexts; never expose environment variables, cookies, auth headers, sensitive screenshots or API keys to model output/logs. Sanitize evidence and handle data retention conservatively.
- [ ] **[MVP]** Hard ceilings for run duration, AI iterations, prompt/tool payload size and optional token/cost budget; surface usage/estimated cost where reliable. Never assume workshop credit is unlimited.
- [ ] **[MVP]** All model/tool errors and denied actions have truthful UI states; no silent fallback to dummy automation.

### 4.6 Engineering and demo proof

- [ ] **[MVP]** Document prerequisites and exact local startup commands in README; `.env.example`, seed/demo reset and a two-minute demonstration script are included.
- [ ] **[MVP]** `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass; report any genuine blockers explicitly instead of claiming they passed.
- [ ] **[MVP]** At least one automated E2E exercises real browser automation, changed UI, a verified recovery, and output assertion. Tests also cover an unrecoverable scenario and rejected approval.
- [ ] **[MVP]** Verify the real Opus call when a valid key is available; a mock-only run **does not** satisfy the AI recovery DoD.
- [ ] **[MVP]** Actually inspect the rendered UI for dead controls, console errors, accidental light backgrounds, evidence links and contrast. Save an auditable Git commit after proven milestones.
- [ ] **[MVP]** Final report includes exactly **Blocked on me / Changed / Found**, clear test evidence, limitations and demo instructions.

## 5. Boundaries and future work

**Out of scope for Build Day:** Production credentials, arbitrary third-party websites, scheduled/unattended automation, background multi-tenant infrastructure, OAuth/RBAC, payments/actions with side effects, marketplace, Temporal, general event sourcing, arbitrary JavaScript generation/execution, and promises of crash-proof or exactly-once semantics.

**Optional 2+ weekend direction:** Isolate execution into workers; implement lease/heartbeat and crash-resume with idempotency safeguards; richer recovery policies and regression suites; permission-scoped read/write connectors; workflow diff/versioning; human approval queue; Postgres migration and observability.

## 6. Opus implementation contract

- **Approved concept:** Do not reopen general brainstorming. Inspect repo, validate environment and create only a short dependency-ordered `TASKS.md`. Start with one real end-to-end vertical slice.
- **Effort:** Lead/orchestrator **high**; routine implementation **medium** where supported; tough safety/state/recovery verification **high**, temporary **max** only for genuine hard blockers. Do not run all work at max effort.
- **Ponytail:** The operator may run `/ponytail lite` **as a separate Claude Code command if installed**; it is not activated merely by being mentioned in a prompt. Follow simplicity principles without removing safety, assertions, tests or persistence. Optional `/ponytail-review` after verified MVP, only if installed.
- **Scope control:** Favor standard Playwright, explicit Zod schemas and a small state machine; avoid agent swarms. Never build UI-only fake demos. Treat `[Later]` as nonblocking.
- **Autonomy:** Keep `TASKS.md` updated; ask only on real blockers or destructive/out-of-repo actions; retain permission checks. Commit after verified milestones. Reserve time for real E2E and demo rehearsal.

**References (read-only):** [Anthropic tool-use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works) · [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer-intro) · [ScopeRoom tokens](https://github.com/cyrusnguyen/scoperoom-ai/blob/main/src/styles/tokens.css).
