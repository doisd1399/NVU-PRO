import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { registerOptionModal } from "../../../lib/optionModalStack";

/** Shares Android Back, scroll lock and focus ownership with the app's pickers. */
export function ManagementDialog({ title, onClose, children, variant = "dialog", busy = false }: {
  title: string; onClose: () => void; children: React.ReactNode;
  /** "sheet" anchors the panel to the bottom of the screen; "dialog" keeps it centered. */
  variant?: "dialog" | "sheet";
  /** While a write is running the overlay and Escape/Back keep the panel open. */
  busy?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = busy ? () => undefined : onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => close.current());
    const frame = requestAnimationFrame(() => ref.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); close.current();
      }
      if (event.key !== "Tab") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]',
      ) || [])].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); ref.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
        event.preventDefault(); first.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (modal.isTop() && ref.current && !ref.current.contains(event.target as Node)) ref.current.focus();
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focus);
      modal.dispose();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className={`nvu-central-palette nvu-central-overlay${variant === "sheet" ? " nvu-central-overlay-sheet" : ""}`} onClick={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={ref} className={`nvu-central-dialog${variant === "sheet" ? " nvu-central-sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header><h2 id={id}>{title}</h2><button type="button" aria-label={`Fechar ${title.toLowerCase()}`} disabled={busy} onClick={onClose}><X size={20} /></button></header>
        {children}
      </section>
    </div>, document.body,
  );
}
