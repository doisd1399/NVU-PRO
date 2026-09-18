import React, { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

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

/**
 * DOM-based select used instead of the native <select>. Native option dialogs
 * are unreliable inside some Android WebViews and embedded AI Studio previews.
 */
export function SafeSelect({
  value,
  options,
  placeholder,
  title,
  onChange,
  disabled = false,
  emptyMessage = "Nenhuma opção disponível.",
  className = "",
}: SafeSelectProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const safeOptions = useMemo(
    () =>
      (Array.isArray(options) ? options : []).filter(
        (option) =>
          typeof option?.value === "string" &&
          option.value.trim() !== "" &&
          typeof option?.label === "string" &&
          option.label.trim() !== "",
      ),
    [options],
  );

  const selected = safeOptions.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={titleId}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`w-full bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm flex items-center justify-between gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span
          className={
            selected
              ? "truncate text-slate-900 dark:text-[#fafafa]"
              : "truncate text-slate-500 dark:text-[#a1a1aa]"
          }
        >
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={18} className="shrink-0 text-slate-400" />
      </button>

      {open && !disabled && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            aria-label="Fechar opções"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 w-full sm:max-w-md max-h-[76vh] bg-white dark:bg-[#18181b] rounded-t-[24px] sm:rounded-[24px] border border-slate-200 dark:border-[#2A2F3A] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 dark:border-[#2A2F3A]">
              <h2
                id={titleId}
                className="text-base font-bold text-slate-900 dark:text-[#fafafa]"
              >
                {title}
              </h2>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-[#27272a]"
              >
                <X size={19} />
              </button>
            </div>

            <div role="listbox" className="p-3 overflow-y-auto max-h-[62vh]">
              {safeOptions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-[#a1a1aa]">
                  {emptyMessage}
                </div>
              ) : (
                safeOptions.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      key={option.value}
                      onClick={() => choose(option.value)}
                      className={`w-full flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl text-left transition-colors ${
                        isSelected
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                          : "text-slate-800 hover:bg-slate-50 dark:text-[#e4e4e7] dark:hover:bg-[#27272a]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="block text-xs mt-0.5 text-slate-500 dark:text-[#a1a1aa] truncate">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {isSelected && <Check size={18} className="shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
