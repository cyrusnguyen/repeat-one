import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Step } from "../src/lib/schemas";
import { canonicalSteps, db, DEMO, seedWorkflow, setVariant } from "./helpers";

const verify: Step = { action: "assert", check: { type: "rowCount", source: "table", min: 1 }, description: "Has rows" };

test.beforeEach(async ({ request }) => setVariant(request, "classic"));

async function runToEnd(request: APIRequestContext, steps: Step[]) {
  const id = await seedWorkflow("Safety case", steps, "approved");
  const res = await request.post(`/api/workflows/${id}/runs`, { data: { inputs: { minimumAmount: "1000" } } });
  expect(res.status()).toBe(200);
  const { runId } = await res.json();
  // Wait for an outcome or a pending human decision; queued/running/recovering are still in progress.
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).status, { timeout: 120_000 }).toMatch(/^(succeeded|failed|cancelled|needs_approval)$/);
  return { runId, run: await (await request.get(`/api/runs/${runId}`)).json() };
}

test("a rejected plan never runs", async ({ page, request }) => {
  const id = await seedWorkflow("Rejected plan", canonicalSteps);
  await page.goto(`/workflows/${id}`);
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Plan rejected. It will not run.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run workflow/ })).toHaveCount(0);
  const res = await request.post(`/api/workflows/${id}/runs`, { data: { inputs: {} } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/not been approved/);
  expect(await db.run.count({ where: { workflowId: id } })).toBe(0);
});

test("navigation to a non-allowlisted origin is blocked and the run fails truthfully", async ({ request }) => {
  const { run } = await runToEnd(request, [{ action: "navigate", url: "https://attacker.example/upload", description: "Injected destination" }, verify]);
  expect(run.status).toBe("failed");
  expect(run.error).toMatch(/Blocked: https:\/\/attacker\.example\/upload is not an allowed URL/);
  expect(run.log[1].status).toBe("skipped");
});

test("clicking a link that leaves the allowlist is stopped at the network layer", async ({ request }) => {
  const { run } = await runToEnd(request, [{ action: "navigate", url: DEMO, description: "Open" }, { action: "click", selector: "#help-link", description: "Follow external link" }, verify]);
  expect(run.status).toBe("failed");
  expect(run.log[1].status).toBe("failed");
  expect(run.log[2].status).toBe("skipped");
});

test("destructive actions are refused before they happen", async ({ request }) => {
  for (const selector of ["#delete-selected", "#send-reminders"]) {
    const { run } = await runToEnd(request, [{ action: "navigate", url: DEMO, description: "Open" }, { action: "click", selector, description: "Unsafe" }, verify]);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Blocked potentially destructive action/);
  }
});

test("a changed page fails with an explanation and offers re-plan", async ({ page, request }) => {
  const steps: Step[] = [{ action: "navigate", url: DEMO, description: "Open" }, { action: "click", selector: "#renamed-button", description: "Old button" }, verify];
  const started = await runToEnd(request, steps);
  const { runId } = started;
  let { run } = started;
  // With a live model, Opus may propose a click repair, which waits for a human: reject it.
  if (run.status === "needs_approval") {
    const pending = run.repairs.find((r: { decision: string }) => r.decision === "pending");
    await request.post(`/api/runs/${runId}/repairs/${pending.id}`, { data: { decision: "reject" } });
    await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).status, { timeout: 30_000 }).toBe("failed");
    run = await (await request.get(`/api/runs/${runId}`)).json();
  }
  expect(run.status).toBe("failed");
  // The real locator failure is recorded first; recovery then stops truthfully (no key: model unavailable; with key: no safe repair).
  expect(run.log[1].failures[0].error).toMatch(/Element not found: #renamed-button/);
  expect(run.error).toMatch(/Recovery (could not run|stopped safely|proposal rejected)|Reviewer rejected/);
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText("attempt 1 failed: Element not found: #renamed-button")).toBeVisible();
  await expect(page.getByRole("link", { name: /Review \/ re-plan/ })).toBeVisible();
  await expect(page.getByAltText("Final page state")).toBeVisible();
});

test("a failed postcondition is a failed run, not a success", async ({ request }) => {
  const steps = canonicalSteps.map((s) =>
    s.action === "assert" && s.check.type === "everyRow" && s.check.source === "csv" ? { ...s, check: { ...s.check, value: "2000" } } : s,
  );
  const { run } = await runToEnd(request, steps);
  expect(run.status).toBe("failed");
  expect(run.error).toMatch(/Verification failed: Row 1: Amount "1250.00" fails gte 2000/);
  expect(run.checks.some((c: { passed: boolean }) => !c.passed)).toBe(true);
});

test("a running workflow can be cancelled", async ({ page, request }) => {
  const id = await seedWorkflow("Cancellable", [
    { action: "navigate", url: DEMO, description: "Open" },
    { action: "wait", selector: "#result-count", text: "text that never appears", description: "Slow step" },
    verify,
  ], "approved");
  const { runId } = await (await request.post(`/api/workflows/${id}/runs`, { data: { inputs: {} } })).json();
  await page.goto(`/runs/${runId}`);
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByText("Cancelled by user.")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".pill.cancelled").first()).toBeVisible();
});

test("create form rejects bad input with actionable messages and plans nothing", async ({ page }) => {
  await page.goto("/workflows/new");
  await page.getByLabel("What should happen?").fill("Export the invoices please");
  for (const [url, message] of [
    ["not a url", /not a valid URL/],
    ["https://example.com/", /Start URL is not allowed/],
    ["file:///C:/Windows/win.ini", /Start URL is not allowed/],
  ] as const) {
    await page.getByLabel("Starting URL").fill(url);
    await page.getByRole("button", { name: "Propose a plan" }).click();
    await expect(page.locator(".callout[role=alert]")).toContainText(message);
  }
  await page.getByLabel("What should happen?").fill("");
  await page.getByRole("button", { name: "Propose a plan" }).click();
  await expect(page.locator(".callout[role=alert]")).toContainText("Describe the task");
});

test("state-changing endpoints refuse non-JSON (cross-site form) requests", async ({ request }) => {
  const id = await seedWorkflow("CSRF guard", canonicalSteps, "approved");
  const form = { headers: { "content-type": "text/plain" }, data: "x" };
  for (const url of [`/api/workflows/${id}/runs`, `/api/workflows/${id}/plan`, `/api/workflows/${id}/approval`, "/api/runs/anything/cancel", "/api/demo/variant"]) {
    expect((await request.post(url, form)).status(), url).toBe(415);
  }
  expect(await db.run.count({ where: { workflowId: id } })).toBe(0);
});

test("preview shows targets on the live page before approval and runs nothing", async ({ page }) => {
  const id = await seedWorkflow("Preview before approval", canonicalSteps);
  await page.goto(`/workflows/${id}`);
  await expect(page.getByRole("button", { name: /Run workflow/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview" }).click();
  const panel = page.getByLabel("Preview");
  await expect(panel.getByText("Preview on the live page")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByAltText("Preview of step 4")).toBeVisible();
  await expect(panel.locator(".pill.found").first()).toBeVisible();
  // Still unapproved, still no runs.
  await expect(page.getByText("Approve this plan to run it.")).toBeVisible();
  expect(await db.run.count({ where: { workflowId: id } })).toBe(0);
});
