import { describe, it, expect } from "vitest";
import { resolvePayout } from "../src/payout.js";

const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";
const C = "0x0000000000000000000000000000000000000003";

describe("resolvePayout", () => {
  it("uses sprayEqual for a single `amount` to all", () => {
    const r = resolvePayout([A, B, C], undefined, "10");
    expect(r.method).toBe("sprayEqual");
    expect(r.amountPerRecipient).toBe(10_000_000n);
    expect(r.payout).toBe(30_000_000n);
    expect(r.addresses).toHaveLength(3);
  });

  it("uses sprayToken for differing per-recipient amounts", () => {
    const r = resolvePayout([A, B], ["10", "20"], undefined);
    expect(r.method).toBe("sprayToken");
    expect(r.payout).toBe(30_000_000n);
    expect(r.amountsBase).toEqual([10_000_000n, 20_000_000n]);
  });

  it("downgrades uniform per-recipient amounts to the cheaper sprayEqual", () => {
    const r = resolvePayout([A, B], ["5", "5"], undefined);
    expect(r.method).toBe("sprayEqual");
    expect(r.payout).toBe(10_000_000n);
  });

  it("rejects providing both / neither, and length mismatches", () => {
    expect(() => resolvePayout([A], ["1"], "1")).toThrow();
    expect(() => resolvePayout([A], undefined, undefined)).toThrow();
    expect(() => resolvePayout([A, B], ["1"], undefined)).toThrow();
  });
});
