import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { registerOptionModal } from "../../lib/optionModalStack";
import type { SelectOption } from "./OptionSelectionModal";
import "./OptionSelectionModal.css";

/**
 * Multiple choice version of OptionSelectionModal (same look, same scroll lock and Android Back handling).
 * The rows toggle a draft; only "Confirmar" hands the choice over, closing without it discards the draft.
 */
export function MultiOptionSelectionModal({ open, title, description, options, values, onConfirm, onClose,
  confirmLabel = count => `Confirmar (${count})`, minSelected = 0, emptyMessage = "Nenhuma opção disponível.",
}: {
  open: boolean;
  title: string;
  description?: string;
  options: SelectOption[];
  values: string[];
  onConfirm: (values: string[]) => void;
  onClose: () => void;
  confirmLabel?: (count: number) => string;
  minSelected?: number;
  emptyMessage?: string;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [draft, setDraft] = useState<string[]>(values);

  useEffect(() => {
    if (!open) return;
    setDraft(values);
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => closeRef.current());
    const frame = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('[role="option"]:not([disabled])');
      (first || dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]'))
        .filter(node => node.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (modal.isTop() && dialogRef.current && !dialogRef.current.contains(event.target as Node)) dialogRef.current.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", keepFocus);
      modal.dispose();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const toggle = (value: string) => setDraft(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  // The answer always follows the order of the options, whatever order the rows were toggled in.
  const ordered = options.map(option => option.value).filter(value => draft.includes(value));
  const count = ordered.length;
  return createPortal(
    <div className="nvu-options-overlay" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="nvu-options-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1} data-testid="multi-option-dialog">
        <header className="nvu-options-header">
          <div><h2 id={`${id}-title`}>{title}</h2>
            <p id={`${id}-description`}>{description ? `${description} ` : ""}{count === 1 ? "1 selecionado." : `${count} selecionados.`}</p></div>
          <button type="button" className="nvu-options-close" onClick={onClose} aria-label={`Fechar ${title.toLocaleLowerCase("pt-BR")}`}><X size={18} strokeWidth={1.7} /></button>
        </header>
        <div className="nvu-options-list" role="listbox" aria-multiselectable="true" aria-label={title} onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
          buttons[(next + buttons.length) % buttons.length]?.focus();
        }}>
          {!options.length && <p className="nvu-options-empty" role="status">{emptyMessage}</p>}
          {options.map(option => <button key={option.value} type="button" role="option" aria-selected={draft.includes(option.value)} disabled={option.disabled}
            data-value={option.value} className="nvu-options-item" onClick={() => toggle(option.value)}>
            <span className="nvu-options-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
            <span className="nvu-options-checkbox" aria-hidden="true">{draft.includes(option.value) && <Check size={15} strokeWidth={3} />}</span>
          </button>)}
        </div>
        <footer className="nvu-options-footer">
          <button type="button" className="nvu-options-clear" onClick={() => setDraft([])} disabled={!count}>Limpar</button>
          <button type="button" className="nvu-options-confirm" disabled={count < minSelected} onClick={() => { onConfirm(ordered); onClose(); }}>{confirmLabel(count)}</button>
        </footer>
      </div>
    </div>, document.body,
  );
}
