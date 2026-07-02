import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only our own tests — never the reference clones under ./reference/.
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist", "reference"],
  },
});
