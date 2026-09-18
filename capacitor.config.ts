import type { CapacitorConfig } from "@capacitor/cli";

const selfHostedOtaManifestUrl = String(
  process.env.NVU_OTA_MANIFEST_URL || process.env.VITE_NVU_OTA_MANIFEST_URL || "",
).trim();
const selfHostedOtaPublicKey = String(
  process.env.NVU_OTA_PUBLIC_KEY || process.env.VITE_NVU_OTA_PUBLIC_KEY || "",
).trim();
const selfHostedOtaEnabled =
  String(
    process.env.NVU_SELF_HOSTED_OTA_ENABLE ||
      process.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE ||
      "",
  ).trim().toLowerCase() === "true"
  && Boolean(selfHostedOtaManifestUrl)
  && Boolean(selfHostedOtaPublicKey);
const nativeChannel = String(
  process.env.NVU_NATIVE_CHANNEL || "production-359",
).trim();

/**
 * Production always starts from Web assets bundled into the APK.
 * The self-hosted updater is manual/background-safe: it never uses the
 * Capawesome Cloud API and never reloads the app during an active session.
 * A build can enable rollback only when its Netlify manifest URL and RSA
 * public key are explicitly provided.
 */
const config: CapacitorConfig = {
  appId: "com.nvu.operacional",
  appName: "nvu",
  webDir: "dist",
  plugins: {
    FirebaseAuthentication: { skipNativeAuth: false, providers: ["google.com"] },
    // The NVU theme is the authority for the first native paint. Without this
    // explicit LIGHT default, Capacitor SystemBars uses Android uiMode while
    // the WebView is still mounting and can leave white icons on NVU light UI.
    SystemBars: { style: "LIGHT" },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    LiveUpdate: {
      autoUpdateStrategy: "none",
      // A atualização é baixada e preparada pelo OTAManager; o plugin só
      // promove o bundle no próximo reinício. Se o novo WebView não sinalizar
      // ready em 10 s, o plugin volta ao bundle nativo e bloqueia o bundle
      // revertido para não repetir um ciclo de falha.
      autoBlockRolledBackBundles: selfHostedOtaEnabled,
      readyTimeout: selfHostedOtaEnabled ? 10_000 : 0,
      defaultChannel: nativeChannel,
      ...(selfHostedOtaPublicKey ? { publicKey: selfHostedOtaPublicKey } : {}),
    },
  },
};

export default config;
