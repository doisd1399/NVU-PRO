import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { AlertTriangle, Check, Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import {
  SIMPLE_AUTOMATION_SIMULATORS,
  cityId,
  normalizeSimpleCityName,
  sanitizeSimpleAutomationCities,
  type SimpleAutomationCity,
  type SimpleAutomationSimulatorKey,
} from "../../lib/simpleAutomation";
import { db, auth } from "../../lib/firebase";
import { cn } from "../../lib/utils";

interface SimpleCityManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CITIES_COLLECTION = "simple_automation_cities";
const MAX_SIMPLE_CITIES = 500;

export function SimpleCityManagerModal({ isOpen, onClose }: SimpleCityManagerModalProps) {
  const [selectedKey, setSelectedKey] = useState<SimpleAutomationSimulatorKey>("wtds");
  const [cities, setCities] = useState<SimpleAutomationCity[]>([]);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadedVersion, setLoadedVersion] = useState(0);

  const selectedSimulator = useMemo(
    () => SIMPLE_AUTOMATION_SIMULATORS.find((simulator) => simulator.key === selectedKey)!,
    [selectedKey],
  );

  useEffect(() => {
    if (!isOpen) return;
    setDraftName("");
    setEditingId(null);
    setEditingName("");
  }, [isOpen, selectedKey]);

  useEffect(() => {
    if (!isOpen || !selectedKey) return;
    let cancelled = false;

    const loadCities = async () => {
      setIsLoading(true);
      try {
        const snapshot = await getDoc(doc(db, CITIES_COLLECTION, selectedKey));
        if (cancelled) return;
        const data = snapshot.exists() ? snapshot.data() : {};
        setCities(sanitizeSimpleAutomationCities(data?.cities));
        setLoadedVersion(Number(data?.version || 0));
      } catch (error) {
        if (cancelled) return;
        console.error("[NVU] Falha ao carregar cidades do Modo Pro", error);
        setCities([]);
        setLoadedVersion(0);
        toast.error("Não foi possível carregar as cidades deste simulador.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadCities();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedKey]);

  if (!isOpen) return null;

  const saveCities = async (nextCities: SimpleAutomationCity[]) => {
    if (isSaving) return;
    if (!auth.currentUser) {
      toast.error("A sessão Sênior não está disponível.");
      return;
    }

    const normalized = sanitizeSimpleAutomationCities(nextCities);
    if (normalized.length > MAX_SIMPLE_CITIES) {
      toast.error(`Limite de ${MAX_SIMPLE_CITIES} cidades por simulador.`);
      return;
    }

    setIsSaving(true);
    try {
      await setDoc(doc(db, CITIES_COLLECTION, selectedKey), {
        simulatorKey: selectedKey,
        simulatorLabel: selectedSimulator.label,
        cities: normalized.map((city) => city.name),
        version: loadedVersion + 1,
        active: true,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid,
      });
      setCities(normalized);
      setLoadedVersion((version) => version + 1);
      toast.success("Cidades atualizadas.");
    } catch (error) {
      console.error("[NVU] Falha ao salvar cidades do Modo Pro", error);
      toast.error("Não foi possível salvar as cidades. Verifique a autorização Sênior.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdd = async () => {
    const name = normalizeSimpleCityName(draftName);
    if (!name) return;
    const next = sanitizeSimpleAutomationCities([...cities, name]);
    if (next.length === cities.length) {
      toast.error("Essa cidade já está cadastrada.");
      return;
    }
    setDraftName("");
    await saveCities(next);
  };

  const handleStartEdit = (city: SimpleAutomationCity) => {
    setEditingId(city.id);
    setEditingName(city.name);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const name = normalizeSimpleCityName(editingName);
    if (!name) return;
    const next = cities.map((city) => (city.id === editingId ? name : city.name));
    const normalized = sanitizeSimpleAutomationCities(next);
    if (normalized.length !== cities.length) {
      toast.error("Já existe uma cidade com esse nome.");
      return;
    }
    setEditingId(null);
    setEditingName("");
    await saveCities(normalized);
  };

  const handleRemove = async (city: SimpleAutomationCity) => {
    await saveCities(cities.filter((item) => item.id !== city.id));
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#121213]">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Gerenciar cidades</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              As cidades serão usadas somente pelo Modo Pro.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Gerenciar cidades"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 gap-4 overflow-y-auto p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Simulador da lista
            </div>
            {SIMPLE_AUTOMATION_SIMULATORS.map((simulator) => (
              <button
                key={simulator.key}
                type="button"
                onClick={() => setSelectedKey(simulator.key)}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                  selectedKey === simulator.key
                    ? "border-cyan-500 bg-cyan-50 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100"
                    : "border-slate-200 text-slate-700 hover:border-cyan-300 dark:border-white/10 dark:text-slate-300 dark:hover:border-cyan-400/50",
                )}
              >
                <div className="text-sm font-bold">{simulator.shortLabel}</div>
                <div className="mt-0.5 text-[11px] opacity-75">{simulator.label}</div>
              </button>
            ))}
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
              <AlertTriangle size={14} className="mb-1" />
              WTDS e WBDS permanecem em listas completamente separadas.
            </div>
          </aside>

          <section className="min-w-0">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Lista atual</div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{selectedSimulator.label}</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                {cities.length} cidades
              </span>
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleAdd();
                }}
                placeholder="Adicionar cidade"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-white/5 dark:text-white"
                disabled={isLoading || isSaving}
              />
              <Button type="button" onClick={() => void handleAdd()} disabled={!draftName.trim() || isLoading || isSaving} className="rounded-xl px-3">
                <Plus size={16} className="mr-1" /> Adicionar
              </Button>
            </div>

            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  Carregando cidades…
                </div>
              ) : cities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
                  Nenhuma cidade cadastrada para {selectedSimulator.shortLabel}.
                </div>
              ) : (
                cities.map((city) => (
                  <div key={city.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-white/10">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-xs font-extrabold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">
                      {city.initial}
                    </span>
                    {editingId === city.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void handleSaveEdit();
                          if (event.key === "Escape") setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-cyan-400 bg-white px-2 py-1.5 text-sm outline-none dark:bg-white/5 dark:text-white"
                        disabled={isSaving}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{city.name}</span>
                    )}
                    {editingId === city.id ? (
                      <button type="button" onClick={() => void handleSaveEdit()} disabled={isSaving} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-400/10" aria-label={`Salvar ${city.name}`}>
                        <Check size={16} />
                      </button>
                    ) : (
                      <button type="button" onClick={() => handleStartEdit(city)} disabled={isSaving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-cyan-600 dark:hover:bg-white/5" aria-label={`Editar ${city.name}`}>
                        <Edit3 size={16} />
                      </button>
                    )}
                    <button type="button" onClick={() => void handleRemove(city)} disabled={isSaving} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-400/10" aria-label={`Remover ${city.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Save size={14} />
              {isSaving ? "Salvando alteração…" : "Cada alteração é salva imediatamente no simulador selecionado."}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
