import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
  const runtimeRevision = String(packageJson.gtoWebRuntimeRevision || "").trim();
  const otaManifestUrl = String(
    process.env.VITE_NVU_OTA_MANIFEST_URL || packageJson.otaManifestUrl || "",
  ).trim();
  const otaEnabled =
    String(
      process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
        packageJson.selfHostedOtaEnabled ||
        false,
    ).trim().toLowerCase() === "true";
  const otaEmbeddedBundleId = String(
    process.env.VITE_NVU_EMBEDDED_BUNDLE_ID || "",
  ).trim();
  const injectedPort = Number.parseInt(process.env.PORT || "", 10);
  const runtimePort =
    Number.isFinite(injectedPort) && injectedPort > 0 ? injectedPort : 3000;

  return {
    define: {
      "import.meta.env.VITE_NVU_RUNTIME_REVISION": JSON.stringify(runtimeRevision),
      "import.meta.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE": JSON.stringify(otaEnabled),
      "import.meta.env.VITE_NVU_OTA_MANIFEST_URL": JSON.stringify(otaManifestUrl),
      "import.meta.env.VITE_NVU_EMBEDDED_BUNDLE_ID": JSON.stringify(otaEmbeddedBundleId),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom/client",
        "react-router-dom",
        "firebase/app",
        "firebase/auth",
        "firebase/firestore",
        "firebase/storage",
        "lucide-react",
      ],
    },
    build: {
      outDir: "dist",
      target: "es2022",
      minify: "esbuild",
      sourcemap: false,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("lucide-react")) return "vendor-icons";
              if (id.includes("tesseract.js")) return "vendor-tesseract";
              if (id.includes("motion") || id.includes("framer-motion")) return "vendor-motion";
              return "vendor";
            }
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: runtimePort,
      warmup: {
        clientFiles: [
          "./src/main.tsx",
          "./src/App.tsx",
          "./src/pages/Portal.tsx",
          "./src/pages/Login.tsx",
          "./src/pages/SelectProfile.tsx",
        ],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
    },
    preview: {
      host: "0.0.0.0",
      port: runtimePort,
    },
  };
});
