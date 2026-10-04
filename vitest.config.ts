import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@attest/shared": r("./packages/shared/src/index.ts"),
      "@attest/project-world": r("./packages/project-world/src/index.ts"),
      "@attest/model-router": r("./packages/model-router/src/index.ts"),
      "@attest/tool-runtime": r("./packages/tool-runtime/src/index.ts"),
      "@attest/verification": r("./packages/verification/src/index.ts"),
      "@attest/evidence": r("./packages/evidence/src/index.ts"),
      "@attest/agent-runtime": r("./packages/agent-runtime/src/index.ts"),
      "@attest/observability": r("./packages/observability/src/index.ts"),
      "@attest/core": r("./packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ["default"],
  },
});
