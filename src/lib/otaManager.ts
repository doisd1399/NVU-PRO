import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import {
  dispatchLiveUpdateStatus,
  type LiveUpdateStatusDetail,
  type LiveUpdateStatusPhase,
} from "./liveUpdateStatus";

const OTA_CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Local-first APKs opt out of the self-hosted updater at build time. The Web
// deployment can still enable OTA independently with VITE_NVU_SELF_HOSTED_OTA_ENABLE=true.
export const NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE =
  String(import.meta.env.VITE_NVU_NATIVE_BUNDLE_IMMUTABLE || "")
    .trim()
    .toLowerCase() === "true";
const OTA_STATE_KEY = "nvu.self-hosted-ota.state.v2";
const OTA_RUNTIME_REVISION = String(
  import.meta.env.VITE_NVU_RUNTIME_REVISION || "",
).trim();
const OTA_EMBEDDED_BUNDLE_ID = String(
  import.meta.env.VITE_NVU_EMBEDDED_BUNDLE_ID || "",
).trim();

export type OtaErrorCode =
  | "OTA_MANIFEST_INVALID"
  | "OTA_MANIFEST_UNAVAILABLE"
  | "OTA_CHANNEL_MISMATCH"
  | "OTA_NATIVE_VERSION_MISMATCH"
  | "OTA_RUNTIME_MISMATCH"
  | "OTA_BUNDLE_INVALID"
  | "OTA_DOWNLOAD_FAILED"
  | "OTA_CHECKSUM_INVALID"
  | "OTA_SIGNATURE_INVALID"
  | "OTA_ORIGIN_INVALID"
  | "OTA_INSTALL_FAILED"
  | "OTA_STAGING_FAILED"
  | "OTA_ROLLBACK"
  | "OTA_ALREADY_STAGED"
  | "OTA_CONCURRENT_CHECK"
  | "OTA_UNKNOWN_ERROR";

export type OtaPhase = Exclude<LiveUpdateStatusPhase, "started">;

export type OtaDiagnostic = {
  phase: OtaPhase;
  errorCode?: OtaErrorCode;
  message?: string;
  timestamp?: number;
  nativeVersionCode?: string;
  nativeChannel?: string;
  runtimeRevision?: string;
  currentBundle?: string;
  nextBundle?: string;
  manifestVersion?: string;
  manifestBundleId?: string;
  lastCheckAt?: number;
  lastUpdateAt?: number;
};

type SelfHostedManifest = {
  artifactType?: unknown;
  bundleId?: unknown;
  nativeVersionCode?: unknown;
  nativeChannel?: unknown;
  webVersion?: unknown;
  runtimeRevision?: unknown;
  downloadUrl?: unknown;
  checksum?: unknown;
  signature?: unknown;
  signatureRequired?: unknown;
};

type ValidatedManifest = {
  bundleId: string;
  webVersion: string;
  nativeVersionCode: string;
  nativeChannel: string;
  runtimeRevision: string;
  downloadUrl: string;
  checksum: string;
  signature: string;
};

class OtaFailure extends Error {
  constructor(
    public readonly code: OtaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

const OTA_ENABLED =
  String(import.meta.env.VITE_NVU_SELF_HOSTED_OTA_ENABLE || "")
    .trim()
    .toLowerCase() === "true";

const OTA_MANIFEST_URL = String(
  import.meta.env.VITE_NVU_OTA_MANIFEST_URL || "",
).trim();

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const isSelfHostedOtaEnabled = (): boolean =>
  OTA_ENABLED && !NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE && isHttpsUrl(OTA_MANIFEST_URL);

const isValidBundleId = (value: string) => /^[A-Za-z0-9._-]{1,120}$/.test(value);

const readNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readBundleId = (bundle: unknown) => {
  if (!bundle || typeof bundle !== "object") return "";
  const value = (bundle as { bundleId?: unknown }).bundleId;
  return typeof value === "string" ? value.trim() : "";
};

const storageRead = (): OtaDiagnostic | null => {
  try {
    const raw = localStorage.getItem(OTA_STATE_KEY);
    return raw ? (JSON.parse(raw) as OtaDiagnostic) : null;
  } catch {
    return null;
  }
};

const storageWrite = (state: OtaDiagnostic) => {
  try {
    localStorage.setItem(OTA_STATE_KEY, JSON.stringify(state));
  } catch {
    // A restricted WebView must not prevent the application from opening.
  }
};

const errorCodeFrom = (error: unknown): OtaErrorCode => {
  if (error instanceof OtaFailure) return error.code;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("manifest")) return "OTA_MANIFEST_INVALID";
  if (message.includes("checksum")) return "OTA_CHECKSUM_INVALID";
  if (message.includes("signature") || message.includes("public key")) return "OTA_SIGNATURE_INVALID";
  if (message.includes("download") || message.includes("network") || message.includes("fetch")) {
    return "OTA_DOWNLOAD_FAILED";
  }
  if (message.includes("stage") || message.includes("nextbundle")) return "OTA_STAGING_FAILED";
  return "OTA_UNKNOWN_ERROR";
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message.slice(0, 240);
  return String(error).slice(0, 240);
};

export class OtaManager {
  private checkPromise: Promise<void> | null = null;
  private started = false;
  private readySignalled = false;
  private lifecycleCleanup: (() => void) | null = null;
  private intervalId: number | null = null;
  private diagnostic: OtaDiagnostic | null = storageRead();

  getStatus(): OtaDiagnostic | null {
    return this.diagnostic;
  }

  start(): void {
    if (
      this.started ||
      !Capacitor.isNativePlatform() ||
      NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE ||
      !OTA_ENABLED ||
      !isHttpsUrl(OTA_MANIFEST_URL)
    ) return;
    this.started = true;
    this.signalReady();

    const handleResume = () => {
      if (document.visibilityState === "visible") void this.check("resume");
    };
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    this.lifecycleCleanup = () => {
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
    };

    void this.check("startup");
    this.intervalId = window.setInterval(() => void this.check("interval"), OTA_CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.lifecycleCleanup?.();
    this.lifecycleCleanup = null;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.started = false;
  }

  signalReady(): void {
    if (
      this.readySignalled ||
      !Capacitor.isNativePlatform() ||
      NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE ||
      !OTA_ENABLED ||
      !isHttpsUrl(OTA_MANIFEST_URL)
    ) return;
    this.readySignalled = true;
    void     LiveUpdate.ready().catch((error) => {
      // Preparação do runtime é diagnóstico interno, não uma atualização
      // aplicável; não interromper o motorista com um banner de falha.
      console.warn("[OTA] LiveUpdate.ready() falhou", error);
      this.publish({ phase: "idle", runtimeRevision: OTA_RUNTIME_REVISION });
    });
  }

  check(reason: "startup" | "resume" | "interval" | "manual" = "manual"): Promise<void> {
    if (
      !Capacitor.isNativePlatform() ||
      NATIVE_OPERATIONAL_BUNDLE_IMMUTABLE ||
      !OTA_ENABLED ||
      !isHttpsUrl(OTA_MANIFEST_URL)
    ) {
      return Promise.resolve();
    }
    if (this.checkPromise) return this.checkPromise;

    const previous = this.diagnostic;
    const now = Date.now();
    const bypassThrottle = reason === "startup" || reason === "resume";
    if (
      !bypassThrottle &&
      previous?.lastCheckAt &&
      now - previous.lastCheckAt < OTA_CHECK_INTERVAL_MS
    ) {
      return Promise.resolve();
    }

    this.checkPromise = this.runCheck(reason).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  private async runCheck(reason: string): Promise<void> {
    let updateAttempted = false;
    let base: Partial<OtaDiagnostic> = {
      runtimeRevision: OTA_RUNTIME_REVISION,
      lastCheckAt: Date.now(),
    };
    try {
      const nativeVersionCode = String(
        (await LiveUpdate.getVersionCode()).versionCode,
      ).trim();
      const nativeChannel = `production-${nativeVersionCode}`;
      const current = await LiveUpdate.getCurrentBundle();
      const next = await LiveUpdate.getNextBundle();
      const currentBundle = readBundleId(current);
      const nextBundle = readBundleId(next);
      base = {
        ...base,
        nativeVersionCode,
        nativeChannel,
        currentBundle,
        nextBundle,
      };

      this.publish({ phase: "checking", ...base });
      const manifest = await this.readManifest();
      const validated = await this.validateManifest(manifest, nativeVersionCode, nativeChannel);
      this.publish({
        phase: "available",
        ...base,
        manifestVersion: validated.webVersion,
        manifestBundleId: validated.bundleId,
      });

      const effectiveCurrentBundle = currentBundle || OTA_EMBEDDED_BUNDLE_ID;
      if (effectiveCurrentBundle === validated.bundleId || nextBundle === validated.bundleId) {
        this.publish({
          phase: "idle",
          ...base,
          manifestVersion: validated.webVersion,
          manifestBundleId: validated.bundleId,
        });
        return;
      }

      this.publish({
        phase: "downloading",
        ...base,
        manifestVersion: validated.webVersion,
        manifestBundleId: validated.bundleId,
      });
      updateAttempted = true;
      await LiveUpdate.downloadBundle({
        artifactType: "zip",
        bundleId: validated.bundleId,
        url: validated.downloadUrl,
        checksum: validated.checksum,
        signature: validated.signature,
      });

      this.publish({
        phase: "verifying",
        ...base,
        manifestVersion: validated.webVersion,
        manifestBundleId: validated.bundleId,
      });
      await LiveUpdate.setNextBundle({ bundleId: validated.bundleId });
      this.publish({
        phase: "staged",
        ...base,
        nextBundle: validated.bundleId,
        manifestVersion: validated.webVersion,
        manifestBundleId: validated.bundleId,
        lastUpdateAt: Date.now(),
      });
      this.publish({
        phase: "completed",
        ...base,
        nextBundle: validated.bundleId,
        manifestVersion: validated.webVersion,
        manifestBundleId: validated.bundleId,
        lastUpdateAt: Date.now(),
      });
      window.dispatchEvent(
        new CustomEvent("nvu-live-update-staged", {
          detail: { bundleId: validated.bundleId, reason },
        }),
      );
    } catch (error) {
      const code = errorCodeFrom(error);
      if (updateAttempted) {
        this.recordFailure(code, errorMessage(error), error, base);
      } else {
        // Sem bundle baixado ou preparado, indisponibilidade de rede,
        // manifest ausente e canal incompatível são estados sem atualização;
        // eles devem limpar o aviso persistido, não alertar o motorista.
        this.publish({ phase: "idle", ...base });
        console.warn("[OTA] checagem sem atualização aplicável", code, errorMessage(error));
      }
    }
  }

  private async readManifest(): Promise<SelfHostedManifest> {
    if (!isHttpsUrl(OTA_MANIFEST_URL)) {
      throw new OtaFailure("OTA_MANIFEST_INVALID", "manifest URL não é HTTPS");
    }
    const response = await fetch(
      `${OTA_MANIFEST_URL}${OTA_MANIFEST_URL.includes("?") ? "&" : "?"}nvu=${Date.now()}`,
      {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) {
      throw new OtaFailure("OTA_MANIFEST_UNAVAILABLE", `manifest HTTP ${response.status}`);
    }
    try {
      return (await response.json()) as SelfHostedManifest;
    } catch {
      throw new OtaFailure("OTA_MANIFEST_INVALID", "manifest não é JSON válido");
    }
  }

  private async validateManifest(
    manifest: SelfHostedManifest,
    nativeVersionCode: string,
    nativeChannel: string,
  ): Promise<ValidatedManifest> {
    const bundleId = typeof manifest.bundleId === "string" ? manifest.bundleId.trim() : "";
    const webVersion = typeof manifest.webVersion === "string" ? manifest.webVersion.trim() : "";
    const manifestNativeCode = String(manifest.nativeVersionCode ?? "").trim();
    const channel = typeof manifest.nativeChannel === "string" ? manifest.nativeChannel.trim() : "";
    const runtimeRevision = typeof manifest.runtimeRevision === "string" ? manifest.runtimeRevision.trim() : "";
    const downloadUrl = typeof manifest.downloadUrl === "string" ? manifest.downloadUrl.trim() : "";
    const checksum = typeof manifest.checksum === "string" ? manifest.checksum.trim() : "";
    const signature = typeof manifest.signature === "string" ? manifest.signature.trim() : "";

    if (manifest.artifactType !== "zip" || !webVersion || !isValidBundleId(bundleId) || bundleId === "public") {
      throw new OtaFailure("OTA_MANIFEST_INVALID", "manifest obrigatório incompleto");
    }
    if (manifestNativeCode !== nativeVersionCode) {
      throw new OtaFailure("OTA_NATIVE_VERSION_MISMATCH", "nativeVersionCode incompatível");
    }
    if (channel !== nativeChannel) {
      throw new OtaFailure("OTA_CHANNEL_MISMATCH", "nativeChannel incompatível");
    }
    if (runtimeRevision !== OTA_RUNTIME_REVISION) {
      throw new OtaFailure("OTA_RUNTIME_MISMATCH", "runtimeRevision incompatível");
    }
    if (!isHttpsUrl(downloadUrl)) {
      throw new OtaFailure("OTA_ORIGIN_INVALID", "downloadUrl não é HTTPS");
    }
    if (new URL(downloadUrl).origin !== new URL(OTA_MANIFEST_URL).origin) {
      throw new OtaFailure("OTA_ORIGIN_INVALID", "downloadUrl fora da origem do manifest");
    }
    if (!/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new OtaFailure("OTA_CHECKSUM_INVALID", "checksum SHA-256 inválido");
    }
    if (!signature) {
      throw new OtaFailure("OTA_SIGNATURE_INVALID", "assinatura ausente");
    }

    const localBuild = await fetch(`/nvu-build.json?ota-local=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!localBuild.ok) {
      throw new OtaFailure("OTA_RUNTIME_MISMATCH", "metadata local ausente");
    }
    const localMetadata = (await localBuild.json()) as { runtimeRevision?: unknown };
    if (String(localMetadata.runtimeRevision || "").trim() !== runtimeRevision) {
      throw new OtaFailure("OTA_RUNTIME_MISMATCH", "runtimeRevision local incompatível");
    }

    return {
      bundleId,
      webVersion,
      nativeVersionCode,
      nativeChannel,
      runtimeRevision,
      downloadUrl,
      checksum,
      signature,
    };
  }

  private publish(detail: OtaDiagnostic & { phase: LiveUpdateStatusPhase }): void {
    const persisted = { ...detail, timestamp: detail.timestamp || Date.now() };
    this.diagnostic = persisted;
    storageWrite(persisted);
    dispatchLiveUpdateStatus({
      phase: detail.phase,
      bundleId: detail.manifestBundleId || detail.nextBundle,
      errorCode: detail.errorCode,
      timestamp: persisted.timestamp,
    });
  }

  private recordFailure(
    code: OtaErrorCode,
    message: string,
    error: unknown,
    base: Partial<OtaDiagnostic> = {},
  ): void {
    const detail: OtaDiagnostic = {
      phase: "failed",
      errorCode: code,
      message: `${message}${error instanceof Error && error.message !== message ? `: ${error.message.slice(0, 160)}` : ""}`,
      timestamp: Date.now(),
      ...base,
    };
    this.publish(detail);
  }
}

export const otaManager = new OtaManager();
export const getOtaDiagnostic = () => otaManager.getStatus();
export const startOtaManager = () => otaManager.start();
export const checkOta = (reason: "startup" | "resume" | "interval" | "manual" = "manual") =>
  otaManager.check(reason);
export const signalOtaReady = () => otaManager.signalReady();
