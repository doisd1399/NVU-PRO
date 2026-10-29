import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { registerOptionModal } from "../../lib/optionModalStack";
import "./OptionSelectionModal.css";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
};

const normalizedSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function OptionSelectionModal({ open, dialogId, title, description, options, value, onSelect, onClose,
  emptyMessage = "Nenhuma opção disponível.", searchable,
}: {
  open: boolean;
  dialogId?: string;
  title: string;
  description?: string;
  options: SelectOption[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  emptyMessage?: string;
  searchable?: boolean;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [query, setQuery] = useState("");
  const [focusedValue, setFocusedValue] = useState(value);
  const hasSearch = searchable ?? options.length > 7;
  const filteredOptions = useMemo(() => {
    const term = normalizedSearch(query.trim());
    return term ? options.filter(option => normalizedSearch(`${option.label} ${option.description || ""} ${option.group || ""}`).includes(term)) : options;
  }, [options, query]);
  const activeValue = filteredOptions.some(option => option.value === focusedValue && !option.disabled)
    ? focusedValue : filteredOptions.find(option => !option.disabled)?.value;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFocusedValue(value);
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => closeRef.current());
    const frame = requestAnimationFrame(() => {
      const selected = dialogRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not([disabled])');
      const first = dialogRef.current?.querySelector<HTMLElement>('[role="option"]:not([disabled])');
      const target = hasSearch ? searchRef.current : selected || first;
      (target || dialogRef.current)?.focus();
      selected?.scrollIntoView({ block: "nearest" });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex="0"]'));
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (modal.isTop() && dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        dialogRef.current.focus();
      }
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
  const focusOption = (index: number) => {
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') || []);
    const button = buttons[(index + buttons.length) % buttons.length];
    if (button) { setFocusedValue(button.dataset.value!); button.focus(); }
  };
  return createPortal(
    <div className="nvu-options-overlay" onClick={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} id={dialogId || `${id}-dialog`} className="nvu-options-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}>
        <header className="nvu-options-header">
          <div><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div>
          <button type="button" className="nvu-options-close" onClick={onClose} aria-label={`Fechar ${title.toLocaleLowerCase("pt-BR")}`}><X size={18} strokeWidth={1.7} /></button>
        </header>
        {hasSearch && <label className="nvu-options-search">
          <Search size={17} strokeWidth={1.7} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Buscar opção" aria-label={`Buscar em ${title.toLocaleLowerCase("pt-BR")}`} autoComplete="off"
            onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); focusOption(0); } }} />
        </label>}
        <div className="nvu-options-list" role="listbox" aria-label={title} onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          focusOption(event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
        }}>
          {!filteredOptions.length && <p className="nvu-options-empty" role="status">{query ? "Nenhum resultado para esta busca." : emptyMessage}</p>}
          {filteredOptions.map((option, index) => <React.Fragment key={option.value}>
            {option.group && option.group !== filteredOptions[index - 1]?.group && <p className="nvu-options-group">{option.group}</p>}
            <button type="button" role="option" aria-selected={option.value === value} disabled={option.disabled}
              data-value={option.value} tabIndex={option.value === activeValue ? 0 : -1}
              onFocus={() => setFocusedValue(option.value)} className="nvu-options-item" onClick={() => { onSelect(option.value); onClose(); }}>
              <span className="nvu-options-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
              <span className="nvu-options-check" aria-hidden="true">{option.value === value && <Check size={16} strokeWidth={2} />}</span>
            </button>
          </React.Fragment>)}
        </div>
      </div>
    </div>, document.body,
  );
}
