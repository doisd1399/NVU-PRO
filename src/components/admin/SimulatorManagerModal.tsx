import React, { useState } from "react";
import { useOperationalStore } from "../../context/AppContext";
import { db } from "../../lib/firebase";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { X, Trash2, Plus, AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { toast } from "sonner";

interface SimulatorManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SimulatorManagerModal({ isOpen, onClose }: SimulatorManagerModalProps) {
  const { simulators = [] } = useOperationalStore();
  const [name, setName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    const clean = name.trim();
    if (!clean || isSubmitting) return;
    
    try {
      setIsSubmitting(true);
      const id = clean.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      
      if (!id) {
        toast.error("Nome inválido para o simulador.");
        setIsSubmitting(false);
        return;
      }

      await setDoc(doc(db, "simulators", id), {
        id,
        name: clean,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      
      setName("");
      toast.success("Simulador adicionado com sucesso!");
    } catch (error: any) {
      console.error("[NVU] Erro ao criar simulador:", error);
      toast.error("Erro ao adicionar simulador: " + (error.message || "Tente novamente."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm === id) {
      try {
        await deleteDoc(doc(db, "simulators", id));
        setDeleteConfirm(null);
        toast.success("Simulador removido com sucesso!");
      } catch (error: any) {
        console.error("[NVU] Erro ao remover simulador:", error);
        toast.error("Erro ao remover simulador: " + (error.message || "Tente novamente."));
      }
    } else {
      setDeleteConfirm(id);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-[#18181b]/50">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Gerenciar Simuladores</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do simulador"
              className="flex-1 bg-slate-50 dark:bg-[#18181b] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(e); }}
            />
            <Button type="button" onClick={handleCreate} disabled={!name.trim() || isSubmitting} className="rounded-xl h-[38px] px-4 shrink-0">
              <Plus size={16} className="mr-1.5" />
              Adicionar
            </Button>
          </div>

          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
            {simulators.length === 0 && (
              <p className="text-center text-sm text-slate-500 py-4">Nenhum simulador cadastrado.</p>
            )}
            {simulators.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between bg-white dark:bg-[#121213] border border-slate-200 dark:border-slate-800 p-3 rounded-xl shadow-sm">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{s.name}</span>
                
                {deleteConfirm === s.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                      <AlertTriangle size={12} /> Remover?
                    </span>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                    >
                      Confirmar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(s.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
