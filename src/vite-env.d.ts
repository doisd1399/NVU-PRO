/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ENABLE_CLIENT_MIGRATIONS: string;
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  readonly VITE_LEGACY_NOTIFICATIONS_READ_HISTORY?: string;
  readonly VITE_LEGACY_NOTIFICATIONS_REALTIME?: string;
  readonly VITE_LEGACY_NOTIFICATIONS_WRITE_FALLBACK?: string;
  readonly VITE_LEGACY_NOTIFICATIONS_RESOLVE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
