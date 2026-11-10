import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Folder, Plus, Search, X } from "lucide-react";
import { StableImage } from "../common/StableImage";
import { registerOptionModal } from "../../lib/optionModalStack";
import "./AssignmentWorkspace.css";
import "./AssignmentOptionPicker.css";

/**
 * Lista de opções com o mesmo desenho das listas da Central de gestão ("Escolher veículo" / "Escolher operação" do
 * Designar Trabalhos): tela cheia, busca, cartões com avatar, descrição e seleção por botão de rádio, rodapé
 * Cancelar / Usar. Serve a empresa parceira, o motorista e o reboque das Parcerias B2P.
 */
export type PickerOption = {
  id: string;
  title: string;
  /** Linha sob o título (ex.: simulador, status do motorista). */
  description?: string;
  /** Termos extras para a busca (não aparecem), ex.: nome completo da empresa. */
  keywords?: string;
  /** Detalhes pequenos, lado a lado (ex.: "3 viagens", "Reboque da frota"). */
  meta?: string[];
  avatar?: { src?: string | null; assetId?: string; initials?: string; icon?: React.ReactNode; round?: boolean };
  group?: string;
  tag?: { label: string; tone?: "good" | "warn" | "muted" };
  disabled?: boolean;
  /** Por que não pode ser escolhido (aparece no lugar da descrição). */
  disabledReason?: string;
};
export type PickerChoice = { id: string; title: string; custom?: boolean };

type Props = {
  open: boolean;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  searchPlaceholder: string;
  options: PickerOption[];
  selectedId: string;
  /** Textos do contador, já no gênero certo ("1 empresa selecionada" / "Nenhuma empresa selecionada"). */
  counter: { one: string; none: string };
  confirmLabel: string;
  emptyText: string;
  /** Opção "nenhuma" no topo (ex.: "Sem exigência de reboque"); escolhe o id "". */
  noneOption?: { title: string; description?: string };
  /** Permite usar o texto digitado quando não está na lista (ex.: nome de um reboque que a frota não tem). */
  custom?: { label: (text: string) => string; min?: number; max?: number };
  viewerId?: string;
  onClose: () => void;
  onSelect: (choice: PickerChoice) => void;
};

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
const CUSTOM_PREFIX = "\u0000custom:";

export function AssignmentOptionPicker({
  open, title, subtitle, icon, searchPlaceholder, options, selectedId, counter: counterText, confirmLabel, emptyText, noneOption, custom, viewerId, onClose, onSelect,
}: Props) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [draftId, setDraftId] = useState(selectedId);
  const [headerOffset, setHeaderOffset] = useState<number>();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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
    // Foco no diálogo, nunca na busca: abrir a lista não abre o teclado.
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (modal.isTop() && dialogRef.current && !dialogRef.current.contains(event.target as Node)) dialogRef.current.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", keepFocus);
      modal.dispose();
      if (previousFocus?.isConnected && !previousFocus.matches("input, textarea, [contenteditable]")) previousFocus.focus({ preventScroll: true });
    };
  }, [open, selectedId]);

  const query = fold(search.trim());
  const visible = useMemo(() => options.filter(option => !query || fold(option.title).includes(query) || fold(option.description).includes(query) || fold(option.keywords).includes(query)), [options, query]);
  const groups = useMemo(() => {
    const order: string[] = [], map = new Map<string, PickerOption[]>();
    visible.forEach(option => {
      const key = option.group || "";
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(option);
    });
    return order.map(key => ({ key, items: map.get(key)! }));
  }, [visible]);

  const typed = search.replace(/\s+/g, " ").trim();
  const canUseTyped = Boolean(custom && typed.length >= (custom.min ?? 2) && typed.length <= (custom.max ?? 80) && !options.some(option => fold(option.title) === fold(typed)));
  const customId = CUSTOM_PREFIX + typed;
  const draftIsCustom = draftId.startsWith(CUSTOM_PREFIX);
  const draftOption = draftIsCustom ? undefined : options.find(option => option.id === draftId);
  const draftReady = draftIsCustom || draftId === "" && Boolean(noneOption) || Boolean(draftOption && !draftOption.disabled);

  if (!open) return null;

  const confirm = () => {
    if (!draftReady) return;
    if (draftIsCustom) onSelect({ id: draftId.slice(CUSTOM_PREFIX.length), title: draftId.slice(CUSTOM_PREFIX.length), custom: true });
    else if (draftId === "") onSelect({ id: "", title: noneOption?.title || "" });
    else if (draftOption) onSelect({ id: draftOption.id, title: draftOption.title });
    onClose();
  };
  const radio = <span className="nvu-assignment-radio" aria-hidden="true"><span /></span>;
  const counter = draftIsCustom ? `${counterText.one}: “${draftId.slice(CUSTOM_PREFIX.length)}”` : draftOption ? counterText.one : draftId === "" && noneOption ? noneOption.title : counterText.none;

  const renderAvatar = (option: PickerOption) => {
    const avatar = option.avatar;
    if (!avatar) return <span className="nvu-assignment-choice-symbol">{icon}</span>;
    return <span className={"nvu-assignment-choice-symbol nvu-option-avatar" + (avatar.round ? " is-round" : "")}>
      {avatar.icon ? avatar.icon : <StableImage src={avatar.src} alt="" loading="lazy" decoding="async" wrapperClassName="nvu-option-avatar-frame" className="object-cover" referrerPolicy="no-referrer"
        persistentViewerId={viewerId} persistentAssetId={avatar.assetId} fallback={<span>{avatar.initials ?? ""}</span>} />}
    </span>;
  };
  const renderOption = (option: PickerOption) => {
    const selected = draftId === option.id;
    return <button type="button" role="radio" aria-checked={selected} aria-disabled={option.disabled || undefined} aria-label={option.title} key={option.id} data-value={option.id}
      data-disabled={option.disabled ? "true" : undefined} onClick={() => { if (!option.disabled) setDraftId(option.id); }}
      className={"nvu-assignment-choice nvu-option-choice" + (selected ? " is-selected" : "") + (option.disabled ? " is-disabled" : "")}>
      {renderAvatar(option)}
      <span className="nvu-assignment-choice-copy">
        <strong>{option.title}{option.tag ? <em className="nvu-option-tag" data-tone={option.tag.tone || "muted"}>{option.tag.label}</em> : null}</strong>
        {option.disabled && option.disabledReason ? <span className="nvu-assignment-choice-description nvu-option-reason">{option.disabledReason}</span>
          : option.description ? <span className="nvu-assignment-choice-description">{option.description}</span> : null}
        {option.meta?.length ? <span className="nvu-assignment-choice-meta">{option.meta.map(item => <span key={item}>{item}</span>)}</span> : null}
      </span>
      {option.disabled ? <span className="nvu-option-lock" aria-hidden="true" /> : radio}
    </button>;
  };

  return createPortal(
    <div className="nvu-assignment-theme nvu-assign-picker-overlay nvu-option-picker"
      style={headerOffset == null ? undefined : { "--assignment-header-offset": headerOffset + "px" } as React.CSSProperties}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="nvu-assignment-panel nvu-assign-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={id + "-title"} aria-describedby={id + "-description"} tabIndex={-1}>
        <header className="nvu-assignment-heading nvu-assign-picker-heading">
          <button type="button" onClick={onClose} className="nvu-assignment-close" aria-label="Fechar seleção"><X size={23} strokeWidth={1.7} /></button>
          <span className="nvu-assignment-hero" aria-hidden="true">{icon}</span>
          <h2 id={id + "-title"}>{title}</h2>
          <p id={id + "-description"} className="nvu-assignment-description-pill">{subtitle}</p>
        </header>
        <div className="nvu-assign-picker-search-area">
          <label className="nvu-assign-picker-search">
            <Search size={20} strokeWidth={1.7} aria-hidden="true" />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder.replace(/\.+$/, "")}
              autoComplete="off" spellCheck={false} enterKeyHint="search"
              onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); dialogRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus(); } }} />
          </label>
          <p className="nvu-assign-picker-selection" role="status">{counter}</p>
        </div>
        <div className="nvu-assign-picker-list" role="radiogroup" aria-label={title} onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target as HTMLElement).matches('[role="radio"]')) return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([data-disabled="true"])'));
          if (!items.length) return;
          event.preventDefault();
          const index = items.indexOf(event.target as HTMLButtonElement);
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          const next = items[nextIndex];
          setDraftId(next.dataset.value ?? "");
          next.focus();
        }}>
          {noneOption && !query ? <div className="nvu-assignment-folder-cards nvu-option-none">
            <button type="button" role="radio" aria-checked={draftId === ""} data-value="" aria-label={noneOption.title} onClick={() => setDraftId("")}
              className={"nvu-assignment-choice nvu-option-choice" + (draftId === "" ? " is-selected" : "")}>
              <span className="nvu-assignment-choice-symbol"><Check size={22} strokeWidth={1.7} /></span>
              <span className="nvu-assignment-choice-copy"><strong>{noneOption.title}</strong>{noneOption.description ? <span className="nvu-assignment-choice-description">{noneOption.description}</span> : null}</span>
              {radio}
            </button>
          </div> : null}
          {canUseTyped ? <div className="nvu-assignment-folder-cards nvu-option-none">
            <button type="button" role="radio" aria-checked={draftId === customId} data-value={customId} aria-label={custom!.label(typed)} onClick={() => setDraftId(customId)}
              className={"nvu-assignment-choice nvu-option-choice" + (draftId === customId ? " is-selected" : "")}>
              <span className="nvu-assignment-choice-symbol"><Plus size={22} strokeWidth={1.7} /></span>
              <span className="nvu-assignment-choice-copy"><strong>{custom!.label(typed)}</strong></span>
              {radio}
            </button>
          </div> : null}
          {groups.map(group => group.key ? <section key={group.key} className="nvu-assignment-folder">
            <div className="nvu-assignment-folder-heading nvu-option-group"><Folder size={20} strokeWidth={1.7} /><strong>{group.key}</strong><span className="nvu-assignment-folder-count">{group.items.length}</span></div>
            <div className="nvu-assignment-folder-cards">{group.items.map(renderOption)}</div>
          </section> : <div key="all" className="nvu-assignment-folder-cards">{group.items.map(renderOption)}</div>)}
          {!visible.length && !canUseTyped ? <p role="status" className="nvu-assignment-empty">{query ? "Nada encontrado para essa busca." : emptyText}</p> : null}
        </div>
        <footer className="nvu-assignment-picker-footer">
          <button type="button" className="nvu-assignment-button nvu-assignment-picker-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="nvu-assignment-button nvu-assignment-primary" disabled={!draftReady} onClick={confirm}>{confirmLabel}</button>
        </footer>
      </section>
    </div>, document.body,
  );
}

export default AssignmentOptionPicker;
