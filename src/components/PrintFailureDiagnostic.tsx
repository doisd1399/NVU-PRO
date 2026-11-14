import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { buildPrintDiagnostic } from '../lib/localCommitDiagnostic';
import { hasNativePrintDiagnostics, PrintDiagnostics } from '../lib/printDiagnosticsNative';
import { copySafeDiagnosticToClipboard } from './ProAttemptDiagnosticDetails';

export function usePrintFailureDiagnostic(ownerId: string) {
  const [report, setReport] = useState<{ owner: string; text: string } | null>(null);
  const runtime = useRef<Record<string, unknown>>({});
  const clear = useCallback(() => setReport(null), []);
  useEffect(() => {
    let active = true;
    setReport(null);
    if (hasNativePrintDiagnostics()) {
      void PrintDiagnostics.getRuntimeInfo().then(info => { if (active) runtime.current = { ...runtime.current, ...info }; }).catch(() => undefined);
      // Native storage keeps the last report for support. Opening the form
      // does not mean a new submission failed: never restore it into the UI.
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    void fetch('/nvu-build.json', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null).then(info => {
        if (active && info) runtime.current = { ...runtime.current, webBuildId: info.buildId, webVersion: info.version };
      }).catch(() => undefined).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [ownerId]);
  const capture = (error: unknown, phase: string) => {
    // The screen retains the report even if every storage API is unavailable.
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* report records unavailable */ }
    const text = buildPrintDiagnostic(error, phase, runtime.current, storage);
    setReport({ owner: ownerId, text });
    if (ownerId && hasNativePrintDiagnostics()) void PrintDiagnostics.saveReport({ ownerId, text }).catch(() => undefined);
  };
  return { capture, clear, text: report?.owner === ownerId ? report.text : '' };
}

export function PrintFailureDiagnostic({ text }: { text: string }) {
  if (!text) return null;
  const copy = async () => {
    try { await copySafeDiagnosticToClipboard({ text } as any); toast.success('Diagnóstico copiado.'); }
    catch { toast.error('Selecione e copie o texto do diagnóstico abaixo.'); }
  };
  const share = async () => {
    try { await PrintDiagnostics.shareReport({ text }); }
    catch { toast.error('Não foi possível abrir o compartilhamento. Use Copiar diagnóstico.'); }
  };
  return <section aria-label="Diagnóstico do último erro de envio" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-slate-900 dark:bg-nvu-surface dark:text-nvu-text">
    <p className="font-semibold">Diagnóstico do último erro de envio</p>
    <p className="mt-1">Copie ou compartilhe este diagnóstico com o suporte para identificar a falha.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" onClick={copy} className="rounded-md border border-slate-400 px-3 py-2 font-semibold">Copiar diagnóstico</button>
      {hasNativePrintDiagnostics() && <button type="button" onClick={share} className="rounded-md border border-slate-400 px-3 py-2 font-semibold">Compartilhar diagnóstico</button>}
    </div>
    <details className="mt-2"><summary>Ver diagnóstico</summary>
      <textarea aria-label="Texto do diagnóstico" readOnly value={text} rows={8} className="mt-2 w-full rounded border bg-white p-2 font-mono text-xs text-slate-900" />
    </details>
  </section>;
}
