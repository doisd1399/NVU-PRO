import React from "react";
import { ArrowLeft } from "lucide-react";

/** Botão "Voltar" do cabeçalho (só no aplicativo Windows, quando há para onde voltar). */
export function WindowsBackButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return <button type="button" onClick={onClick} aria-label="Voltar" title="Voltar (Alt + ←)" data-testid="windows-back-button"
    className={"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:text-nvu-text-soft dark:hover:bg-nvu-strip " + className}>
    <ArrowLeft size={22} aria-hidden="true" />
  </button>;
}
