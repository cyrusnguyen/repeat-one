# RepeatOne 2.0

Describe a recurring browser task once. Opus inspects the real page and proposes a structured workflow. You approve it, and Playwright runs it in an isolated Chromium context. When the page UI changes and a step's target disappears, a bounded Opus investigation proposes a new locator. The engine validates it, applies it only under policy (or with your approval), and re-verifies the original business outcome. Every run keeps its evidence.

This is a **local, single-user Build Day demo**. It has not been reviewed for automating authenticated or third-party websites.

## Prerequisites

- Node.js 22+ (tested on 24.21)
- pnpm 10 (`corepack enable`, or prefix commands with `corepack pnpm`)
- An Anthropic API key with access to `claude-opus-5-5` (needed for planning and AI recovery; everything else runs without it)

## Setup and start

```bash
pnpm install                          # also runs prisma generate
pnpm exec playwright install chromium
cp .env.example .env                  # then set ANTHROPIC_API_KEY
pnpm db:push                          # creates data/repeatone.db
pnpm build && pnpm start              # http://localhost:3000  (or: pnpm dev)
```

The demo invoice portal is served by the same app at `http://localhost:3000/demo/invoices`.

Reset demo data (database and artifacts): `pnpm demo:reset`. The portal UI variant lives in server memory and returns to Classic on restart.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test        # unit tests + engine integration tests (real Chromium, scripted proposer)
pnpm build
pnpm test:e2e    # real app on :3100, real Chromium; needs `pnpm build` first
```

The default E2E run never calls Opus: the test server gets an empty key, so it is free and deterministic. To also run the live-model tests (`planning.spec.ts`, the live recovery test), set `E2E_LIVE=1` with a key in `.env`; this spends a small amount on model calls. App server output goes to `data/e2e-server.log`.

## Architecture

The core rule: **Opus proposes, the engine decides.**

| Module | Responsibility |
| --- | --- |
| `src/lib/planner.ts` | Opus tool loop over read-only browser tools (`navigate`, `observe`, `extract`) that ends in a Zod-validated `propose_workflow`. Plans are checked against the live page (selector syntax, allowlist, destructive targets) and must include assertions. |
| `src/lib/runner.ts` | Executes the approved, versioned definition snapshot. Typed state machine (`src/lib/state.ts`) with compare-and-set status updates. Records attempts, failures, evidence and a checkpoint row after each verified step. Enforces cancellation, hard timeout, max steps and recovery budget. |
| `src/lib/recovery.ts` | Triggered only by a `LocatorError` (target missing or ambiguous). Opus sees the failed step, the error, the success checks and a bounded page observation, and may only return a new selector or `no_safe_repair`. The engine keeps action, value and assertions fixed, then validates the target (exactly one visible element of the right kind, non-destructive, permitted origin, not the stale selector). Policy: read-only steps (fill/select/wait/extract) auto-apply; click/download repairs, low confidence, or the "ask" policy need human approval. |
| `src/lib/browser.ts` | Playwright adapter. One Chromium + context per run. Every request is checked against the URL-prefix allowlist at the network layer (`context.route`), so navigation, redirects, XHR and subresources outside scope are aborted. Destructive labels and password fields are refused. |
| `src/lib/checks.ts` | Deterministic postconditions over extracted table and downloaded CSV: `rowCount`, `everyRow`, `csvMatchesTable`, plus `visible`. A click or a model claim never marks success. |
| `src/lib/demo-portal.ts` | Demo-only invoice portal with variants: **Classic**, **Redesigned** (new ids, labels and structure for the amount field and apply button; same data and semantics), **Export removed** (no safe equivalent exists). |
| Prisma (SQLite) | `Workflow` (versioned definition + approval), `Run` (definition snapshot, inputs, step log, checks, usage), `Repair` (failure, proposal, validation, decision, outcome), `Checkpoint`. |

Security notes:

- The model never receives env vars, cookies or headers. Page text is wrapped as untrusted data and capped in size. Logs and tool results go through basic redaction.
- The demo page contains a prompt-injection message. The allowlist and action guard are enforced in tools, not prompts.
- POST endpoints require `application/json`, so other sites in your browser cannot trigger runs on localhost (forced CORS preflight).
- The variant toggle (`/api/demo/variant`) sits outside the browser allowlist, so a run cannot flip it.

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (none) | Server-side only. Needed for planning and recovery. |
| `DATABASE_URL` | `file:../data/repeatone.db` | SQLite file (relative to `prisma/`). |
| `ALLOWED_URL_PREFIXES` | `http://localhost:3000/demo/` | Comma-separated origin + path prefixes the browser may load. |
| `MAX_MODEL_CALLS` / `MAX_PLAN_COST_USD` | `12` / `1.00` | Ceilings per plan and per run. Cost is an estimate at list price. |
| `MAX_RUN_STEPS` / `RUN_TIMEOUT_MS` | `30` / `180000` | Per-run step limit and hard deadline (paused while waiting for a human). |
| `MAX_RECOVERY_ATTEMPTS` | `3` | Recovery attempts per run. |
| `APPROVAL_TIMEOUT_MS` | `300000` | How long a run waits for a repair decision. |
| `HEADLESS` | `true` | Set `false` to watch Chromium. |

## Known limitations

- Repairs apply to a single run. They are not written back into the saved workflow (adopting a repair as a new version is future work).
- The destructive-action guard is label-based (`shortcut:` comment in `src/lib/safety.ts`). It is fine for the fixture, not a policy for real sites.
- Process-crash continuation is **not** implemented. A run whose worker vanished is reported as failed ("Interrupted") on the next read, with steps up to the last checkpoint verified. A retry is a new run. There is no exactly-once guarantee for arbitrary websites; MVP workflows are read/filter/export only.
- One active run per workflow, enforced in-process (single local Node process).
- Planning is a synchronous request (typically under a minute). The UI shows elapsed time but not streamed progress.

## Two-minute demo script

Before you start: `.env` has a key, the app runs on `http://localhost:3000`, and the top bar shows **Demo portal: Classic**.

1. **(0:00) Plan.** Click **+ New workflow**, then **Fill demo example** (task "Export unpaid invoices above a minimum amount to CSV", input `minimumAmount` = 1000). Click **Propose a plan**. Opus reads the real portal and proposes steps. Point out **Success means** (the checks), the plain-language steps and "What Opus looked at". Click **Preview** to see each step's target outlined on the live page; it is read-only, so nothing runs before approval.
2. **(0:30) Approve and run.** Click **Approve plan**, then **Run workflow** with 1000. The headline reads "Running step N of M" while the stage strip and step list fill in, then "Verified · 9 rows exported". Click a step to open its evidence drawer; **Download CSV** sits under the steps.
3. **(0:55) Break the UI.** Switch **Demo portal** in the top bar to **Redesigned**. Open the portal in a tab to show the amount field and button were renamed and restructured.
4. **(1:05) Replay with recovery.** Back on the workflow, set `minimumAmount` to 3000 and click **Run again**. The amount step fails for real ("Element not found: #min-amount", with a failure screenshot), the Break stage turns red and Repair turns gold. Opus proposes `#amount-floor` and the engine applies it automatically (read-only fill). The apply step fails next; Opus proposes `#refresh-results`, and because it is a click the run pauses: the headline asks "Your decision: approve this repair?" and the evidence drawer opens on that step with the before/after selector, Opus's reasoning, the engine checks and the policy reason. Click **Approve repair**.
5. **(1:35) Verified result.** The headline reads "Repaired and verified · 4 rows exported", every original check passed, and Verify is green. Refresh the page: status, repairs and evidence all come from the database. Both runs remain under Recent runs on the workflow.
6. **(1:45) Safe stop.** Switch to **Export removed** and click **Run again**. The export step fails, Opus finds no equivalent control, and the headline reads "Stopped safely: ...". No CSV is produced and nothing is guessed.

Without a key, steps 1 and 4 cannot use Opus. Recovery then fails truthfully with "ANTHROPIC_API_KEY is not set". The E2E suite covers that path too.
