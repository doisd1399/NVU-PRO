import React from "react";
import { ModalSelect } from "./ModalSelect";

export interface SafeSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SafeSelectProps {
  value: string;
  options: SafeSelectOption[];
  placeholder: string;
  title: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyMessage?: string;
  className?: string;
}

/** Existing enrollment forms use the same accessible option picker as the app. */
export function SafeSelect({ value, options, placeholder, title, onChange, disabled = false,
  emptyMessage = "Nenhuma opção disponível.", className = "",
}: SafeSelectProps) {
  const safeOptions = (Array.isArray(options) ? options : []).filter(option =>
    typeof option?.value === "string" && option.value.trim() !== "" &&
    typeof option?.label === "string" && option.label.trim() !== "");
  return <ModalSelect value={value} title={title} placeholder={placeholder}
    onChange={event => onChange(event.target.value)} disabled={disabled} emptyMessage={emptyMessage}
    className={`w-full bg-slate-50 dark:bg-nvu-page rounded-xl px-4 h-12 text-[15px] shadow-sm ${className}`}>
    <option value="" disabled hidden>{placeholder}</option>
    {safeOptions.map(option => <option key={option.value} value={option.value} title={option.description}>{option.label}</option>)}
  </ModalSelect>;
}
