import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // viem is a runtime dependency; keep it external so it resolves from node_modules.
  external: ["viem", "openclaw"],
});
