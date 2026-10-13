import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../src/lib/checks";
import { expectedUnpaid, hasModelKey } from "./helpers";

// Live Opus planning. Runs only when the server has a key (the app reads .env itself).

const hasKey = hasModelKey();

test("describe, Opus inspects the real page, approve, run, replay with new input", async ({ page }) => {
  test.skip(!hasKey, "ANTHROPIC_API_KEY not configured; live planning not exercised");
  test.setTimeout(600_000);
  await page.goto("/workflows/new");
  await page.getByRole("button", { name: "Fill demo example" }).click();
  await page.getByRole("button", { name: "Propose a plan" }).click();
  // Planning may use up to MAX_MODEL_CALLS calls; fail fast if the UI reports an error instead.
  const failed = page.locator(".callout.danger[role=alert]");
  await expect(async () => {
    if (await failed.isVisible()) throw new Error(`Planning failed: ${await failed.innerText()}`);
    expect(page.url()).toMatch(/\/workflows\/(?!new)/);
  }).toPass({ timeout: 420_000, intervals: [1000] });
  await expect(page.getByText("Approve this plan to run it.")).toBeVisible();
  await page.getByRole("button", { name: "Approve plan" }).click();
  const workflowUrl = page.url();

  for (const [amount, button] of [["1000", /Run workflow/], ["3000", /Run again/]] as const) {
    await page.goto(workflowUrl);
    await page.locator('input[name="minimumAmount"]').fill(amount);
    await page.getByRole("button", { name: button }).click();
    await page.waitForURL(/\/runs\//);
    await expect(page.getByText(/All steps completed/)).toBeVisible({ timeout: 60_000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
    const csv = parseCsv(await readFile(await dl.path(), "utf8"));
    expect(csv.rows.map((r) => r[0])).toEqual(expectedUnpaid(Number(amount)));
  }
});
