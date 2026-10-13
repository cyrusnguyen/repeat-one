import { closeSession, describeElement, navigate, openSession } from "./browser";
import { fillTemplate, stepTarget, type InputDef, type Step } from "./schemas";

export type PreviewItem = {
  step: number;
  action: string;
  target: string;
  status: "loaded" | "found" | "missing" | "ambiguous" | "not_checked" | "error";
  detail: string;
  image?: string; // data URL, not persisted
};

const PAD = 60;

/**
 * Read-only look at a plan before approval: loads the start page and locates each step's target.
 * Nothing is clicked, typed, selected or downloaded; the only page change is a temporary highlight outline.
 */
export async function previewPlan(startUrl: string, steps: Step[], inputs: InputDef[], prefixes: string[]): Promise<PreviewItem[]> {
  const values = Object.fromEntries(inputs.map((i) => [i.name, i.default]));
  const s = await openSession(prefixes);
  const items: PreviewItem[] = [];
  try {
    await navigate(s, startUrl);
    for (const [i, step] of steps.entries()) {
      const base = { step: i + 1, action: step.action, target: stepTarget(step) };
      try {
        if (step.action === "navigate") {
          const detail = await navigate(s, fillTemplate(step.url, values));
          items.push({ ...base, status: "loaded", detail, image: await shot() });
          continue;
        }
        const selector = "selector" in step ? step.selector : step.action === "assert" && step.check.type === "visible" ? step.check.selector : null;
        if (!selector) {
          items.push({ ...base, status: "not_checked", detail: "Checked against real page and CSV data when the plan runs." });
          continue;
        }
        const loc = s.page.locator(selector);
        const count = await loc.count();
        if (count === 0) {
          items.push({ ...base, status: "missing", detail: "Not on the start page. Fine only if an earlier step reveals it; otherwise this step will fail." });
          continue;
        }
        if (count > 1) {
          items.push({ ...base, status: "ambiguous", detail: `Matches ${count} elements; the run needs exactly one.` });
          continue;
        }
        const el = await describeElement(s, selector);
        items.push({ ...base, status: "found", detail: `<${el.tag}${el.type ? ` type=${el.type}` : ""}> "${el.label}"`, image: await shot(selector) });
      } catch (err) {
        items.push({ ...base, status: "error", detail: err instanceof Error ? err.message.split("\n")[0] : String(err) });
      }
    }
    return items;
  } finally {
    await closeSession(s);
  }

  /** JPEG around the target (or the viewport), with a temporary outline on the target. */
  async function shot(selector?: string): Promise<string> {
    let clip;
    if (selector) {
      const loc = s.page.locator(selector);
      await loc.evaluate((el: HTMLElement) => {
        el.scrollIntoView({ block: "center" });
        el.dataset.previewOutline = el.style.outline;
        el.style.outline = "3px solid #d3b97c";
        el.style.outlineOffset = "2px";
      });
      const box = await loc.boundingBox();
      const vp = s.page.viewportSize() ?? { width: 1280, height: 720 };
      if (box) {
        const x = Math.max(0, box.x - PAD), y = Math.max(0, box.y - PAD);
        clip = { x, y, width: Math.min(vp.width - x, box.width + PAD * 2, 900), height: Math.min(vp.height - y, box.height + PAD * 2, 500) };
      }
    }
    const buf = await s.page.screenshot({ type: "jpeg", quality: 70, clip });
    if (selector) await s.page.locator(selector).evaluate((el: HTMLElement) => { el.style.outline = el.dataset.previewOutline ?? ""; delete el.dataset.previewOutline; });
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }
}
