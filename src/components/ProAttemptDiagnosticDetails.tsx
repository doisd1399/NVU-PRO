import type { SafeProAttemptDiagnostic } from "../lib/proAttemptDiagnostic";

type Props = {
  diagnostic: SafeProAttemptDiagnostic;
  onCopy: (diagnostic: SafeProAttemptDiagnostic) => void;
};

/** Presentation-only: no hooks, storage, network, retry or queue mutation. */
export function ProAttemptDiagnosticDetails({ diagnostic, onCopy }: Props) {
  const fields: Array<[string, string]> = [
    ["attemptId parcial", diagnostic.attemptId],
    ["jobId parcial", diagnostic.jobId],
    ["operationId parcial", diagnostic.operationId],
    ["canonicalTripId parcial", diagnostic.canonicalTripId],
    [diagnostic.timestampLabel, diagnostic.timestamp],
    ["queueStatus", diagnostic.queueStatus],
    ["Código bruto", diagnostic.rawCode],
    ["reasonCode", diagnostic.reasonCode],
    ["stage", diagnostic.stage],
    ["callable/fluxo", diagnostic.callable],
    ["Tentativas registradas", diagnostic.attemptCount],
    ["lastQueueError / mensagem server-side sanitizada", diagnostic.serverMessage],
  ];

  return (
    <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-nvu-line dark:bg-nvu-page/60">
      <summary className="cursor-pointer font-semibold">Diagnóstico local seguro (somente leitura)</summary>
      <dl className="mt-2 grid gap-1">
        {fields.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2">
            <dt className="font-medium text-slate-600 dark:text-nvu-text-soft">{label}</dt>
            <dd className="break-words font-mono text-slate-800 dark:text-nvu-text">{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => onCopy(diagnostic)}
        className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:border-nvu-line dark:hover:bg-nvu-surface"
      >
        Copiar diagnóstico seguro
      </button>
    </details>
  );
}

/** Called only by the explicit copy button; copies no source row or receipt data. */
export async function copySafeDiagnosticToClipboard(diagnostic: SafeProAttemptDiagnostic): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(diagnostic.text);
    return;
  }
  if (typeof document === "undefined") throw new Error("Clipboard indisponível");
  const textarea = document.createElement("textarea");
  textarea.value = diagnostic.text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard indisponível");
}
