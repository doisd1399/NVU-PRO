import { ModalSelect } from "../../components/ui/ModalSelect";
import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { Button } from "../../components/ui/Button";
import { X, Trash2, Plus } from "lucide-react";

export default function ManageContract() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  
  const { companies, activeCompanyId } = useCompanyStore();
  const {
    contracts,
    sequences,
    createContract,
    updateContract,
    trailers,
    simulators,
  } = useOperationalStore();
  
  const activeCompany = companies.find((c) => c.id === activeCompanyId);

  // Form state
  const [name, setName] = useState("");
  const [simulator, setSimulator] = useState(activeCompany?.simulatorName || "Euro Truck Simulator 2");
  const [trailerId, setTrailerId] = useState("");
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [mode, setMode] = useState<"simple" | "detailed">("simple");
  const [totalDeliveries, setTotalDeliveries] = useState(1);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>("");
  const trailerlessSimulator = isTrailerlessSimulator(simulator, simulators as unknown[]);

  // Detailed mode state
  const [deliveries, setDeliveries] = useState<
    { origin: string; destination: string }[]
  >([{ origin: "", destination: "" }]);

  useEffect(() => {
    if (activeCompany?.simulatorName && !id) {
      setSimulator(activeCompany.simulatorName);
    }
  }, [activeCompany, id]);

  useEffect(() => {
    if (trailerlessSimulator && trailerId) {
      setTrailerId("");
    }
  }, [trailerlessSimulator, trailerId]);

  useEffect(() => {
    if (id) {
      const contract = contracts.find((c) => c.id === id);
      if (contract) {
        setName(contract.name);
        setSimulator(contract.simulator);
        setTrailerId(contract.trailerId || "");
        setDeadlineDays(contract.deadlineDays || 1);
        setMode(contract.mode);
        setTotalDeliveries(contract.totalDeliveries || 1);
        setSelectedSequenceId(contract.sequenceId || "");
        if (contract.deliveries && contract.deliveries.length > 0) {
          setDeliveries(
            contract.deliveries.map((d) => ({
              origin: d.origin,
              destination: d.destination,
            })),
          );
        }
      }
    }
  }, [id, contracts]);

  const handleAddDelivery = () => {
    setDeliveries((prev) => [...prev, { origin: "", destination: "" }]);
  };

  const handleUpdateDelivery = (
    index: number,
    field: "origin" | "destination",
    value: string,
  ) => {
    const updated = [...deliveries];
    updated[index][field] = value;
    setDeliveries(updated);
  };

  const handleRemoveDelivery = (index: number) => {
    setDeliveries((prev) => prev.filter((_, i) => i !== index));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    const actualTotal =
      mode === "detailed"
        ? deliveries.filter((d) => d.origin && d.destination).length
        : totalDeliveries;
    if (actualTotal === 0) return;

    setIsSubmitting(true);
    
    try {
      if (id) {
        const existingContract = contracts.find((c) => c.id === id);
        await updateContract(id, {
          name,
          simulator,
          trailerId: trailerlessSimulator ? null : trailerId || null,
          deadlineDays,
          mode,
          totalDeliveries: actualTotal,
          deliveries: mode === "detailed" ? deliveries.filter((d) => d.origin && d.destination).map((d) => ({ ...d, id: ("id" in d) ? (d as any).id : crypto.randomUUID() })) : [],
          sequenceId: selectedSequenceId || null,
          sequenceOrder: selectedSequenceId ? (selectedSequenceId === existingContract?.sequenceId ? existingContract.sequenceOrder : 999) : null,
        });
      } else {
        await createContract({
          companyId: activeCompanyId || "",
          name,
          simulator,
          trailerId: trailerlessSimulator ? null : trailerId || null,
          deadlineDays,
          mode,
          totalDeliveries: actualTotal,
          deliveries: mode === "detailed" ? deliveries.filter((d) => d.origin && d.destination).map((d) => ({ ...d, id: ("id" in d) ? (d as any).id : crypto.randomUUID() })) : [],
          sequenceId: selectedSequenceId || null,
          sequenceOrder: selectedSequenceId ? 999 : null,
        });
      }
      
      // Navigate back after success
      navigate("/admin/fleet", { state: { activeTab: "contracts" } });
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-nvu-page font-sans pb-8 px-4 pt-4 sm:pt-6 w-full box-border">
      <div className="max-w-3xl mx-auto flex flex-col">
        <div className="bg-white dark:bg-nvu-surface rounded-[16px] border border-gray-200 dark:border-nvu-line shadow-sm w-full flex flex-col relative overflow-hidden">
          <div className="h-1.5 w-full shrink-0 bg-blue-500"></div>

          {/* Header */}
          <div className="shrink-0 p-4 sm:p-5 border-b border-gray-100 dark:border-nvu-line flex items-center justify-between bg-white dark:bg-nvu-surface z-10">
            <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-nvu-text">
              {id ? "Editar Operação" : "Nova Operação"}
            </h2>
            <button
              type="button"
              onClick={() => navigate("/admin/fleet", { state: { activeTab: "contracts" } })}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-nvu-surface text-gray-500 dark:text-nvu-muted flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1">
            <div className="p-5 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                    Nome da Operação
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Entrega de Grãos Safra 2024"
                    className="w-full bg-white dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                    Simulador Alvo (Automático)
                  </label>
                  <input
                    type="text"
                    value={simulator}
                    disabled
                    className="w-full bg-gray-50 dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-500 dark:text-nvu-muted cursor-not-allowed"
                  />
                </div>
              </div>

              <div className={`grid grid-cols-1 ${trailerlessSimulator ? "sm:grid-cols-1" : "sm:grid-cols-2"} gap-5`}>
                {!trailerlessSimulator && (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                      Reboque Padrão (Opcional)
                    </label>
                    <ModalSelect title="Reboque padrão"
                      value={trailerId}
                      onChange={(e) => setTrailerId(e.target.value)}
                      className="w-full bg-white dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none transition-shadow transition-colors"
                    >
                      <option value="">Nenhum reboque</option>
                      {trailers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </ModalSelect>
                  </div>
                )}
                
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                    Adicionar à pasta (Opcional)
                  </label>
                  <ModalSelect title="Pasta da operação"
                    value={selectedSequenceId}
                    onChange={(e) => setSelectedSequenceId(e.target.value)}
                    className="w-full bg-white dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none transition-shadow transition-colors"
                  >
                    <option value="">Sem pasta</option>
                    {sequences.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </ModalSelect>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                    Prazo (Dias)
                  </label>
                  <input
                    type="number"
                    required
                    value={deadlineDays || ""}
                    onChange={(e) => setDeadlineDays(Number(e.target.value))}
                    min={1}
                    className="w-full bg-white dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft">
                  Modo da Operação
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-3 cursor-pointer bg-white dark:bg-nvu-page px-4 py-3 rounded-xl border border-gray-200 dark:border-nvu-line hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors shadow-sm dark:shadow-none">
                    <input
                      type="radio"
                      checked={mode === "simple"}
                      onChange={() => setMode("simple")}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 border-gray-300 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface"
                    />
                    <span className="font-medium text-[14px] text-gray-900 dark:text-nvu-text">
                      Simples (Qtd)
                    </span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer bg-white dark:bg-nvu-page px-4 py-3 rounded-xl border border-gray-200 dark:border-nvu-line hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors shadow-sm dark:shadow-none">
                    <input
                      type="radio"
                      checked={mode === "detailed"}
                      onChange={() => setMode("detailed")}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 border-gray-300 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface"
                    />
                    <span className="font-medium text-[14px] text-gray-900 dark:text-nvu-text">
                      Detalhado
                    </span>
                  </label>
                </div>
              </div>

              {mode === "simple" && (
                <div className="bg-blue-50/50 dark:bg-blue-900/10 p-5 rounded-xl border border-blue-100 dark:border-blue-900/20">
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft mb-1.5">
                    Quantidade de Entregas Exigidas
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={totalDeliveries || ""}
                    onChange={(e) => setTotalDeliveries(Number(e.target.value))}
                    className="w-full max-w-[200px] bg-white dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow transition-colors"
                  />
                  <p className="text-[12px] text-gray-500 dark:text-nvu-muted mt-2">
                    O motorista precisará completar este número de trabalhos
                    para finalizar a operação. Não há rotas predefinidas.
                  </p>
                </div>
              )}

              {mode === "detailed" && (
                <div className="bg-gray-50/50 dark:bg-nvu-page p-5 rounded-xl border border-gray-200 dark:border-nvu-line space-y-4">
                  <div className="flex flex-col gap-3 mb-2">
                    <div>
                      <h4 className="text-[14px] font-semibold text-gray-900 dark:text-nvu-text">
                        Rotas da Operação ({deliveries.length})
                      </h4>
                      <p className="text-[12px] text-gray-500 dark:text-nvu-muted mt-1">
                        O motorista deverá completar estas viagens específicas.
                      </p>
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddDelivery}
                        className="gap-1.5 text-[12px] h-8 px-4 bg-white dark:bg-nvu-surface border-gray-200 dark:border-nvu-line text-gray-700 dark:text-nvu-text-soft hover:bg-gray-50 dark:hover:bg-nvu-strip shadow-sm w-full sm:w-auto flex justify-center"
                      >
                        <Plus size={14} /> Adicionar Rota
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {deliveries.map((delivery, index) => (
                      <div
                        key={index}
                        className="flex flex-col bg-white dark:bg-nvu-surface p-4 rounded-[12px] border border-gray-200 dark:border-nvu-line shadow-sm dark:shadow-none transition-all focus-within:ring-2 focus-within:ring-blue-500/20 relative"
                      >
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100 dark:border-nvu-line">
                          <span className="text-[12px] font-bold text-gray-500 dark:text-nvu-muted uppercase tracking-wider">
                            {index + 1}. Viagem
                          </span>
                          {deliveries.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveDelivery(index)}
                              className="text-gray-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        
                        <div className="flex flex-col gap-3">
                          <input
                            type="text"
                            value={delivery.origin}
                            onChange={(e) =>
                              handleUpdateDelivery(index, "origin", e.target.value)
                            }
                            placeholder="Origem (Ex: São Paulo)"
                            className="w-full bg-gray-50 dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-lg px-3 py-2 text-[13px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400/80 dark:placeholder:text-nvu-muted"
                          />
                          <input
                            type="text"
                            value={delivery.destination}
                            onChange={(e) =>
                              handleUpdateDelivery(
                                index,
                                "destination",
                                e.target.value
                              )
                            }
                            placeholder="Destino (Ex: Rio de Janeiro)"
                            className="w-full bg-gray-50 dark:bg-nvu-page border border-gray-200 dark:border-nvu-line rounded-lg px-3 py-2 text-[13px] text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400/80 dark:placeholder:text-nvu-muted"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 border-t border-gray-100 dark:border-nvu-line bg-gray-50/50 dark:bg-nvu-surface flex justify-end gap-3 z-10">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto h-10 px-5 text-[14px] bg-white dark:bg-nvu-surface border-gray-200 dark:border-nvu-line text-gray-700 dark:text-nvu-text-soft"
                onClick={() => navigate("/admin/fleet", { state: { activeTab: "contracts" } })}
                disabled={isSubmitting}
              >
                 Cancelar
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto h-10 px-6 text-[14px] bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                disabled={!name.trim() || isSubmitting}
              >
                 {isSubmitting ? "Salvando..." : (id ? "Salvar" : "Criar")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
