import { describe, expect, it } from "vitest";
import { evaluateCheck, parseCsv, type Table } from "./checks";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", () => {
    const t = parseCsv('Invoice,Customer,Amount\r\nINV-1,"Vela Architects, Inc.",4100.00\r\nINV-2,"Say ""hi""",5\r\n');
    expect(t.headers).toEqual(["Invoice", "Customer", "Amount"]);
    expect(t.rows).toEqual([["INV-1", "Vela Architects, Inc.", "4100.00"], ["INV-2", 'Say "hi"', "5"]]);
  });
  it("returns headers only for an empty export", () => {
    expect(parseCsv("A,B\n")).toEqual({ headers: ["A", "B"], rows: [] });
  });
  it("rejects unterminated quotes", () => expect(() => parseCsv('A\n"oops')).toThrow());
});

const table: Table = { headers: ["Invoice", "Amount", "Status"], rows: [["INV-1", "$1,250.00", "Unpaid"], ["INV-3", "$3,120.00", "Unpaid"]] };
const csv: Table = { headers: ["Invoice", "Customer", "Amount", "Status"], rows: [["INV-1", "Acme", "1250.00", "Unpaid"], ["INV-3", "Cobalt", "3120.00", "Unpaid"]] };

describe("evaluateCheck", () => {
  it("compares CSV to the page table, tolerating number formatting", () => {
    expect(evaluateCheck({ type: "csvMatchesTable" }, { table, csv }).passed).toBe(true);
  });
  it("detects CSV/page mismatches", () => {
    const bad = { ...csv, rows: [csv.rows[0], ["INV-3", "Cobalt", "3120.01", "Unpaid"]] };
    expect(evaluateCheck({ type: "csvMatchesTable" }, { table, csv: bad })).toMatchObject({ passed: false });
    expect(evaluateCheck({ type: "csvMatchesTable" }, { table, csv: { ...csv, rows: [csv.rows[0]] } }).detail).toMatch(/1 rows/);
    expect(evaluateCheck({ type: "csvMatchesTable" }, { table }).passed).toBe(false);
  });
  it("checks every row against a threshold", () => {
    expect(evaluateCheck({ type: "everyRow", source: "table", column: "Amount", op: "gte", value: "1000" }, { table }).passed).toBe(true);
    expect(evaluateCheck({ type: "everyRow", source: "csv", column: "amount", op: "gte", value: "2000" }, { csv })).toMatchObject({ passed: false });
    expect(evaluateCheck({ type: "everyRow", source: "table", column: "Status", op: "eq", value: "unpaid" }, { table }).passed).toBe(true);
    expect(evaluateCheck({ type: "everyRow", source: "table", column: "Nope", op: "eq", value: "x" }, { table }).detail).toMatch(/not found/);
  });
  it("counts rows", () => {
    expect(evaluateCheck({ type: "rowCount", source: "csv", min: 2 }, { csv }).passed).toBe(true);
    expect(evaluateCheck({ type: "rowCount", source: "csv", min: 3 }, { csv }).passed).toBe(false);
    expect(evaluateCheck({ type: "rowCount", source: "csv", min: 0 }, {}).passed).toBe(false);
  });
});
