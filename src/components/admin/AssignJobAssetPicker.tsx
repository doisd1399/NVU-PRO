import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, CalendarDays, ChevronDown, ChevronUp, Folder, FolderOpen, KeyRound, Package, Search, Truck, Users, X } from "lucide-react";
import { useOptionalAutomaticOperations } from "../../contexts/AutomaticOperationsProvider";
import { orderOperationalContracts, orderOperationalFolders } from "../../lib/operationalQueueOrder";
import { registerOptionModal } from "../../lib/optionModalStack";
import "./AssignmentWorkspace.css";

type PickerKind = "contract" | "vehicle";

type PickerContract = {
  id: string;
  name: string;
  deadlineDays?: number;
  totalDeliveries?: number;
  mode?: string;
  trailerId?: string | null;
  sequenceId?: string | null;
  sequenceOrder?: number | null;
};

type PickerSequence = {
  id: string;
  name: string;
  scope?: "operations" | "vehicles" | "trailers";
};

type PickerVehicle = {
  id: string;
  name: string;
  paintCode?: string;
  sequenceId?: string | null;
  sequenceOrder?: number | null;
};

type PickerTrailer = {
  id: string;
  name: string;
};

type Props = {
  kind: PickerKind;
  open: boolean;
  selectedId: string;
  contracts?: PickerContract[];
  sequences?: PickerSequence[];
  vehicles?: PickerVehicle[];
  trailers?: PickerTrailer[];
  vehicleUsageById?: Map<string, number | null>;
  /** Vehicle already linked to the job being edited: it is marked and cannot be confirmed again. */
  currentId?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
};

const normalizeText = (value: unknown) =>
  String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function AssignJobAssetPicker({
  kind, open, selectedId, contracts = [], sequences = [], vehicles = [], trailers = [],
  vehicleUsageById, currentId, onClose, onSelect,
}: Props) {
  const automatic = useOptionalAutomaticOperations();
  const id = useId();
  const [search, setSearch] = useState("");
  const [draftId, setDraftId] = useState(selectedId);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [headerOffset, setHeaderOffset] = useState<number>();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const title = kind === "contract" ? "Escolher operação" : "Escolher veículo";
  const subtitle = kind === "contract"
    ? "Selecione a operação que será encaminhada."
    : currentId ? "Escolha o novo veículo deste trabalho." : "Escolha o veículo para este trabalho.";
  const draftItem = kind === "contract"
    ? contracts.find((contract) => contract.id === draftId)
    : vehicles.find((vehicle) => vehicle.id === draftId);

  useLayoutEffect(() => {
    if (!open) return;
    const header = document.querySelector<HTMLElement>(".nvu-admin-header");
    const measure = () => setHeaderOffset(header ? Math.max(0, header.getBoundingClientRect().bottom) : undefined);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (header) observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDraftId(selectedId);
    setSearch("");
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => closeRef.current());
    // Focus the dialog, never the search field: opening a list must not open the keyboard.
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (modal.isTop() && dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        dialogRef.current.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", keepFocus);
      modal.dispose();
      // Restoring an editable control would reopen the keyboard after closing the picker.
      if (previousFocus?.isConnected && !previousFocus.matches("input, textarea, [contenteditable]")) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, kind, selectedId]);

  const filteredContracts = useMemo(() => {
    const query = normalizeText(search);
    return orderOperationalContracts(contracts.filter((contract) => !query || normalizeText(contract.name).includes(query)),automatic?.settings);
  }, [contracts, search, automatic?.settings]);

  const contractGroups = useMemo(() => {
    if (kind !== "contract") return [];
    const operationSequences = orderOperationalFolders(sequences.filter((sequence) => (sequence.scope || "operations") === "operations"),automatic?.settings);
    const groups = operationSequences
      .map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        contracts: filteredContracts.filter((contract) => contract.sequenceId === sequence.id),
      }))
      .filter((group) => group.contracts.length > 0);
    const withoutFolder = filteredContracts.filter((contract) => !contract.sequenceId);
    if (withoutFolder.length > 0) {
      groups.push({ id: "none", name: "Sem pasta", contracts: withoutFolder });
    }
    return groups;
  }, [filteredContracts, kind, sequences, automatic?.settings]);

  const filteredVehicles = useMemo(() => {
    const query = normalizeText(search);
    return [...vehicles]
      .filter((vehicle) => !query || normalizeText(vehicle.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [vehicles, search]);

  const vehicleGroups = useMemo(() => {
    if (kind !== "vehicle") return [];
    const vehicleSequences = sequences.filter((sequence) => sequence.scope === "vehicles");
    const groups = vehicleSequences
      .map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        vehicles: filteredVehicles
          .filter((vehicle) => vehicle.sequenceId === sequence.id)
          .sort(
            (a, b) =>
              (Number(a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.sequenceOrder ?? Number.MAX_SAFE_INTEGER)) ||
              a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
          ),
      }))
      .filter((group) => group.vehicles.length > 0);
    const withoutFolder = filteredVehicles.filter((vehicle) => !vehicle.sequenceId);
    if (withoutFolder.length > 0) groups.push({ id: "none", name: "Sem pasta", vehicles: withoutFolder });
    return groups;
  }, [filteredVehicles, kind, sequences]);

  if (!open) return null;

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders((current) => ({ ...current, [folderId]: !current[folderId] }));
  };
  const confirmSelection = () => {
    if (!draftItem || draftItem.id === currentId) return;
    onSelect(draftItem.id);
    onClose();
  };
  const radio = <span className="nvu-assignment-radio" aria-hidden="true"><span /></span>;

  const renderContractCard = (contract: PickerContract) => {
    const trailer = trailers.find((item) => item.id === contract.trailerId);
    const selected = draftId === contract.id;
    return (
      <button type="button" role="radio" aria-checked={selected} aria-label={contract.name}
        key={contract.id} data-value={contract.id} onClick={() => setDraftId(contract.id)}
        className={"nvu-assignment-choice nvu-assignment-contract-choice" + (selected ? " is-selected" : "")}>
        <span className="nvu-assignment-choice-symbol"><ClipboardList size={23} strokeWidth={1.65} /></span>
        <span className="nvu-assignment-choice-copy">
          <strong>{contract.name}</strong>
          <span className="nvu-assignment-choice-description"><Truck size={14} strokeWidth={1.7} />{trailer?.name || "Qualquer reboque"}</span>
          <span className="nvu-assignment-choice-meta">
            <span><Package size={16} strokeWidth={1.7} />{contract.totalDeliveries ?? 0} entregas</span>
            <span><CalendarDays size={16} strokeWidth={1.7} />{contract.deadlineDays ?? 0} dias</span>
          </span>
        </span>
        {radio}
      </button>
    );
  };

  return createPortal(
    <div className="nvu-assignment-theme nvu-assign-picker-overlay"
      style={headerOffset == null ? undefined : { "--assignment-header-offset": headerOffset + "px" } as React.CSSProperties}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="nvu-assignment-panel nvu-assign-picker-dialog"
        role="dialog" aria-modal="true" aria-labelledby={id + "-title"} aria-describedby={id + "-description"} tabIndex={-1}>
        <header className="nvu-assignment-heading nvu-assign-picker-heading">
          <button type="button" onClick={onClose} className="nvu-assignment-close" aria-label="Fechar seleção"><X size={23} strokeWidth={1.7} /></button>
          <span className="nvu-assignment-hero" aria-hidden="true">
            {kind === "contract" ? <ClipboardList size={28} strokeWidth={1.65} /> : <KeyRound size={28} strokeWidth={1.65} />}
          </span>
          <h2 id={id + "-title"}>{title}</h2>
          <p id={id + "-description"} className="nvu-assignment-description-pill">{subtitle}</p>
        </header>

        <div className="nvu-assign-picker-search-area">
          <label className="nvu-assign-picker-search">
            <Search size={20} strokeWidth={1.7} aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder={kind === "contract" ? "Buscar operação..." : "Buscar veículo..."}
              aria-label={kind === "contract" ? "Buscar operação" : "Buscar veículo"}
              autoComplete="off" spellCheck={false} enterKeyHint="search"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  dialogRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
                }
              }} />
          </label>
          <p className="nvu-assign-picker-selection" role="status">
            {kind === "contract"
              ? (draftItem ? "1 operação selecionada" : "Nenhuma operação selecionada")
              : (draftItem ? "1 veículo selecionado" : "Nenhum veículo selecionado")}
          </p>
        </div>

        <div className="nvu-assign-picker-list" role="radiogroup" aria-label={title} onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target as HTMLElement).matches('[role="radio"]')) return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
          if (!items.length) return;
          event.preventDefault();
          const index = items.indexOf(event.target as HTMLButtonElement);
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          const next = items[nextIndex];
          setDraftId(next.dataset.value || "");
          next.focus();
        }}>
          {kind === "contract" ? contractGroups.map((group) => {
            const collapsed = Boolean(collapsedFolders[group.id]);
            return <section key={group.id} className="nvu-assignment-folder">
              <button type="button" onClick={() => toggleFolder(group.id)} className="nvu-assignment-folder-heading"
                aria-expanded={!collapsed} aria-controls={id + "-folder-" + group.id}>
                {collapsed ? <Folder size={23} strokeWidth={1.7} /> : <FolderOpen size={23} strokeWidth={1.7} />}
                <strong>{group.name}</strong><span className="nvu-assignment-folder-count">{group.contracts.length}</span>
                {collapsed ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
              </button>
              {!collapsed && <div id={id + "-folder-" + group.id} className="nvu-assignment-folder-cards">{group.contracts.map(renderContractCard)}</div>}
            </section>;
          }) : vehicleGroups.map((group) => {
            const collapsed = Boolean(collapsedFolders[group.id]);
            return <section key={group.id} className="nvu-assignment-folder">
              <button type="button" onClick={() => toggleFolder(group.id)} className="nvu-assignment-folder-heading"
                aria-expanded={!collapsed} aria-controls={id + "-folder-" + group.id}>
                {collapsed ? <Folder size={23} strokeWidth={1.7} /> : <FolderOpen size={23} strokeWidth={1.7} />}
                <strong>{group.name}</strong><span className="nvu-assignment-folder-count">{group.vehicles.length}</span>
                {collapsed ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
              </button>
              {!collapsed && <div id={id + "-folder-" + group.id} className="nvu-assignment-folder-cards">
                {group.vehicles.map((vehicle) => {
                  const selected = draftId === vehicle.id;
                  const usageCount = vehicleUsageById?.get(vehicle.id);
                  return <button type="button" key={vehicle.id} role="radio" aria-checked={selected} aria-label={vehicle.name}
                    data-value={vehicle.id} onClick={() => setDraftId(vehicle.id)}
                    className={"nvu-assignment-choice" + (selected ? " is-selected" : "")}>
                    <span className="nvu-assignment-choice-symbol"><KeyRound size={24} strokeWidth={1.65} /></span>
                    <span className="nvu-assignment-choice-copy">
                      <strong>{vehicle.name}</strong>
                      <span className="nvu-assignment-choice-description"><Users size={14} strokeWidth={1.7} />
                        {currentId === vehicle.id && "Veículo atual · "}{usageCount == null ? "Vínculos em consulta" : usageCount === 0 ? "Sem motoristas vinculados" : "Em uso por " + usageCount + " motorista" + (usageCount === 1 ? "" : "s")}
                      </span>
                    </span>
                    {radio}
                  </button>;
                })}
              </div>}
            </section>;
          })}
          {(kind === "contract" ? !contractGroups.length : !vehicleGroups.length) &&
            <p role="status" className="nvu-assignment-empty">{kind === "contract" ? "Nenhuma operação encontrada." : "Nenhum veículo encontrado."}</p>}
        </div>
        <footer className="nvu-assignment-picker-footer">
          <button type="button" className="nvu-assignment-button nvu-assignment-picker-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="nvu-assignment-button nvu-assignment-primary" disabled={!draftItem || draftItem.id === currentId} onClick={confirmSelection}>
            {kind === "contract" ? "Usar operação" : "Usar veículo"}
          </button>
        </footer>
      </section>
    </div>, document.body,
  );
}

export default AssignJobAssetPicker;
