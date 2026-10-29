import { Capacitor, registerPlugin } from '@capacitor/core';
export const PrintDiagnostics = registerPlugin<{
  getRuntimeInfo(): Promise<Record<string, unknown>>;
  saveReport(input: { ownerId: string; text: string }): Promise<void>;
  readReport(input: { ownerId: string }): Promise<{ text: string }>;
  shareReport(input: { text: string }): Promise<void>;
}>('PrintDiagnostics');
export const hasNativePrintDiagnostics = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PrintDiagnostics');
