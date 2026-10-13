import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../src/lib/checks";
import { canonicalSteps, db, expectedUnpaid, seedWorkflow } from "./helpers";

async function runAndWait(page: Page, button: RegExp, amount: string) {
  await page.locator('input[name="minimumAmount"]').fill(amount);
  await page.getByRole("button", { name: button }).click();
  await page.waitForURL(/\/runs\//);
  await expect(page.getByText(/All steps completed and \d+ verification checks? passed/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
  return parseCsv(await readFile(await download.path(), "utf8"));
}

test("approve, run, verify CSV, reload, replay with a new threshold, keep both runs", async ({ page }) => {
  const id = await seedWorkflow("Unpaid invoices export", canonicalSteps);
  await page.goto(`/workflows/${id}`);

  // Unapproved plans cannot run.
  await expect(page.getByText("Approval required.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run workflow/ })).toBeDisabled();
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByRole("button", { name: /Run workflow/ })).toBeEnabled();

  // First run: minimumAmount = 1000.
  const first = await runAndWait(page, /Run workflow/, "1000");
  expect(first.headers).toEqual(["Invoice", "Customer", "Issued", "Due", "Amount", "Status"]);
  expect(first.rows.map((r) => r[0])).toEqual(expectedUnpaid(1000));
  expect(first.rows.every((r) => r[5] === "Unpaid" && Number(r[4]) >= 1000)).toBe(true);
  const firstRunUrl = page.url();

  // Evidence: a real screenshot rendered from the run.
  const shot = page.getByAltText("Screenshot after step 8");
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);

  // Reload the app, return to the saved workflow, change the input, replay.
  await page.reload();
  await expect(page.getByText(/All steps completed/)).toBeVisible();
  await page.getByRole("link", { name: /Unpaid invoices export/ }).first().click();
  await page.reload();
  await expect(page.getByRole("button", { name: /Run again/ })).toBeEnabled();
  await expect(page.locator('input[name="minimumAmount"]')).toHaveValue("1000");
  const second = await runAndWait(page, /Run again/, "3000");
  expect(second.rows.map((r) => r[0])).toEqual(expectedUnpaid(3000));
  expect(second.rows.length).toBeLessThan(first.rows.length);

  // Both runs are preserved with their own inputs and outcome.
  await page.goto(`/workflows/${id}`);
  const history = page.locator("table.grid tbody tr");
  await expect(history).toHaveCount(2);
  await expect(history.nth(0)).toContainText("minimumAmount=3000");
  await expect(history.nth(1)).toContainText("minimumAmount=1000");
  await expect(history.locator(".tag.succeeded")).toHaveCount(2);

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
