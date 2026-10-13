import type { Check } from "./schemas";

export type Table = { headers: string[]; rows: string[][] };
export type CheckResult = { passed: boolean; detail: string };

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): Table {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); records.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (field !== "" || row.length) { row.push(field); records.push(row); }
  const [headers = [], ...rows] = records.filter((r) => r.some((v) => v.trim() !== ""));
  return { headers, rows };
}

/** "$1,250.00" -> 1250; NaN when the cell is not numeric. */
export function toNumber(cell: string): number {
  const cleaned = cell.replace(/[^0-9.-]/g, "");
  return cleaned === "" ? NaN : Number(cleaned);
}

const MONEY_OR_NUMBER = /^-?[$€£]?\s*-?[\d,]*\.?\d+$/;

/** Page cells are formatted ("$1,250.00") while exports are raw ("1250.00"); treat those as equal. */
function sameCell(a: string, b: string): boolean {
  a = a.trim();
  b = b.trim();
  return a === b || (MONEY_OR_NUMBER.test(a) && MONEY_OR_NUMBER.test(b) && toNumber(a) === toNumber(b));
}

/** Evaluate a data postcondition. `visible` checks are evaluated against the page by the runner. */
export function evaluateCheck(check: Exclude<Check, { type: "visible" }>, data: { table?: Table; csv?: Table }): CheckResult {
  if (check.type === "csvMatchesTable") {
    const { table, csv } = data;
    if (!table || !csv) return { passed: false, detail: "Need both an extracted table and a downloaded CSV to compare." };
    if (table.rows.length !== csv.rows.length) {
      return { passed: false, detail: `CSV has ${csv.rows.length} rows but the page shows ${table.rows.length}.` };
    }
    const idx = table.headers.map((h) => csv.headers.findIndex((c) => c.trim().toLowerCase() === h.trim().toLowerCase()));
    if (idx.some((i) => i < 0)) return { passed: false, detail: `CSV headers [${csv.headers.join(", ")}] do not cover page headers [${table.headers.join(", ")}].` };
    for (let r = 0; r < table.rows.length; r++) {
      for (let c = 0; c < table.headers.length; c++) {
        if (!sameCell(table.rows[r][c] ?? "", csv.rows[r][idx[c]] ?? "")) {
          return { passed: false, detail: `Row ${r + 1}, ${table.headers[c]}: page "${table.rows[r][c]}" vs CSV "${csv.rows[r][idx[c]]}".` };
        }
      }
    }
    return { passed: true, detail: `CSV matches all ${table.rows.length} rows on the page.` };
  }

  const source = data[check.source];
  if (!source) return { passed: false, detail: `No ${check.source === "csv" ? "downloaded CSV" : "extracted table"} to check.` };

  if (check.type === "rowCount") {
    const n = source.rows.length;
    return { passed: n >= check.min, detail: `${n} rows in ${check.source} (need at least ${check.min}).` };
  }

  const col = source.headers.findIndex((h) => h.trim().toLowerCase() === check.column.trim().toLowerCase());
  if (col < 0) return { passed: false, detail: `Column "${check.column}" not found in ${check.source} headers [${source.headers.join(", ")}].` };
  const target = check.value.trim();
  for (const [i, row] of source.rows.entries()) {
    const cell = (row[col] ?? "").trim();
    let ok: boolean;
    if (check.op === "eq") ok = cell.toLowerCase() === target.toLowerCase();
    else if (check.op === "contains") ok = cell.toLowerCase().includes(target.toLowerCase());
    else {
      const a = toNumber(cell), b = toNumber(target);
      ok = Number.isFinite(a) && Number.isFinite(b) && (check.op === "gte" ? a >= b : a <= b);
    }
    if (!ok) return { passed: false, detail: `Row ${i + 1}: ${check.column} "${cell}" fails ${check.op} ${target}.` };
  }
  return { passed: true, detail: `All ${source.rows.length} rows in ${check.source} satisfy ${check.column} ${check.op} ${target}.` };
}
