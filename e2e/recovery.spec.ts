import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../src/lib/checks";
import { canonicalSteps, db, DEMO, expectedUnpaid, hasModelKey, seedWorkflow, setVariant } from "./helpers";

const hasKey = hasModelKey();

test.beforeEach(async ({ request }) => setVariant(request, "classic"));

test("the variant toggle changes the real portal markup, not the data", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Demo portal UI variant" }).getByRole("button", { name: "Redesigned" }).click();
  await expect(page.getByRole("button", { name: "Redesigned" })).toHaveAttribute("aria-pressed", "true");
  const html = await (await request.get(DEMO)).text();
  expect(html).toContain('id="amount-floor"');
  expect(html).not.toContain('id="min-amount"');
  expect(html).toContain("INV-1011");
});

test("a redirect out of the allowlist (to loopback) is contained", async ({ request }) => {
  const id = await seedWorkflow("Redirect", [
    { action: "navigate", url: DEMO.replace("/invoices", "/redirect"), description: "Follow a redirect" },
    { action: "assert", check: { type: "rowCount", source: "table", min: 1 }, description: "Has rows" },
  ], "approved");
  const { runId } = await (await request.post(`/api/workflows/${id}/runs`, { data: { inputs: {} } })).json();
  await expect.poll(async () => (await db.run.findUniqueOrThrow({ where: { id: runId } })).status, { timeout: 30_000 }).toBe("failed");
  const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
  expect(run.error).toMatch(/Step 1 \(navigate .*\/demo\/redirect\) failed/);
});

test("changed UI without a model key: real failure first, then a truthful stop (no guessing)", async ({ page, request }) => {
  test.skip(hasKey, "covered by the live recovery test when a key is configured");
  const id = await seedWorkflow("Changed UI, no key", canonicalSteps, "approved");
  await setVariant(request, "redesigned");
  await page.goto(`/workflows/${id}`);
  await page.locator('input[name="minimumAmount"]').fill("3000");
  await page.getByRole("button", { name: /Run workflow/ }).click();
  await page.waitForURL(/\/runs\//);
  await expect(page.locator(".callout[role=alert]")).toContainText("Recovery could not run: ANTHROPIC_API_KEY is not set", { timeout: 30_000 });
  await expect(page.getByText("attempt 1 failed: Element not found: #min-amount")).toBeVisible();
  await expect(page.getByLabel("Recovery").getByText("error", { exact: true })).toBeVisible();
  await expect(page.getByAltText(/Page at failure of step 4/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download CSV" })).toHaveCount(0);
});

test("live Opus recovery: changed UI is repaired, approved where required, and the original outcome re-verified", async ({ page, request }) => {
  test.skip(!hasKey, "ANTHROPIC_API_KEY not configured; live recovery not exercised");
  test.setTimeout(300_000);
  const id = await seedWorkflow("Changed UI, live", canonicalSteps, "approved");
  await setVariant(request, "redesigned");
  await page.goto(`/workflows/${id}`);
  await page.locator('input[name="minimumAmount"]').fill("3000");
  await page.getByRole("button", { name: /Run workflow/ }).click();
  await page.waitForURL(/\/runs\//);
  const runId = page.url().split("/runs/")[1];

  // Read-only fill repair applies automatically; the click repair needs a human.
  await expect(page.getByRole("button", { name: "Approve repair" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("#refresh-results", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve repair" }).click();
  await expect(page.getByText(/All steps completed .* including 2 repaired steps/)).toBeVisible({ timeout: 180_000 });

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
  expect(parseCsv(await readFile(await dl.path(), "utf8")).rows.map((r) => r[0])).toEqual(expectedUnpaid(3000));
  const repairs = await db.repair.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
  expect(repairs.map((r) => [r.failedSelector, r.proposedSelector, r.decision, r.outcome])).toEqual([
    ["#min-amount", "#amount-floor", "auto_approved", "verified"],
    ["#apply-filters", "#refresh-results", "approved", "verified"],
  ]);
  // Survives refresh: status and repair history come from the database.
  await page.reload();
  await expect(page.getByLabel("Recovery").getByText("auto-approved")).toBeVisible();
});

test("export removed: recovery cannot find a safe equivalent and stops truthfully", async ({ page, request }) => {
  test.setTimeout(300_000);
  const id = await seedWorkflow("Export removed", canonicalSteps, "approved");
  await setVariant(request, "export_removed");
  const { runId } = await (await request.post(`/api/workflows/${id}/runs`, { data: { inputs: { minimumAmount: "1000" } } })).json();
  await expect.poll(async () => (await db.run.findUniqueOrThrow({ where: { id: runId } })).status, { timeout: 240_000 }).toBe("failed");
  const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
  expect(run.error).toMatch(/Recovery (stopped safely|could not run|proposal rejected)/);
  expect(run.csvFile).toBeNull();
  const [repair] = await db.repair.findMany({ where: { runId } });
  expect(repair.failedSelector).toBe("#export-csv");
  expect(["no_safe_repair", "error", "invalid"]).toContain(repair.decision);
  await page.goto(`/runs/${runId}`);
  await expect(page.getByText("attempt 1 failed: Element not found: #export-csv")).toBeVisible();
});
