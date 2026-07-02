import { describe, it, expect } from "vitest";
import {
  parseUsdc,
  formatUsdc,
  parseRecipients,
  parseAddresses,
  allEqual,
  sum,
} from "../src/amounts.js";

const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";

describe("parseUsdc", () => {
  it("parses whole and fractional amounts to 6-decimal base units", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(parseUsdc("12.5")).toBe(12_500_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
  });
  it("rejects non-numbers, negatives, zero, and excess precision", () => {
    expect(() => parseUsdc("abc")).toThrow();
    expect(() => parseUsdc("-1")).toThrow();
    expect(() => parseUsdc("0")).toThrow();
    expect(() => parseUsdc("1.1234567")).toThrow(); // 7 dp > 6
  });
});

describe("formatUsdc", () => {
  it("round-trips and trims trailing zeros", () => {
    expect(formatUsdc(1_000_000n)).toBe("1");
    expect(formatUsdc(12_500_000n)).toBe("12.5");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(parseUsdc("999.99"))).toBe("999.99");
  });
});

describe("parseRecipients", () => {
  it("pairs checksummed addresses with parsed amounts", () => {
    const r = parseRecipients([A, B], ["1", "2"]);
    expect(r).toHaveLength(2);
    expect(r[0]!.amount).toBe(1_000_000n);
    expect(r[1]!.amount).toBe(2_000_000n);
  });
  it("rejects length mismatch and bad addresses", () => {
    expect(() => parseRecipients([A], ["1", "2"])).toThrow();
    expect(() => parseRecipients(["nope"], ["1"])).toThrow();
    expect(() => parseRecipients([], [])).toThrow();
  });
});

describe("parseAddresses / allEqual / sum", () => {
  it("validates addresses", () => {
    expect(parseAddresses([A, B])).toHaveLength(2);
    expect(() => parseAddresses(["bad"])).toThrow();
  });
  it("detects uniform amounts", () => {
    expect(allEqual([5n, 5n, 5n])).toBe(true);
    expect(allEqual([5n, 6n])).toBe(false);
    expect(allEqual([])).toBe(false);
  });
  it("sums", () => {
    expect(sum([1n, 2n, 3n])).toBe(6n);
    expect(sum([])).toBe(0n);
  });
});
