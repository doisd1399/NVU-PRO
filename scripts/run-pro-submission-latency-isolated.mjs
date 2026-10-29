import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outFile = path.resolve("node_modules/.cache/nvu-audit/pro-submission-latency-isolated.mjs");
await mkdir(path.dirname(outFile), { recursive: true });

const fixtures = {
  useTripHistory: `export const publishTripHistoryOptimistically = () => {};`,
  useDriverTrips: `export const publishDriverTripOptimistically = () => {};`,
};

await build({
  entryPoints: ["scripts/test-pro-submission-latency.ts"],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  define: {
    "import.meta.env": JSON.stringify({
      VITE_FIREBASE_PROJECT_ID: "demo-nvu-v36-4-staging",
      VITE_USE_FIREBASE_EMULATORS: "true",
    }),
  },
  plugins: [{
    name: "local-trip-projection-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /useTripHistory$/ }, () => ({
        path: "useTripHistory",
        namespace: "nvu-test-fixture",
      }));
      builder.onResolve({ filter: /useDriverTrips$/ }, () => ({
        path: "useDriverTrips",
        namespace: "nvu-test-fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "nvu-test-fixture" }, ({ path: fixtureName }) => ({
        contents: fixtures[fixtureName],
        loader: "ts",
      }));
    },
  }],
});

await import(pathToFileURL(outFile).href);
