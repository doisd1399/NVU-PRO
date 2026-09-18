import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  Eye,
  Gamepad2,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../ui/Button";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { toast } from "sonner";
import { db } from "../../lib/firebase";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";

function normalizeSearch(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simulatorKey(value: unknown): string {
  const normalized = normalizeSearch(value).replace(/\s/g, "");
  if (!normalized) return "all";
  if (normalized === "gto" || normalized.includes("globaltruckonline")) return "gto";
  if (normalized === "ets2" || normalized.includes("eurotrucksimulator2")) return "ets2";
  if (normalized === "ats" || normalized.includes("americantrucksimulator")) return "ats";
  if (normalized === "toe3" || normalized.includes("truckersofeurope3")) return "toe3";
  return normalized;
}

function buildSearchTokens(...values: unknown[]): string[] {
  const tokens = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeSearch(value);
    if (!normalized) return;
    if (normalized.length <= 120) tokens.add(normalized);
    normalized.split(" ").filter(Boolean).forEach((word) => {
      tokens.add(word);
      for (let length = 3; length <= word.length && length <= 18; length += 1) {
        tokens.add(word.slice(0, length));
      }
    });
  });
  return Array.from(tokens).slice(0, 120);
}

function timestampToMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPublicationDate(value: any): string {
  const milliseconds = timestampToMillis(value);
  if (!milliseconds) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(milliseconds));
}

type ModalView = "create" | "published";
type CommunicationsQueryMode = "sortAt" | "documentId";

const COMMUNICATIONS_PAGE_SIZE = 20;

type CommunicationRecord = {
  id: string;
  titulo: string;
  mensagem: string;
  simuladorId?: string;
  simulador?: string;
  simuladorKey?: string;
  status?: string;
  autorId?: string;
  autorNome?: string;
  publishedAt?: any;
  published_at?: any;
  publicadoEm?: any;
  dataPublicacao?: any;
  approvedAt?: any;
  createdAt?: any;
  updatedAt?: any;
  sortAt?: any;
  dataReferencia?: any;
};

interface CreateNewsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateNewsModal({ isOpen, onClose }: CreateNewsModalProps) {
  const { currentUser } = useSessionStore();
  const { simulators } = useOperationalStore();
  const [activeView, setActiveView] = useState<ModalView>("create");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSimulator, setSelectedSimulator] = useState("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [communications, setCommunications] = useState<CommunicationRecord[]>([]);
  const [communicationsCursor, setCommunicationsCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [communicationsQueryMode, setCommunicationsQueryMode] = useState<CommunicationsQueryMode>("sortAt");
  const [hasMoreCommunications, setHasMoreCommunications] = useState(false);
  const [hasLoadedCommunications, setHasLoadedCommunications] = useState(false);
  const [isLoadingCommunications, setIsLoadingCommunications] = useState(false);
  const [isLoadingMoreCommunications, setIsLoadingMoreCommunications] = useState(false);
  const [communicationsError, setCommunicationsError] = useState("");
  const communicationsRequestRef = useRef(0);
  const communicationsLoadInFlightRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [simulatorFilter, setSimulatorFilter] = useState("all");
  const [editingCommunication, setEditingCommunication] = useState<CommunicationRecord | null>(null);
  const [viewingCommunication, setViewingCommunication] = useState<CommunicationRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommunicationRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const simulatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    (simulators || []).forEach((simulator: any) => {
      const key = simulatorKey(simulator?.name || simulator?.id);
      const label = String(simulator?.name || simulator?.id || "").trim();
      if (key && key !== "all" && label && !map.has(key)) map.set(key, label);
    });
    communications.forEach((communication) => {
      const key = simulatorKey(
        communication.simuladorKey || communication.simuladorId || communication.simulador,
      );
      const label = String(communication.simulador || key.toUpperCase()).trim();
      if (key && key !== "all" && label && !map.has(key)) map.set(key, label);
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [communications, simulators]);

  const mapCommunicationDocuments = useCallback((documents: QueryDocumentSnapshot<DocumentData>[]) => (
    documents
      .map((snapshotDocument) => ({
        id: snapshotDocument.id,
        ...snapshotDocument.data(),
      } as CommunicationRecord))
      .filter((communication) => normalizeSearch(communication.status || "publicado") === "publicado")
      .sort((left, right) => {
        const rightDate = timestampToMillis(right.sortAt || right.createdAt || right.dataReferencia);
        const leftDate = timestampToMillis(left.sortAt || left.createdAt || left.dataReferencia);
        return rightDate - leftDate;
      })
  ), []);

  const loadCommunications = useCallback(async (reset = false) => {
    if (!reset && (!communicationsCursor || communicationsLoadInFlightRef.current)) return;

    const requestId = ++communicationsRequestRef.current;
    const cursor = reset ? null : communicationsCursor;
    const requestedMode = reset ? "sortAt" : communicationsQueryMode;
    communicationsLoadInFlightRef.current = true;

    if (reset) {
      setIsLoadingCommunications(true);
      setCommunicationsError("");
    } else {
      setIsLoadingMoreCommunications(true);
    }

    const executePage = async (mode: CommunicationsQueryMode) => {
      const constraints = mode === "sortAt"
        ? [orderBy("sortAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(COMMUNICATIONS_PAGE_SIZE)]
        : [...(cursor ? [startAfter(cursor)] : []), limit(COMMUNICATIONS_PAGE_SIZE)];
      return getDocs(query(collection(db, "nvu_comunicados"), ...constraints));
    };

    try {
      let mode = requestedMode;
      let snapshot;
      try {
        snapshot = await executePage(mode);
      } catch (primaryError) {
        if (mode !== "sortAt" || cursor) throw primaryError;
        console.warn("[NVU NEWS] Ordenação por sortAt indisponível; usando paginação compatível.", primaryError);
        mode = "documentId";
        snapshot = await executePage(mode);
      }

      if (requestId !== communicationsRequestRef.current) return;

      const nextCommunications = mapCommunicationDocuments(snapshot.docs);
      setCommunications((current) => {
        const merged = reset ? nextCommunications : [...current, ...nextCommunications];
        return Array.from(new Map(merged.map((communication) => [communication.id, communication])).values())
          .sort((left, right) => {
            const rightDate = timestampToMillis(right.sortAt || right.createdAt || right.dataReferencia);
            const leftDate = timestampToMillis(left.sortAt || left.createdAt || left.dataReferencia);
            return rightDate - leftDate;
          });
      });
      setCommunicationsQueryMode(mode);
      setCommunicationsCursor(snapshot.docs.at(-1) || null);
      setHasMoreCommunications(snapshot.docs.length === COMMUNICATIONS_PAGE_SIZE);
      setHasLoadedCommunications(true);
      setCommunicationsError("");
    } catch (snapshotError) {
      if (requestId !== communicationsRequestRef.current) return;
      console.error("[NVU NEWS] Erro ao carregar comunicados:", snapshotError);
      setCommunicationsError("Não foi possível carregar os comunicados publicados.");
    } finally {
      if (requestId === communicationsRequestRef.current) {
        communicationsLoadInFlightRef.current = false;
        setIsLoadingCommunications(false);
        setIsLoadingMoreCommunications(false);
      }
    }
  }, [
    communicationsCursor,
    communicationsQueryMode,
    mapCommunicationDocuments,
  ]);

  useEffect(() => {
    if (!isOpen || activeView !== "published" || hasLoadedCommunications) return;
    void loadCommunications(true);
  }, [activeView, hasLoadedCommunications, isOpen, loadCommunications]);

  const filteredCommunications = useMemo(() => {
    const normalizedQuery = normalizeSearch(searchTerm);
    return communications.filter((communication) => {
      const communicationSimulator = simulatorKey(
        communication.simuladorKey || communication.simuladorId || communication.simulador,
      );
      const matchesSimulator = simulatorFilter === "all" || communicationSimulator === simulatorFilter;
      const matchesSearch = !normalizedQuery || normalizeSearch([
        communication.titulo,
        communication.mensagem,
        communication.simulador,
        communication.autorNome,
      ].join(" ")).includes(normalizedQuery);
      return matchesSimulator && matchesSearch;
    });
  }, [communications, searchTerm, simulatorFilter]);

  if (!isOpen) return null;

  const resetForm = () => {
    setTitle("");
    setMessage("");
    setSelectedSimulator("all");
    setEditingCommunication(null);
    setError("");
  };

  const resetAndClose = () => {
    resetForm();
    setActiveView("create");
    setViewingCommunication(null);
    setDeleteTarget(null);
    setSearchTerm("");
    setSimulatorFilter("all");
    setCommunications([]);
    setCommunicationsCursor(null);
    setCommunicationsQueryMode("sortAt");
    setHasMoreCommunications(false);
    setHasLoadedCommunications(false);
    setCommunicationsError("");
    communicationsRequestRef.current += 1;
    communicationsLoadInFlightRef.current = false;
    onClose();
  };

  const openCreateView = () => {
    resetForm();
    setViewingCommunication(null);
    setActiveView("create");
  };

  const openPublishedView = () => {
    setViewingCommunication(null);
    setActiveView("published");
  };

  const startEditing = (communication: CommunicationRecord) => {
    setTitle(String(communication.titulo || ""));
    setMessage(String(communication.mensagem || ""));
    setSelectedSimulator(simulatorKey(
      communication.simuladorKey || communication.simuladorId || communication.simulador,
    ));
    setEditingCommunication(communication);
    setViewingCommunication(null);
    setError("");
    setActiveView("create");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !message.trim()) {
      setError("Título e mensagem são obrigatórios.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const simulator = simulatorOptions.find((option) => option.value === selectedSimulator);
      const commonPayload = {
        titulo: title.trim(),
        mensagem: message.trim(),
        simuladorId: selectedSimulator === "all" ? "" : selectedSimulator,
        simulador: simulator?.label || "",
        simuladorKey: selectedSimulator,
        updatedAt: serverTimestamp(),
        searchTokens: buildSearchTokens(
          title.trim(),
          message.trim(),
          simulator?.label,
          currentUser?.name,
          "comunicado NVU",
        ),
      };

      if (editingCommunication) {
        await updateDoc(doc(db, "nvu_comunicados", editingCommunication.id), {
          ...commonPayload,
          editadoEm: serverTimestamp(),
          editadoPorId: currentUser?.id || "",
          editadoPorNome: currentUser?.name || "Painel Sênior NVU",
        });
        toast.success("Comunicado atualizado.");
      } else {
        await addDoc(collection(db, "nvu_comunicados"), {
          schemaVersion: "nvu_news_compact_v1",
          secao: "comunicados",
          tipo: "comunicado",
          categoria: "comunicado",
          ...commonPayload,
          origem: "senior",
          status: "publicado",
          visibilidade: "publico",
          autorId: currentUser?.id || "",
          autorNome: currentUser?.name || "Painel Sênior NVU",
          publishedAt: serverTimestamp(),
          sortAt: serverTimestamp(),
          dataReferencia: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        toast.success("Comunicado publicado.");
      }

      resetForm();
      setHasLoadedCommunications(false);
      await loadCommunications(true);
      setActiveView("published");
    } catch (submissionError) {
      console.error("[NVU NEWS] Erro ao salvar comunicado:", submissionError);
      setError(editingCommunication
        ? "Não foi possível atualizar o comunicado. Verifique as regras do Firestore."
        : "Não foi possível publicar o comunicado. Verifique as regras do Firestore.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "nvu_comunicados", deleteTarget.id));
      setCommunications((current) => current.filter((communication) => communication.id !== deleteTarget.id));
      if (viewingCommunication?.id === deleteTarget.id) setViewingCommunication(null);
      if (editingCommunication?.id === deleteTarget.id) resetForm();
      setDeleteTarget(null);
      toast.success("Comunicado excluído da NVU News.");
    } catch (deletionError) {
      console.error("[NVU NEWS] Erro ao excluir comunicado:", deletionError);
      toast.error("Não foi possível excluir o comunicado.");
    } finally {
      setIsDeleting(false);
    }
  };

  const communicationSimulatorLabel = (communication: CommunicationRecord): string => {
    const key = simulatorKey(communication.simuladorKey || communication.simuladorId || communication.simulador);
    if (!key || key === "all") return "Todos os simuladores";
    return communication.simulador || simulatorOptions.find((option) => option.value === key)?.label || key.toUpperCase();
  };

  const isBusy = isSubmitting || isDeleting;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2.5 sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
        onClick={!isBusy ? resetAndClose : undefined}
      />

      <div className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#18181b]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5 sm:py-4 dark:border-slate-800/70">
          <div className="flex min-w-0 items-center gap-2.5 text-slate-900 dark:text-white">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <Megaphone size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">Comunicados da NVU</h2>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">Publicação e gerenciamento da NVU News</p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={isBusy}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 bg-slate-50/70 px-4 py-2 dark:border-slate-800/70 dark:bg-slate-900/20 sm:px-5">
          <button
            type="button"
            onClick={openCreateView}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-colors ${activeView === "create"
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}
          >
            <Plus size={14} />
            {editingCommunication ? "Editar" : "Novo comunicado"}
          </button>
          <button
            type="button"
            onClick={openPublishedView}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-colors ${activeView === "published"
              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}
          >
            <Megaphone size={14} />
            Publicados
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">
              {hasMoreCommunications ? `${communications.length}+` : communications.length}
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeView === "create" ? (
            <form id="communication-form" onSubmit={handleSubmit} className="space-y-4 p-4 sm:p-5">
              {editingCommunication && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300">
                  <div>
                    <p className="font-semibold">Editando comunicado publicado</p>
                    <p className="mt-0.5 opacity-80">A data original será preservada na NVU News.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="shrink-0 rounded-lg px-2 py-1 font-semibold hover:bg-blue-100 dark:hover:bg-blue-500/10"
                  >
                    Cancelar edição
                  </button>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  Título
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ex.: Atualização importante na plataforma"
                  maxLength={110}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-[#09090b] dark:text-white"
                />
                <p className="mt-1 text-right text-[10px] text-slate-400">{title.length}/110</p>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  Comunicado
                </label>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Escreva a informação de forma clara e objetiva."
                  rows={7}
                  maxLength={3000}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-[#09090b] dark:text-white"
                />
                <p className="mt-1 text-right text-[10px] text-slate-400">{message.length}/3000</p>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  Simulador
                </label>
                <select
                  value={selectedSimulator}
                  onChange={(event) => setSelectedSimulator(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-[#09090b] dark:text-white"
                >
                  <option value="all">Todos os simuladores</option>
                  {simulatorOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </form>
          ) : viewingCommunication ? (
            <div className="p-4 sm:p-5">
              <button
                type="button"
                onClick={() => setViewingCommunication(null)}
                className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <ChevronLeft size={15} />
                Voltar aos comunicados
              </button>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#101014] sm:p-5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300">
                      Comunicado oficial
                    </span>
                    <h3 className="mt-3 text-lg font-semibold leading-tight text-slate-950 dark:text-white">
                      {viewingCommunication.titulo}
                    </h3>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEditing(viewingCommunication)}>
                      <Pencil size={14} className="mr-1.5" /> Editar
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => setDeleteTarget(viewingCommunication)}>
                      <Trash2 size={14} className="mr-1.5" /> Excluir
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
                    <CalendarDays size={13} />
                    {formatPublicationDate(viewingCommunication.sortAt || viewingCommunication.createdAt || viewingCommunication.dataReferencia)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
                    <Gamepad2 size={13} />
                    {communicationSimulatorLabel(viewingCommunication)}
                  </span>
                </div>

                <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {viewingCommunication.mensagem}
                </p>
              </article>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_220px]">
                <label className="relative block">
                  <span className="sr-only">Buscar comunicado</span>
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar título ou conteúdo"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-[#09090b] dark:text-white"
                  />
                </label>
                <select
                  value={simulatorFilter}
                  onChange={(event) => setSimulatorFilter(event.target.value)}
                  aria-label="Filtrar por simulador"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-[#09090b] dark:text-white"
                >
                  <option value="all">Todos os simuladores</option>
                  {simulatorOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {communicationsError && (
                <div className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  {communicationsError}
                </div>
              )}

              {isLoadingCommunications ? (
                <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                  Carregando comunicados...
                </div>
              ) : filteredCommunications.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-12 text-center dark:border-slate-700">
                  <Megaphone size={24} className="mx-auto text-slate-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Nenhum comunicado encontrado</p>
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">Publique um novo comunicado ou ajuste os filtros.</p>
                  {hasMoreCommunications && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void loadCommunications(false)}
                      disabled={isLoadingMoreCommunications}
                      className="mt-4 min-w-[160px] border-slate-200 dark:border-slate-700"
                    >
                      {isLoadingMoreCommunications
                        ? <Loader2 size={16} className="animate-spin" />
                        : "Carregar mais"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {filteredCommunications.map((communication) => (
                    <article
                      key={communication.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-[#101014] sm:p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1"><Gamepad2 size={11} /> {communicationSimulatorLabel(communication)}</span>
                            <span aria-hidden="true">•</span>
                            <span>{formatPublicationDate(communication.sortAt || communication.createdAt || communication.dataReferencia)}</span>
                          </div>
                          <h3 className="mt-1.5 line-clamp-1 text-sm font-semibold text-slate-950 dark:text-white">
                            {communication.titulo}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {communication.mensagem}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingCommunication(communication)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Eye size={13} /> Visualizar
                          </button>
                          <button
                            type="button"
                            aria-label={`Editar ${communication.titulo}`}
                            title="Editar"
                            onClick={() => startEditing(communication)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Excluir ${communication.titulo}`}
                            title="Excluir"
                            onClick={() => setDeleteTarget(communication)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-500/25 dark:hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {hasMoreCommunications && (
                    <div className="flex justify-center pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadCommunications(false)}
                        disabled={isLoadingMoreCommunications}
                        className="min-w-[160px] border-slate-200 dark:border-slate-700"
                      >
                        {isLoadingMoreCommunications
                          ? <Loader2 size={16} className="animate-spin" />
                          : "Carregar mais"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-[72px] items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/70 dark:bg-slate-900/20 sm:p-5">
          {activeView === "create" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={editingCommunication ? openPublishedView : resetAndClose}
                disabled={isSubmitting}
                className="border-slate-200 dark:border-slate-700"
              >
                {editingCommunication ? "Voltar" : "Cancelar"}
              </Button>
              <Button
                type="submit"
                form="communication-form"
                disabled={isSubmitting}
                className="min-w-[130px] bg-blue-600 text-white hover:bg-blue-700"
              >
                {isSubmitting
                  ? <Loader2 size={16} className="animate-spin" />
                  : editingCommunication ? "Salvar alterações" : "Publicar"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={openCreateView} className="bg-blue-600 text-white hover:bg-blue-700">
              <Plus size={15} className="mr-1.5" /> Novo comunicado
            </Button>
          )}
        </div>
      </div>

      {deleteTarget && (
        <div className="absolute inset-0 z-[110] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancelar exclusão"
            className="absolute inset-0 bg-slate-950/65"
            onClick={!isDeleting ? () => setDeleteTarget(null) : undefined}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-[#18181b]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
              <AlertTriangle size={19} />
            </span>
            <h3 className="mt-4 text-base font-semibold text-slate-950 dark:text-white">Excluir comunicado?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              “{deleteTarget.titulo}” será removido permanentemente da página NVU News. Esta ação não pode ser desfeita.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting} className="min-w-[105px]">
                {isDeleting ? <Loader2 size={16} className="animate-spin" /> : "Excluir"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
