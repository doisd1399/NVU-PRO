import React, { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { OptionSelectionModal, type SelectOption } from "./OptionSelectionModal";

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & {
  title: string;
  description?: string;
  placeholder?: string;
  emptyMessage?: string;
  icon?: React.ReactNode;
  showChevron?: boolean;
  searchable?: boolean;
};

function optionText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  return isValidElement<{ children?: React.ReactNode }>(node) ? optionText(node.props.children) : "";
}

function readOptions(children: React.ReactNode, group?: string, groupDisabled = false): SelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; label?: string; children?: React.ReactNode; disabled?: boolean; hidden?: boolean; title?: string }>(child)) return [];
    if (child.type === "option") {
      if (child.props.hidden) return [];
      const label = (child.props.label || optionText(child.props.children)).replace(/\s+/g, " ").trim();
      return [{ value: String(child.props.value ?? label), label, group,
        disabled: groupDisabled || child.props.disabled, description: child.props.title }];
    }
    return readOptions(child.props.children, child.type === "optgroup" ? child.props.label : group,
      groupDisabled || (child.type === "optgroup" && Boolean(child.props.disabled)));
  });
}

/**
 * Custom picker with a noninteractive native field solely for form semantics.
 * Existing change handlers receive the real select event; no Android list opens.
 */
export function ModalSelect({ title, description, placeholder, emptyMessage, icon, showChevron = true, searchable,
  children, className, style, id, disabled, value, defaultValue, onChange, onInvalid, autoFocus, ...props
}: Props) {
  const generatedId = useId();
  const buttonId = id || generatedId;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const options = useMemo(() => readOptions(children), [children]);
  const [uncontrolledValue, setUncontrolledValue] = useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const currentValue = value === undefined ? uncontrolledValue : String(value);
  const selected = options.find(option => option.value === currentValue);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (value === undefined && nativeRef.current) setUncontrolledValue(nativeRef.current.value);
  }, [children, value]);

  return <>
    <button ref={buttonRef} id={buttonId} type="button" disabled={disabled} autoFocus={autoFocus}
      aria-label={props["aria-label"] || title} aria-labelledby={props["aria-labelledby"]}
      aria-describedby={[props["aria-describedby"], `${buttonId}-value`].filter(Boolean).join(" ")}
      aria-required={props.required} aria-invalid={invalid || props["aria-invalid"]}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${buttonId}-options` : undefined} onClick={() => setOpen(true)} style={style}
      className={cn("nvu-modal-select inline-flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[13px] font-medium text-slate-800 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-text", className)}>
      {icon}<span id={`${buttonId}-value`} className="nvu-modal-select-label">{selected?.label || placeholder || "Selecionar"}</span>
      {showChevron && <ChevronDown size={15} strokeWidth={1.7} className="nvu-modal-select-chevron" aria-hidden="true" />}
    </button>
    <select {...props} id={`${buttonId}-field`} ref={nativeRef} disabled={disabled}
      value={value} defaultValue={defaultValue} tabIndex={-1} aria-hidden="true"
      style={{ display: "none" }} onInvalid={event => {
        event.preventDefault(); onInvalid?.(event); setInvalid(true); buttonRef.current?.focus();
      }} onChange={event => { setUncontrolledValue(event.target.value); setInvalid(false); onChange?.(event); }}>
      {children}
    </select>
    <OptionSelectionModal open={open && !disabled} dialogId={`${buttonId}-options`} title={title} description={description} options={options}
      value={currentValue} emptyMessage={emptyMessage} searchable={searchable} onClose={() => setOpen(false)} onSelect={next => {
        const field = nativeRef.current;
        if (!field || field.disabled || field.value === next) return;
        field.value = next;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }} />
  </>;
}
