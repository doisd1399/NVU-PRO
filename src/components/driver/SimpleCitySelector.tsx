import { useEffect, useMemo, useState } from "react";
import { Check, MapPin } from "lucide-react";
import {
  filterSimpleAutomationCities,
  simpleCityInitials,
  type SimpleAutomationCity,
} from "../../lib/simpleAutomation";
import { cn } from "../../lib/utils";

interface SimpleCitySelectorProps {
  label: string;
  cities: readonly SimpleAutomationCity[];
  value?: string;
  onChange: (city: SimpleAutomationCity) => void;
  disabled?: boolean;
}

export function SimpleCitySelector({
  label,
  cities,
  value,
  onChange,
  disabled = false,
}: SimpleCitySelectorProps) {
  const initials = useMemo(() => simpleCityInitials(cities), [cities]);
  const [selectedInitial, setSelectedInitial] = useState<string | null>(initials[0] || null);

  useEffect(() => {
    if (!initials.length) {
      setSelectedInitial(null);
      return;
    }

    const valueInitial = cities.find((city) => city.name === value)?.initial;
    setSelectedInitial((current) => {
      if (valueInitial && initials.includes(valueInitial)) return valueInitial;
      if (current && initials.includes(current)) return current;
      return initials[0];
    });
  }, [cities, initials, value]);

  const visibleCities = useMemo(
    () => filterSimpleAutomationCities(cities, selectedInitial),
    [cities, selectedInitial],
  );

  return (
    <section
      aria-label={`Selecionar ${label.toLocaleLowerCase("pt-BR")}`}
      className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm dark:border-white/10 dark:bg-[#15171c]"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <MapPin size={14} className="text-cyan-600 dark:text-cyan-400" />
        <h3 className="text-[13px] font-bold text-slate-900 dark:text-white">{label}</h3>
      </div>

      {initials.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
          Nenhuma cidade cadastrada para este simulador.
        </p>
      ) : (
        <div className="grid max-h-[19rem] grid-cols-[1.75rem_minmax(0,1fr)] gap-1.5 overflow-y-auto pr-0.5">
          <nav
            aria-label={`Filtrar cidades por inicial de ${label.toLocaleLowerCase("pt-BR")}`}
            className="flex min-w-0 flex-col items-center gap-1 border-r border-slate-100 pr-1 dark:border-white/10"
          >
            {initials.map((initial) => {
              const active = selectedInitial === initial;
              return (
                <button
                  key={initial}
                  type="button"
                  disabled={disabled}
                  aria-label={`Mostrar cidades com a letra ${initial}`}
                  aria-pressed={active}
                  onClick={() => setSelectedInitial(initial)}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center self-start rounded-md text-[11px] font-extrabold leading-none transition-colors",
                    active
                      ? "bg-cyan-600 text-white shadow-sm"
                      : "text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 dark:text-slate-400 dark:hover:bg-cyan-400/10 dark:hover:text-cyan-300",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {initial}
                </button>
              );
            })}
          </nav>

          <div className="grid content-start gap-1 sm:grid-cols-2 sm:gap-1.5">
            {visibleCities.map((city) => {
              const active = city.name === value;
              return (
                <button
                  key={city.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onChange(city)}
                  className={cn(
                    "flex min-h-7 items-center justify-between gap-1 rounded-lg border px-3 py-1 text-left text-[12px] leading-tight transition-colors duration-200 ease-out",
                    active
                      ? "border-orange-400 bg-orange-500 font-bold text-white shadow-sm ring-1 ring-orange-300/70 dark:border-orange-300 dark:bg-orange-500 dark:text-white"
                      : "border-slate-200 text-slate-700 hover:border-orange-300 hover:bg-orange-50/70 dark:border-white/10 dark:text-slate-200 dark:hover:border-orange-400/50 dark:hover:bg-orange-400/10",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className="truncate">{city.name}</span>
                  {active && <Check size={15} className="shrink-0 text-white" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
