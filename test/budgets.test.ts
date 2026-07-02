import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BudgetStore } from "../src/budgets.js";
import { parseUsdc } from "../src/amounts.js";

let files: string[] = [];
function tempFile(): string {
  const f = join(tmpdir(), `spraay-budget-${process.pid}-${files.length}-${Date.now()}.json`);
  files.push(f);
  return f;
}

afterEach(() => {
  for (const f of files) {
    if (existsSync(f)) rmSync(f);
    if (existsSync(`${f}.tmp.${process.pid}`)) rmSync(`${f}.tmp.${process.pid}`);
  }
  files = [];
});

describe("BudgetStore", () => {
  it("allows spend under the cap and blocks once exhausted", () => {
    const s = new BudgetStore(tempFile());
    s.setLimit("agent-1", parseUsdc("100"));

    expect(s.check("agent-1", parseUsdc("60")).allowed).toBe(true);
    s.record("agent-1", parseUsdc("60"));

    // 60 spent, 40 left → 50 should be blocked, 40 allowed.
    expect(s.check("agent-1", parseUsdc("50")).allowed).toBe(false);
    expect(s.check("agent-1", parseUsdc("40")).allowed).toBe(true);
  });

  it("treats agents with no cap as unlimited but still records spend", () => {
    const s = new BudgetStore(tempFile());
    expect(s.check("free", parseUsdc("9999")).allowed).toBe(true);
    s.record("free", parseUsdc("5"));
    const st = s.status("free");
    expect(st.limit).toBeNull();
    expect(st.spent).toBe(parseUsdc("5"));
    expect(st.remaining).toBeNull();
  });

  it("persists across instances", () => {
    const f = tempFile();
    const a = new BudgetStore(f);
    a.setLimit("x", parseUsdc("10"));
    a.record("x", parseUsdc("3"));

    const b = new BudgetStore(f);
    expect(b.status("x").spent).toBe(parseUsdc("3"));
    expect(b.status("x").limit).toBe(parseUsdc("10"));
    expect(b.check("x", parseUsdc("8")).allowed).toBe(false); // only 7 left
  });

  it("clears and resets", () => {
    const s = new BudgetStore(tempFile());
    s.setLimit("x", parseUsdc("10"));
    s.record("x", parseUsdc("4"));
    s.resetSpent("x");
    expect(s.status("x").spent).toBe(0n);
    s.setLimit("x", null);
    expect(s.status("x").limit).toBeNull();
    expect(s.check("x", parseUsdc("1000")).allowed).toBe(true);
  });
});
