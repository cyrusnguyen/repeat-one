import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { isDestructiveLabel, isUrlAllowed, redact } from "./safety";
import { parseCsv, type Table } from "./checks";

const ACTION_TIMEOUT_MS = 5_000;
const MAX_CSV_BYTES = 2_000_000;

/** One isolated Chromium + context per run/plan: no shared cookies, storage or cache. */
export type Session = { page: Page; browser: Browser; blocked: string[]; prefixes: string[] };

export async function openSession(prefixes: string[]): Promise<Session> {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  const session: Session = { page: await context.newPage(), browser, blocked: [], prefixes };
  // Enforced at the network layer: every request (navigation, XHR, image, redirect) off the allowlist is aborted.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (isUrlAllowed(url, prefixes)) return route.continue();
    session.blocked.push(url.slice(0, 200));
    return route.abort("blockedbyclient");
  });
  context.on("page", (p) => { if (p !== session.page) void p.close(); }); // no popups/new tabs
  session.page.on("dialog", (d) => void d.dismiss());
  session.page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  return session;
}

export async function closeSession(s: Session | undefined): Promise<void> {
  await s?.browser.close().catch(() => {});
}

function assertStillAllowed(s: Session) {
  const url = s.page.url();
  if (url !== "about:blank" && !isUrlAllowed(url, s.prefixes)) throw new Error(`Page left the allowlist (now at ${url}); stopped.`);
}

export async function navigate(s: Session, url: string): Promise<string> {
  if (!isUrlAllowed(url, s.prefixes)) throw new Error(`Blocked: ${url} is not an allowed URL for this workflow.`);
  const res = await s.page.goto(url, { waitUntil: "load" });
  if (!res || !res.ok()) throw new Error(`Navigation to ${url} failed (HTTP ${res?.status() ?? "no response"}).`);
  assertStillAllowed(s);
  return `Loaded ${s.page.url()} — "${await s.page.title()}"`;
}

/** A step's target is missing or ambiguous: the only failure class eligible for AI-guided recovery. */
export class LocatorError extends Error {}

/** Resolve a selector to exactly one element, or throw LocatorError. Invalid selector syntax is also a LocatorError. */
export async function single(s: Session, selector: string) {
  const loc = s.page.locator(selector);
  const count = await loc.count().catch(() => { throw new LocatorError(`Invalid selector: ${selector}`); });
  if (count === 0) throw new LocatorError(`Element not found: ${selector}`);
  if (count > 1) throw new LocatorError(`Selector matched ${count} elements, expected exactly one: ${selector}`);
  return loc;
}

export type ElementInfo = { tag: string; type: string | null; id: string; role: string | null; label: string; visible: boolean; options: string[] };

/** Facts about one element, used to validate a proposed repair target. */
export async function describeElement(s: Session, selector: string): Promise<ElementInfo> {
  const loc = await single(s, selector);
  return loc.evaluate((el) => {
    const h = el as HTMLElement;
    const label = (el as HTMLInputElement).labels?.[0]?.innerText || el.getAttribute("aria-label") || h.innerText || (el as HTMLInputElement).value || el.getAttribute("placeholder") || "";
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      id: el.id,
      role: el.getAttribute("role"),
      label: label.replace(/\s+/g, " ").trim().slice(0, 80),
      visible: !!h.offsetParent || getComputedStyle(h).position === "fixed",
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => o.value) : [],
    };
  });
}

/** Destructive/externally consequential actions are refused before the click happens. */
async function guardedTarget(s: Session, selector: string) {
  const loc = await single(s, selector);
  const label = await loc.evaluate((el) =>
    [(el as HTMLElement).innerText, (el as HTMLInputElement).value, el.getAttribute("aria-label"), el.getAttribute("title")].filter(Boolean).join(" "),
  );
  if (isDestructiveLabel(label)) throw new Error(`Blocked potentially destructive action "${label.trim().slice(0, 60)}". RepeatOne only runs read/filter/export actions.`);
  return { loc, label: label.trim().slice(0, 60) };
}

export async function click(s: Session, selector: string): Promise<string> {
  const { loc, label } = await guardedTarget(s, selector);
  await loc.click();
  await s.page.waitForLoadState("load");
  assertStillAllowed(s);
  return `Clicked "${label}"`;
}

export async function fill(s: Session, selector: string, value: string): Promise<string> {
  const loc = await single(s, selector);
  if ((await loc.getAttribute("type"))?.toLowerCase() === "password") throw new Error("Blocked: RepeatOne never fills password fields.");
  await loc.fill(value);
  return `Filled ${selector} with "${value}"`;
}

export async function selectOption(s: Session, selector: string, value: string): Promise<string> {
  const picked = await (await single(s, selector)).selectOption(value);
  return `Selected ${picked.join(", ")} in ${selector}`;
}

export async function waitFor(s: Session, selector: string, text?: string): Promise<string> {
  const loc = text ? s.page.locator(selector).filter({ hasText: text }) : s.page.locator(selector);
  try {
    await loc.first().waitFor({ state: "visible" });
  } catch (err) {
    // Distinguish "target gone" (recoverable) from "target present but condition never met" (not recoverable).
    if ((await s.page.locator(selector).count().catch(() => 0)) === 0) throw new LocatorError(`Element not found: ${selector}`);
    throw err;
  }
  return `Visible: ${selector}${text ? ` containing "${text}"` : ""} — "${redact((await loc.first().innerText()).slice(0, 120))}"`;
}

export async function extractTable(s: Session, selector: string, maxRows = 500): Promise<Table> {
  const loc = await single(s, selector);
  return loc.evaluate((el, max) => {
    const text = (c: Element) => (c as HTMLElement).innerText.trim();
    const headerRow = el.querySelector("thead tr") ?? el.querySelector("tr");
    const headers = headerRow ? Array.from(headerRow.children).map(text) : [];
    const bodyRows = Array.from(el.querySelectorAll("tbody tr")).filter((r) => r !== headerRow);
    return { headers, rows: bodyRows.slice(0, max).map((r) => Array.from(r.children).map(text)) };
  }, maxRows);
}

export async function download(s: Session, selector: string, savePath: string): Promise<Table> {
  const { loc } = await guardedTarget(s, selector);
  const [dl] = await Promise.all([s.page.waitForEvent("download"), loc.click()]);
  if (!/\.csv$/i.test(dl.suggestedFilename())) throw new Error(`Expected a .csv download, got "${dl.suggestedFilename()}"`);
  await dl.saveAs(savePath);
  const text = await readFile(savePath, "utf8");
  if (text.length > MAX_CSV_BYTES) throw new Error("Downloaded CSV is larger than 2 MB; refusing to process.");
  return parseCsv(text);
}

export async function screenshot(s: Session, savePath: string): Promise<void> {
  await s.page.screenshot({ path: savePath, fullPage: true });
}

/**
 * Compact, model-facing description of the current page: interactive elements with selectors,
 * tables with headers and a few sample rows. Text is truncated and redacted; it is untrusted data.
 */
export async function observe(s: Session) {
  const snapshot = await s.page.evaluate(() => {
    const clip = (t: string | null | undefined, n = 80) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    const sel = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const testId = el.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId}"]`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      return `${el.tagName.toLowerCase()}:has-text("${clip((el as HTMLElement).innerText, 40)}")`;
    };
    const labelOf = (el: Element) =>
      clip((el as HTMLInputElement).labels?.[0]?.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el as HTMLElement).innerText);
    const visible = (el: Element) => !!(el as HTMLElement).offsetParent || el.tagName === "BODY";
    const controls = Array.from(document.querySelectorAll("input, select, textarea, button, a[href], [role=button]"))
      .filter(visible)
      .slice(0, 60)
      .map((el) => ({
        selector: sel(el),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? undefined,
        label: labelOf(el),
        href: el instanceof HTMLAnchorElement ? el.href : undefined,
        options: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => `${o.value}=${clip(o.text, 30)}`) : undefined,
      }));
    const tables = Array.from(document.querySelectorAll("table")).slice(0, 5).map((t) => ({
      selector: sel(t),
      headers: Array.from(t.querySelectorAll("thead th, tr:first-child th")).map((h) => clip((h as HTMLElement).innerText, 40)),
      rowCount: t.querySelectorAll("tbody tr").length,
      sampleRows: Array.from(t.querySelectorAll("tbody tr")).slice(0, 3).map((r) => Array.from(r.children).map((c) => clip((c as HTMLElement).innerText, 40))),
    }));
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, [aria-live]")).slice(0, 10).map((h) => ({ selector: sel(h), text: clip((h as HTMLElement).innerText, 100) }));
    return { title: document.title, headings, controls, tables, visibleText: clip(document.body.innerText, 1500) };
  });
  return JSON.parse(redact(JSON.stringify({ url: s.page.url(), ...snapshot })));
}
