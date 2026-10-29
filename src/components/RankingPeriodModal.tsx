import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "react-day-picker/locale/pt-BR";
import { registerOptionModal } from "../lib/optionModalStack";
import { formatRankingMonthLabel } from "../lib/rankingPeriods";
import {
  rankingPeriodPickerRange, rankingPeriodSelectionFromPicker, rankingPickerBusinessDate,
  type RankingPeriodPreset, type RankingPeriodSelection, type RankingPickerRange,
} from "../lib/rankingPeriodSelection";
import "./RankingPeriodModal.css";

const dateLabel = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/** Mounted afresh on open: all edits stay local until Apply, including presets. */
export function RankingPeriodModal({ preset, startDate, endDate, referenceDate, onApply, onClose }: {
  preset: RankingPeriodPreset; startDate: string; endDate: string; referenceDate: Date;
  onApply: (selection: RankingPeriodSelection) => void; onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [draftPreset, setDraftPreset] = useState(preset);
  const [range, setRange] = useState<RankingPickerRange>(() => rankingPeriodPickerRange(preset, startDate, endDate, referenceDate));
  const [month, setMonth] = useState(() => range.from!);
  const selection = rankingPeriodSelectionFromPicker(range, draftPreset);
  const summary = range.from && range.to
    ? `${dateLabel.format(range.from)} – ${dateLabel.format(range.to)}`
    : range.from ? `${dateLabel.format(range.from)} – escolha o último dia` : "Escolha o intervalo";
  const today = rankingPickerBusinessDate(referenceDate);
  const referenceYear = today.getFullYear();
  const firstYear = Math.min(referenceYear - 100, range.from?.getFullYear() ?? referenceYear);
  const lastYear = Math.max(referenceYear + 10, range.to?.getFullYear() ?? referenceYear);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => closeRef.current());
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), select:not([disabled]), [href], [tabindex="0"]',
    ) || []).filter(node => node.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
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
  }, []);

  const choosePreset = (next: "semana" | "mes") => {
    const nextRange = rankingPeriodPickerRange(next, "", "", referenceDate);
    setDraftPreset(next); setRange(nextRange); setMonth(nextRange.from!);
  };

  return createPortal(
    <div className="nvu-period-overlay" onClick={event => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} className="nvu-period-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} tabIndex={-1}>
        <header className="nvu-period-header">
          <div><h2 id={`${id}-title`}>Filtrar por período</h2><p id={`${id}-hint`}>Toque no primeiro e no último dia.</p></div>
          <button type="button" className="nvu-period-close" aria-label="Fechar filtro de período" onClick={onClose}><X size={18} strokeWidth={1.7} /></button>
        </header>
        <div className="nvu-period-body">
          <div className="nvu-period-presets" role="group" aria-label="Períodos rápidos">
            <button type="button" aria-pressed={draftPreset === "semana"} onClick={() => choosePreset("semana")}>Semana atual</button>
            <button type="button" aria-pressed={draftPreset === "mes"} onClick={() => choosePreset("mes")}>{formatRankingMonthLabel(referenceDate)}</button>
          </div>
          <DayPicker className="nvu-period-calendar" mode="range" locale={ptBR} weekStartsOn={0}
            required resetOnSelect min={0} selected={range} onSelect={next => { setRange(next); setDraftPreset("custom"); }}
            month={month} onMonthChange={setMonth} captionLayout="dropdown" navLayout="after"
            startMonth={new Date(firstYear, 0, 1)} endMonth={new Date(lastYear, 11, 1)}
            today={today}
            showOutsideDays
          />
          <div className="nvu-period-selection" role="status" aria-live="polite" aria-atomic="true">
            <CalendarDays size={16} strokeWidth={1.6} aria-hidden="true" /><span>{summary}</span>
          </div>
        </div>
        <footer className="nvu-period-actions">
          <button type="button" className="nvu-period-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="nvu-period-apply" disabled={!selection} onClick={() => { if (selection) onApply(selection); }}>Aplicar filtro</button>
        </footer>
      </div>
    </div>, document.body,
  );
}
