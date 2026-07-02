import { describe, it, expect, afterEach } from "vitest";
import { paymasterUrl, gaslessActive, evaluateSponsorship } from "../src/gasless.js";
import type { SpraayConfig } from "../src/config.js";

const base = (over: Partial<SpraayConfig> = {}): SpraayConfig => ({
  version: 1,
  network: "base",
  sponsorship: { enabled: true },
  ...over,
});

const ENV_KEYS = ["CDP_PAYMASTER_URL", "SPRAAY_PAYMASTER_URL"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("paymasterUrl resolution", () => {
  it("prefers env over config", () => {
    delete process.env.CDP_PAYMASTER_URL;
    delete process.env.SPRAAY_PAYMASTER_URL;
    expect(paymasterUrl(base({ paymasterUrl: "https://cfg" }))).toBe("https://cfg");
    process.env.CDP_PAYMASTER_URL = "https://env";
    expect(paymasterUrl(base({ paymasterUrl: "https://cfg" }))).toBe("https://env");
  });
  it("is undefined when nothing set", () => {
    delete process.env.CDP_PAYMASTER_URL;
    delete process.env.SPRAAY_PAYMASTER_URL;
    expect(paymasterUrl(base())).toBeUndefined();
  });
});

describe("gaslessActive / evaluateSponsorship", () => {
  it("needs both a url and sponsorship enabled", () => {
    delete process.env.CDP_PAYMASTER_URL;
    delete process.env.SPRAAY_PAYMASTER_URL;
    expect(gaslessActive(base())).toBe(false); // no url
    expect(gaslessActive(base({ paymasterUrl: "https://x" }))).toBe(true);
    expect(gaslessActive(base({ paymasterUrl: "https://x", sponsorship: { enabled: false } }))).toBe(
      false,
    );
  });
  it("evaluateSponsorship explains why it won't sponsor", () => {
    delete process.env.CDP_PAYMASTER_URL;
    delete process.env.SPRAAY_PAYMASTER_URL;
    expect(evaluateSponsorship(base({ sponsorship: { enabled: false } })).sponsor).toBe(false);
    expect(evaluateSponsorship(base()).sponsor).toBe(false); // no url
    expect(evaluateSponsorship(base({ paymasterUrl: "https://x" })).sponsor).toBe(true);
  });
});
