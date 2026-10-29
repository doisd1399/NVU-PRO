import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { registerOptionModal } from "../../lib/optionModalStack";
import "./ModalPortal.css";

/** A page may create stacking/containing contexts. Dialogs belong to the
 * viewport, above the dock, and share the Android Back/scroll-lock stack. */
export function ModalPortal({ children, label, onClose, busy = false }: {
  children: React.ReactNode; label: string; onClose: () => void; busy?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef({ onClose, busy });
  state.current = { onClose, busy };
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = registerOptionModal(() => { if (!state.current.busy) state.current.onClose(); });
    const viewport = window.visualViewport;
    const resize = () => {
      root.current?.style.setProperty("--modal-height", `${viewport?.height ?? window.innerHeight}px`);
      root.current?.style.setProperty("--modal-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    const frame = requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
    const keydown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!state.current.busy) state.current.onClose();
      }
      if (event.key !== "Tab" || !root.current) return;
      const focusable = Array.from(root.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex="0"]',
      )).filter(node => node.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); root.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(frame); modal.dispose(); window.removeEventListener("keydown", keydown, true);
      viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="nvu-modal-portal" ref={root} role="dialog" aria-modal="true"
    aria-label={label} aria-busy={busy} tabIndex={-1}>{children}</div>, document.body);
}
