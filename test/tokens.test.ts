import { describe, it, expect } from "vitest";
import {
  resolveTokenRef,
  deniedReason,
  KNOWN_TOKENS,
  UnknownTokenError,
} from "../src/tokens.js";

describe("resolveTokenRef", () => {
  it("defaults to USDC when no ref is given", () => {
    const r = resolveTokenRef("base");
    expect(r.address).toBe(KNOWN_TOKENS.base.USDC);
    expect(r.isDefault).toBe(true);
    expect(r.requestedSymbol).toBe("USDC");

    const s = resolveTokenRef("base-sepolia", "");
    expect(s.address).toBe(KNOWN_TOKENS["base-sepolia"].USDC);
    expect(s.isDefault).toBe(true);
  });

  it("passes through a raw 0x address (checksummed), not marked default", () => {
    const lower = "0x4200000000000000000000000000000000000006";
    const r = resolveTokenRef("base", lower);
    expect(r.address.toLowerCase()).toBe(lower);
    expect(r.isDefault).toBe(false);
  });

  it("resolves a known symbol case-insensitively", () => {
    expect(resolveTokenRef("base", "weth").address).toBe(KNOWN_TOKENS.base.WETH);
    expect(resolveTokenRef("base", "DAI").address).toBe(KNOWN_TOKENS.base.DAI);
  });

  it("throws UnknownTokenError for an unknown symbol", () => {
    expect(() => resolveTokenRef("base", "WAGMI")).toThrow(UnknownTokenError);
  });
});

describe("deniedReason (fee-on-transfer / rebasing guard)", () => {
  it("flags rebasing and fee-on-transfer tokens by symbol (case-insensitive)", () => {
    expect(deniedReason(undefined, "stETH")).toBeTruthy();
    expect(deniedReason(undefined, "AMPL")).toBeTruthy();
    expect(deniedReason(undefined, "paxg")).toBeTruthy();
  });

  it("flags a denylisted token by address", () => {
    // Lido stETH (mainnet) address, mixed case.
    expect(deniedReason("0xAE7ab96520DE3A18E5e111B5EaAb095312D7fE84", undefined)).toBeTruthy();
  });

  it("allows normal tokens", () => {
    expect(deniedReason(KNOWN_TOKENS.base.USDC, "USDC")).toBeUndefined();
    expect(deniedReason(KNOWN_TOKENS.base.WETH, "WETH")).toBeUndefined();
  });
});
