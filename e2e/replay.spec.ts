import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../src/lib/checks";
import { canonicalSteps, db, expectedUnpaid, seedWorkflow, setVariant } from "./helpers";

test.beforeEach(async ({ request }) => setVariant(request, "classic"));

async function runAndWait(page: Page, button: RegExp, amount: string) {
  await page.locator('input[name="minimumAmount"]').fill(amount);
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(/\/runs\//);
  await expect(page.getByRole("heading", { level: 1, name: /Verified/ })).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
  return parseCsv(await readFile(await download.path(), "utf8"));
}

test("approve, run, verify CSV, reload, replay with a new threshold, keep both runs", async ({ page }) => {
  const id = await seedWorkflow("Unpaid invoices export", canonicalSteps);
  await page.goto(`/workflows/${id}`);

  // Unapproved plans cannot run.
  await expect(page.getByText("Approve this plan to run it.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run workflow/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByRole("button", { name: /Run workflow/ })).toBeEnabled();

  // First run: minimumAmount = 1000.
  const first = await runAndWait(page, /Run workflow/, "1000");
  expect(first.headers).toEqual(["Invoice", "Customer", "Issued", "Due", "Amount", "Status"]);
  expect(first.rows.map((r) => r[0])).toEqual(expectedUnpaid(1000));
  expect(first.rows.every((r) => r[5] === "Unpaid" && Number(r[4]) >= 1000)).toBe(true);
  const firstRunUrl = page.url();

  // Evidence: a real screenshot rendered from the run.
  // Evidence lives in the drawer: open the screenshot step.
  const stepButton = page.getByRole("button", { name: "Step 9: Capture the filtered result" });
  await stepButton.click();
  const drawer = page.getByRole("dialog", { name: "Evidence" });
  await drawer.getByRole("tab", { name: "Page" }).click();
  const shot = drawer.getByAltText("Screenshot after step 9");
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  // Keyboard: Escape closes the drawer and focus returns to the step that opened it.
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(stepButton).toBeFocused();

  // Reload the app, return to the saved workflow, change the input, replay.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Verified/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Unpaid invoices export" }).click();
  await page.waitForURL(`**/workflows/${id}`);
  await page.reload();
  await expect(page.getByRole("button", { name: /Run again/ })).toBeEnabled();
  await expect(page.locator('input[name="minimumAmount"]')).toHaveValue("1000");
  const second = await runAndWait(page, /Run again/, "3000");
  expect(second.rows.map((r) => r[0])).toEqual(expectedUnpaid(3000));
  expect(second.rows.length).toBeLessThan(first.rows.length);

  // Both runs are preserved with their own inputs and outcome.
  await page.goto(`/workflows/${id}`);
  const history = page.getByRole("list", { name: "Recent runs" }).getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText("minimumAmount=3000");
  await expect(history.nth(1)).toContainText("minimumAmount=1000");
  await expect(history.locator(".pill.succeeded")).toHaveCount(2);

  // The first run's evidence was not overwritten by the replay.
  await page.goto(firstRunUrl);
  await expect(page.getByText(`Exported CSV · ${expectedUnpaid(1000).length} rows`)).toBeVisible();
  const runs = await db.run.findMany({ where: { workflowId: id } });
  expect(runs.map((r) => JSON.parse(r.inputs).minimumAmount).sort()).toEqual(["1000", "3000"]);
});

test("duplicate run submissions start only one browser session", async ({ request }) => {
  const id = await seedWorkflow("Duplicate guard", canonicalSteps, "approved");
  const send = () => request.post(`/api/workflows/${id}/runs`, { data: { inputs: { minimumAmount: "1000" } } });
  const statuses = (await Promise.all([send(), send(), send()])).map((r) => r.status()).sort();
  expect(statuses).toEqual([200, 409, 409]);
  await expect.poll(async () => (await db.run.findMany({ where: { workflowId: id } })).length).toBe(1);
});
