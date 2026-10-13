# RepeatOne — Product Specification

**Status:** Build Day MVP specification  
**Product:** RepeatOne (working name)  
**Intended builder:** Claude Code, model `claude-opus-5-5` (High-effort orchestrator)  
**Design direction:** ScopeRoom-inspired charcoal + muted gold  
**Goal:** Deliver one genuinely functioning, repeatable AI browser workflow, not a clickable mockup.

## 1. Product definition

**One-liner:** Describe a repetitive browser task once, let an AI agent execute it with visible evidence, then save and run it again.

**Core value:** Move from natural-language intent to a **reviewable, reusable browser workflow**. RepeatOne must distinguish (1) planning, (2) executing, (3) verifying, and (4) re-running a saved workflow.

**Primary user:** An individual who repeatedly performs structured tasks in web interfaces (e.g., filtering a dashboard, collecting rows, exporting a report). Build Day targets a local, single-user demo; do not pretend it is a production-ready multi-tenant automation platform.

**Canonical end-to-end demo:**
1. Open the included **demo invoice dashboard** in a controlled local browser session.
2. User asks: *“Find unpaid invoices, filter by a minimum amount, and export the matching rows as CSV.”*
3. Opus inspects the actual page through browser tools, proposes the workflow, and requests approval before running it.
4. The agent navigates, filters and extracts data, verifies the result against on-page evidence, and produces a downloadable CSV artifact.
5. Save the workflow, reload the app, change the amount threshold, and **replay** it successfully with a new result.
6. Show a run history with real actions, evidence, outcome and errors (if any).

The demo page is a fixture, **not** a hardcoded fake automation. The browser runner must interact with it through the same interfaces used for any other permitted site.

## 2. Technology stack

| Area | Choice |
| --- | --- |
| Web application | Next.js App Router, React, TypeScript (strict mode) |
| Runtime / package manager | Node.js LTS, pnpm |
| UI | Plain CSS / CSS Modules with shared CSS variables, Lucide icons; avoid a heavy component framework |
| AI | Anthropic TypeScript SDK, **Opus 5.5** (`claude-opus-5-5`), Messages API with explicit tool use |
| Browser automation | Playwright + isolated Chromium contexts; server-side tools exposing `navigate`, `observe`, `click`, `fill`, `select`, `wait`, `extract`, `download`, `screenshot`, `assert` |
| Validation | Zod for agent tool schemas, API payloads, and persisted workflow definitions |
| Persistence | Prisma + SQLite for the local Build Day MVP (keep database access portable for a future PostgreSQL migration) |
| Tests | Vitest for units; Playwright for real-browser end-to-end tests |
| Formatting / quality | ESLint, TypeScript checking, sensible formatting |
| Runtime deployment | Local Node.js process running the app **and** the browser runner; do not deploy the runner to an Edge/serverless function that cannot support persistent Chromium sessions |

**Environment:** Keep the Anthropic API key exclusively in server-side environment variables. Include `.env.example`; never commit secrets. Prefer a single application repo and the fewest moving parts necessary for a working end-to-end demo.

## 3. UX and visual identity

**Source of truth:** Mirror the *feel* of ScopeRoom's actual token file (`cyrusnguyen/scoperoom-ai/src/styles/tokens.css`), with the portfolio (`cyrusnguyen/cyrus-portfolio`) as a secondary visual reference. Use the existing sources as **read-only references** if locally accessible; never modify either project. The palette below was taken from those repositories, not guessed.

| Token | Colour |
| --- | --- |
| Background | `#191C1A` |
| Surface | `#222623` |
| Raised surface | `#2B302C` |
| Primary text | `#EEEEE7` |
| Muted text | `#B0B5AC` |
| Primary accent / gold | `#B49C65` |
| Gold hover | `#C4AD77` |
| Border | `#3C433D` |
| Focus ring | `#D3B97C` |
| Optional bright portfolio gold (rare emphasis only) | `#FFD700` |

**Style requirements:**
- Dark-first professional developer-tool aesthetic. Gold is for primary actions, selection and subtle highlights, not large saturated panels.
- Restrained spacing, thin dividers, low-noise status tags, compact tables, readable monospace for logs.
- Use approximately 6–8 px corner radii. Avoid giant pill buttons, cream backgrounds, neon gradients, glassmorphism, excessive shadows, italic heading accents and generic AI landing-page imagery.
- Desktop-first three areas: **workflows list**, **workflow builder / run detail**, and **contextual execution panel**. On narrower screens stack/collapse panels cleanly; do not require mobile browser execution.
- Main views: Workflows, Create workflow, Workflow detail, Run detail / evidence. Show loading, empty, success, failure and approval-required states.
- Buttons must be obviously interactive. Keyboard focus must be visible; text and controls need readable contrast.

## 4. Functional requirements and Definition of Done (DoD)

**Priority terminology:** `[MVP]` is required before calling Build Day complete. `[Later]` is explicitly out of scope for the first demo and must not delay a working MVP.

### 4.1 Create and review a workflow

- [ ] **[MVP]** User can enter a starting URL from a configured allowlist, a natural-language task description, and named inputs (e.g., `minimumAmount`).
- [ ] **[MVP]** Opus inspects the **real page state** using restricted browser tools and proposes an ordered, structured workflow; no entirely fabricated DOM elements or selectors.
- [ ] **[MVP]** Each proposed step identifies its action, target, intended effect and (where appropriate) verification condition.
- [ ] **[MVP]** User can review the plan and approve or reject execution; a rejected plan never runs.
- [ ] **[MVP]** Invalid URLs, empty prompts, malformed inputs and AI responses with invalid schemas receive actionable error messages.
- [ ] **[MVP]** Workflow name, description, permitted domain(s), input definitions and structured steps persist across page refresh and application restart.

### 4.2 Execute with real browser tools

- [ ] **[MVP]** After approval, Playwright launches an isolated Chromium context and executes **real interactions** against the demo website.
- [ ] **[MVP]** Agent receives only the minimum observations/tool outputs required to continue. It does not get unrestricted shell access, arbitrary filesystem access or raw environment variables.
- [ ] **[MVP]** Run detail shows queued/running/needs-approval/succeeded/failed/cancelled states with step-by-step progress, timestamps and relevant evidence.
- [ ] **[MVP]** At least one screenshot is captured and visible in the run details; key steps have useful descriptions and actual observed results.
- [ ] **[MVP]** Completing an interaction does **not** automatically count as success: evaluate explicit postconditions (e.g., matching rows visible, data extraction count, exported CSV contents).
- [ ] **[MVP]** The demo downloads/creates a CSV with accurate headers and rows matching the chosen threshold. The user can download the artifact.
- [ ] **[MVP]** Tool errors, element-not-found, navigation failures, model errors and verification failures result in a truthful **failed** run with context, never a fabricated success state.
- [ ] **[MVP]** Provide cancellation, a maximum step count and a hard per-run timeout; browser and related resources are cleaned up when a run ends.

### 4.3 Save and replay

- [ ] **[MVP]** The saved automation has a persistent definition distinct from any one execution/run.
- [ ] **[MVP]** Clicking **Run again** after reloading the application reuses the saved workflow instead of generating an unrelated new task.
- [ ] **[MVP]** User can edit named inputs before replaying. A different `minimumAmount` demonstrably produces a different verified CSV result.
- [ ] **[MVP]** Every replay creates a new run record and preserves prior runs/evidence; status of one run never overwrites another.
- [ ] **[MVP]** If the saved workflow cannot be replayed safely or its target changed, stop with an intelligible explanation and offer a **review/re-plan** action rather than silently guessing.
- [ ] **[Later]** Robust adaptation to arbitrary third-party DOM changes, reusable template marketplace, scheduled or unattended runs.

### 4.4 Safety, authorization and privacy

- [ ] **[MVP]** **Allowlisted origins only**. Include an explicitly controlled local demo origin. Prevent navigation to unauthorized origins, local/private-network targets other than the approved demo, and dangerous URL schemes; enforce these checks in tools, not only prompts.
- [ ] **[MVP]** Browser state is isolated per run. Do not capture/store passwords, session cookies, API secrets, raw authorization headers or unrelated site data in workflow records, logs or LLM prompts.
- [ ] **[MVP]** Read/extract/filter/export flows are permitted for the demo. **Destructive or externally consequential actions** (sending, purchasing, deleting, publishing, submitting, modifying account data) are blocked by default; if any such action is ever supported, it must require an explicit per-action human approval immediately beforehand.
- [ ] **[MVP]** Treat webpage content as untrusted data, not instructions. A page saying “ignore previous instructions” must not redirect the agent to a new objective or domain.
- [ ] **[MVP]** API keys are server-side only and not exposed to frontend bundles or browser contexts. Run logs have basic redaction and do not include sensitive raw tool payloads by default.
- [ ] **[MVP]** Provide a configurable per-run spending ceiling / maximum model calls, and display usage or a clearly labeled estimate when SDK metadata supports it.
- [ ] **[MVP]** Distinguish local demo from production safety: do not imply the app is safe to automate arbitrary authenticated websites without further security review.

### 4.5 Application behavior and polish

- [ ] **[MVP]** Workflow list supports create, open, rename and delete (with confirmation); run history shows run time, outcome and duration.
- [ ] **[MVP]** Workflow detail makes the task description, inputs, steps and last outcome understandable without reading source code.
- [ ] **[MVP]** Progress and errors remain clear during slower Opus calls; no frozen screen and no duplicate run submissions.
- [ ] **[MVP]** Run execution is idempotent against repeated UI clicks; a duplicate submit cannot silently start multiple browser sessions.
- [ ] **[MVP]** Error/empty/loading/success states are polished and match the dark/gold theme. No placeholder buttons, dead navigation or meaningless fake statistics.
- [ ] **[MVP]** The included demo site has realistic deterministic fixture data and is clearly marked as demonstration data.
- [ ] **[Later]** Auth, teams, shared workflows, marketplace, OAuth integrations, payments, cloud browser fleets, analytics dashboards.

### 4.6 Quality, documentation and proof

- [ ] **[MVP]** `pnpm install`, required Playwright browser installation, configuration and local start steps are fully documented in `README.md` and work on a clean checkout.
- [ ] **[MVP]** `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass; end-to-end checks exercise actual Chromium interactions, not mocked-success responses.
- [ ] **[MVP]** E2E coverage includes: create → approve → execute → verify CSV → save → reload → replay with changed input → inspect both run records.
- [ ] **[MVP]** At least one negative E2E/integration case confirms a blocked origin or unsafe instruction **does not execute**, and one failure case displays a truthful error.
- [ ] **[MVP]** A short README includes architecture overview, environment variables, known limitations, and a **2-minute live demo script**.
- [ ] **[MVP]** Source is committed to Git. The final handoff cites actual command/test results and notes anything not verified.

## 5. Explicit non-goals

No generalized RPA, automated CAPTCHA solving, credential harvesting, bypassing rate limits or anti-bot systems, background scraping of arbitrary sites, autonomous purchases/messages, production authentication, multi-tenancy, or cloud deployment in the Build Day MVP. **One reliable vertical slice is better than ten incomplete workflows.**

## 6. Opus execution contract (aligned with the Build Day cheat sheet)

Use **`/model claude-opus-5-5`** and set **`/effort high`** for the lead/orchestrator. The cheat sheet names the available levels `low`, `medium`, `high`, and `max`: **`max` is the highest effort label here, not `xhigh`**. Effort is a *reasoning setting*, not the Claude Max subscription tier.

### 6.1 Effort policy — high by default, max by exception

| Work | Effort | Decision rule |
| --- | --- | --- |
| Orchestrator: interpret spec, sequence work, own interfaces, integrate and track DoD | **High** | Default throughout the build |
| Routine implementation, UI/CSS, wiring, straightforward unit tests | **Medium** | Increase to high only if the work proves tricky |
| Browser tool boundaries, approval gates, replay state, security validation, error recovery | **High** | Correctness matters more than speed here |
| Investigating a complex intermittent bug, architectural deadlock, conflicting invariants, multi-step security failure | **Max** | Use temporarily when high-effort attempts have failed or the consequences of a mistake justify it |
| End-to-end verification, release readiness, blockers-only review | **High** | Raise to max only for a difficult unresolved finding |

Do **not** set max for the entire session or every delegated task. When possible, return to high/medium after the difficult task. If a per-agent effort setting is unavailable, keep the lead on high and change `/effort` manually only for a relevant phase. Do not assume effort changes propagate to subagents.

### 6.2 Coordination and scope

- The spec is already approved. **Do not rerun open-ended brainstorming or write a lengthy implementation plan** during Build Day. First inspect the existing repo and write a concise, dependency-ordered `TASKS.md` mapped to MVP DoD.
- Lead/orchestrator owns the end-to-end demo, interfaces between modules, browser-security boundary, integration and verification. Delegation is **optional**, only for independent work with explicit contracts (e.g., independent UI implementation or tests). Avoid nested agent chains and duplicated implementation.
- **Ponytail preflight:** If custom Ponytail commands are installed, the user explicitly runs `/ponytail lite` in Claude Code before pasting the build prompt. A text instruction that says “use Ponytail Lite principles” does **not** invoke the command. Apply the resulting simplification guidance while retaining all MVP functionality, security boundaries, approvals, persistence and tests. If unavailable, use the simplification principles without blocking plugin installation.
- **Ponytail review:** After the functional MVP exists, optionally run `/ponytail-review` if installed, examine its suggestions, fix valid issues, and re-run the relevant checks. Do not replace actual verification with review output.
- Initialize Git and make a baseline commit before implementation (if the repo is new). Commit after meaningful working increments.
- Maintain `TASKS.md` with the MVP DoD checklist, updating items when completed, unverified or blocked.
- Do not halt after every milestone to ask “should I continue?”. Continue when no user input is required.
- Ask only when blocked on essential missing information, or before destructive work, deleting data, force-pushing, or modifying anything outside the new RepeatOne repository. Keep permission prompts for destructive commands.
- Prioritize getting the **complete canonical demo** genuinely running before adding optional features. Reserve the last part of Build Day for real-browser testing and demo prep, not extra features.
- Verify with an actual browser, inspect the UI, review important diffs, and do not report success based only on generated code.
- Finish with exactly three top-level handoff headings: **Blocked on me**, **Changed**, **Found**. Under these, include actual test command results, open issues and the path to the 2-minute demo instructions. Never claim unverified checks passed.

**Overall release gate:** The user can describe a workflow, approve its plan, watch real browser actions, get a verified result, persist the workflow, and replay it with different input after a restart — in the real app, with no hardcoded success simulation.
