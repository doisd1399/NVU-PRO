import React, { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { MultiOptionSelectionModal } from "./MultiOptionSelectionModal";
import type { SelectOption } from "./OptionSelectionModal";
import { cn } from "../../lib/utils";

/**
 * Field that shows the chosen options as chips and opens MultiOptionSelectionModal. The whole field opens the picker; each
 * chip has its own remove button above it, so there is no button inside a button.
 */
export function MultiSelectField({ title, description, placeholder, options, values, onChange, disabled = false, emptyMessage, className, minSelected = 1 }: {
  title: string; description?: string; placeholder: string; options: SelectOption[]; values: string[];
  onChange: (values: string[]) => void; disabled?: boolean; emptyMessage?: string; className?: string; minSelected?: number;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter(option => values.includes(option.value));
  const summary = chosen.length ? chosen.map(option => option.label).join(", ") : placeholder;
  return <>
    <div className={cn("nvu-multiselect relative min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 shadow-sm dark:border-nvu-line dark:bg-nvu-page", disabled && "opacity-50", className)} data-testid="multi-select-field">
      <button type="button" disabled={disabled} className="absolute inset-0 h-full w-full rounded-xl" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${title}: ${summary}`} onClick={() => setOpen(true)} />
      <div className="pointer-events-none relative flex min-h-12 flex-wrap items-center gap-1.5 py-2 pl-3 pr-10">
        {chosen.length ? chosen.map(option => <span key={option.value} className="pointer-events-auto inline-flex h-8 items-center gap-1 rounded-[9px] border border-blue-400/40 bg-blue-500/10 pl-2.5 pr-1 text-[13px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
          {option.label}
          <button type="button" disabled={disabled} aria-label={`Remover ${option.label}`} className="grid h-5 w-5 place-items-center rounded-full bg-black/5 dark:bg-white/10"
            onClick={() => onChange(values.filter(value => value !== option.value))}><X size={12} strokeWidth={2.6} aria-hidden="true" /></button>
        </span>) : <span className="px-1 text-[15px] font-semibold text-slate-800 dark:text-nvu-text">{placeholder}</span>}
      </div>
      <ChevronDown size={18} strokeWidth={1.7} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
    <MultiOptionSelectionModal open={open && !disabled} title={title} description={description} options={options} values={values}
      emptyMessage={emptyMessage} minSelected={minSelected} onConfirm={onChange} onClose={() => setOpen(false)} />
  </>;
}
