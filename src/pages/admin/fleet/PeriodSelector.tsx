import React, { useState } from "react";
import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../../lib/utils";

export type PeriodOption =
  | "today"
  | "7days"
  | "15days"
  | "thisMonth"
  | "custom";

export interface DateRange {
  from: Date | undefined;
  to?: Date | undefined;
}

interface PeriodSelectorProps {
  onPeriodChange: (range: DateRange | undefined) => void;
}

export function PeriodSelector({ onPeriodChange }: PeriodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeOption, setActiveOption] = useState<PeriodOption>("7days");
  const [customRange, setCustomRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const options: { id: PeriodOption; label: string }[] = [
    { id: "today", label: "Hoje" },
    { id: "7days", label: "Últimos 7 dias" },
    { id: "15days", label: "Últimos 15 dias" },
    { id: "thisMonth", label: "Este mês" },
    { id: "custom", label: "Personalizado" },
  ];

  const handleSelectOption = (option: PeriodOption) => {
    setActiveOption(option);
    const today = new Date();

    if (option === "today") {
      onPeriodChange({ from: today, to: today });
      setIsOpen(false);
    } else if (option === "7days") {
      onPeriodChange({ from: subDays(today, 6), to: today });
      setIsOpen(false);
    } else if (option === "15days") {
      onPeriodChange({ from: subDays(today, 14), to: today });
      setIsOpen(false);
    } else if (option === "thisMonth") {
      onPeriodChange({ from: startOfMonth(today), to: endOfMonth(today) });
      setIsOpen(false);
    } else if (option === "custom") {
      // Keep open to select custom dates on calendar
    }
  };

  const nextMonth = () =>
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
    );
  const prevMonth = () =>
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
    );

  // Calendar logic
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from top-left Sunday

  const endDate = new Date(monthEnd);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // End at bottom-right Saturday

  const dateFormat = "d";
  const days = [];
  let day = startDate;
  let formattedDate = "";

  while (day <= endDate) {
    for (let i = 0; i < 7; i++) {
      formattedDate = format(day, dateFormat);
      const cloneDay = new Date(day);

      const isSelected =
        customRange.from && customRange.to
          ? isWithinInterval(cloneDay, {
              start: customRange.from,
              end: customRange.to,
            })
          : customRange.from &&
            cloneDay.getTime() === customRange.from.getTime();

      const isStart =
        customRange.from && cloneDay.getTime() === customRange.from.getTime();
      const isEnd =
        customRange.to && cloneDay.getTime() === customRange.to.getTime();
      const isCurrentMonth = cloneDay.getMonth() === currentMonth.getMonth();

      days.push(
        <div
          key={cloneDay.toISOString()}
          onClick={() => {
            if (!customRange.from || (customRange.from && customRange.to)) {
              setCustomRange({ from: cloneDay, to: undefined });
            } else {
              if (cloneDay < customRange.from) {
                setCustomRange({ from: cloneDay, to: customRange.from });
              } else {
                setCustomRange({ from: customRange.from, to: cloneDay });
              }
            }
          }}
          className={cn(
            "h-8 flex items-center justify-center text-[13px] cursor-pointer transition-all rounded-md relative z-10",
            !isCurrentMonth
              ? "text-slate-300 dark:text-slate-600"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
            isSelected && isCurrentMonth && !isStart && !isEnd
              ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-none"
              : "",
            (isStart || isEnd) && isCurrentMonth
              ? "bg-blue-600 text-white hover:bg-blue-700 rounded-md font-semibold"
              : "",
          )}
        >
          {formattedDate}
        </div>,
      );
      day.setDate(day.getDate() + 1);
    }
  }

  const getButtonLabel = () => {
    if (activeOption !== "custom") {
      return (
        options.find((o) => o.id === activeOption)?.label || "Últimos 7 dias"
      );
    }
    if (customRange.from && customRange.to) {
      if (customRange.from.getTime() === customRange.to.getTime()) {
        return format(customRange.from, "dd/MM/yyyy");
      }
      return `${format(customRange.from, "dd/MM")} → ${format(customRange.to, "dd/MM")}`;
    }
    if (customRange.from) {
      return format(customRange.from, "dd/MM/yyyy");
    }
    return "Selecionar período...";
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 bg-slate-50 dark:bg-[#1A1F26] hover:bg-slate-100 dark:hover:bg-[#2A2F3A] transition-colors border border-slate-200 dark:border-[#2A2F3A] px-3.5 py-2 rounded-xl cursor-pointer active:scale-[0.98] shadow-sm min-w-[150px] justify-between"
      >
        <div className="flex items-center gap-2">
          <CalendarIcon
            size={16}
            className="text-slate-500 dark:text-slate-400"
          />
          <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">
            {getButtonLabel()}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-slate-400 shrink-0 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[100] bg-black/20 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed sm:absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:top-[calc(100%+8px)] sm:left-auto sm:right-0 sm:translate-x-0 sm:translate-y-0 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[20px] shadow-2xl sm:shadow-xl z-[110] flex flex-col sm:flex-row overflow-hidden animate-in fade-in zoom-in-95 w-[calc(100vw-2rem)] sm:w-auto max-w-[340px] sm:max-w-none">
            {/* Options List */}
            <div className="w-full sm:w-[180px] p-2 border-b sm:border-b-0 sm:border-r border-slate-100 dark:border-[#2A2F3A] space-y-1">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelectOption(opt.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors text-left",
                    activeOption === opt.id
                      ? "bg-slate-50 dark:bg-[#2A2F3A]"
                      : "hover:bg-slate-50 dark:hover:bg-[#2A2F3A]/50",
                  )}
                >
                  <span
                    className={cn(
                      "text-[14px] font-medium",
                      activeOption === opt.id
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-300",
                    )}
                  >
                    {opt.label}
                  </span>
                  {activeOption === opt.id && (
                    <Check
                      size={16}
                      className="text-blue-600 dark:text-blue-400"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Custom Calendar */}
            {activeOption === "custom" && (
              <div className="p-4 w-full sm:w-[280px]">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[14px] font-bold text-slate-900 dark:text-white capitalize">
                    {format(currentMonth, "MMMM yyyy", { locale: ptBR })}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={prevMonth}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#2A2F3A] rounded-lg text-slate-500 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={nextMonth}
                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#2A2F3A] rounded-lg text-slate-500 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 mb-2">
                  {["D", "S", "T", "Q", "Q", "S", "S"].map((day, i) => (
                    <div
                      key={i}
                      className="text-center text-[12px] font-semibold text-slate-400 mb-2"
                    >
                      {day}
                    </div>
                  ))}
                  {days}
                </div>

                <button
                  onClick={() => {
                    if (customRange.from) {
                      onPeriodChange(customRange);
                      setIsOpen(false);
                    }
                  }}
                  disabled={!customRange.from}
                  className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl py-2 text-[13px] font-semibold transition-colors"
                >
                  Aplicar Período
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
