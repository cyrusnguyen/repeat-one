import { describe, expect, it } from "vitest";
import { isDestructiveLabel, isUrlAllowed, parsePrefixes, redact } from "./safety";

const prefixes = parsePrefixes("http://localhost:3000/demo/");

describe("isUrlAllowed", () => {
  it("allows URLs under the prefix", () => {
    expect(isUrlAllowed("http://localhost:3000/demo/invoices.html", prefixes)).toBe(true);
    expect(isUrlAllowed("http://localhost:3000/demo/invoices.html?x=1#y", prefixes)).toBe(true);
  });
  it("blocks other paths, ports, hosts and look-alikes", () => {
    for (const url of [
      "http://localhost:3000/api/workflows",
      "http://localhost:3000/demo",
      "http://localhost:3000/demo/../api/workflows",
      "http://localhost:3000/demox/a",
      "http://localhost:3001/demo/invoices.html",
      "http://localhost.attacker.example/demo/",
      "https://localhost:3000/demo/invoices.html",
      "http://127.0.0.1:3000/demo/invoices.html",
      "http://169.254.169.254/latest/meta-data/",
      "http://user:pw@localhost:3000/demo/invoices.html",
      "https://attacker.example/upload",
    ]) expect(isUrlAllowed(url, prefixes), url).toBe(false);
  });
  it("blocks dangerous schemes and garbage", () => {
    for (const url of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,hi", "chrome://settings", "not a url", ""]) {
      expect(isUrlAllowed(url, prefixes), url).toBe(false);
    }
  });
  it("rejects malformed allowlist config loudly", () => {
    expect(() => parsePrefixes("not-a-url")).toThrow();
  });
});

describe("isDestructiveLabel", () => {
  it("flags consequential actions", () => {
    for (const l of ["Delete selected", "Email reminders", "Send", "Pay now", "Submit order", "Publish", "Place order", "Sign out"]) {
      expect(isDestructiveLabel(l), l).toBe(true);
    }
  });
  it("allows read/filter/export actions", () => {
    for (const l of ["Apply filters", "Export CSV", "Next page", "Search", "Sort by amount", "Download report"]) {
      expect(isDestructiveLabel(l), l).toBe(false);
    }
  });
});

describe("redact", () => {
  it("removes keys, bearer tokens and secret-looking assignments", () => {
    const out = redact('key sk-ant-api03-abcDEF_123 Authorization: Bearer abc.def.ghijkl password="hunter2" token=xyz');
    expect(out).not.toMatch(/abcDEF_123|abc\.def\.ghijkl|hunter2|xyz/);
  });
});
