import React, { useEffect, useRef, useState } from "react";
import { Eye, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { StableImage } from "../common/StableImage";
import { formatTripHistoryMoney } from "../../lib/tripMoneyPresentation";
import { driverDateLabel } from "../../lib/driverWorkspace";
import { getNomeContratoHistorico } from "../../lib/utils";
import { TripSendStatus } from "./TripSendStatus";

export function DriverActivityRow({ trip, company, number, simulatorLabel, onDetails, onEdit, onDelete }: {
  trip: any; company?: any; number?: number; simulatorLabel?: string; onDetails: () => void; onEdit?: () => void; onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = React.useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  const title = getNomeContratoHistorico(trip);
  const date = trip.metricDate;
  const logo = company?.logoUrl || company?.logo || company?.photoURL;
  const actions = [{ label: "Ver detalhes", icon: Eye, run: onDetails },
    ...(onEdit ? [{ label: "Editar viagem", icon: Pencil, run: onEdit }] : []),
    ...(onDelete ? [{ label: "Remover viagem", icon: Trash2, run: onDelete }] : [])];
  return <div className="nvu-driver-activity-row" ref={root}>
    <StableImage src={logo} alt="" loading="lazy" wrapperClassName="nvu-driver-company-mark"
      fallback={<span>{String(company?.companyName || "NVU").split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2)}</span>} />
    <button type="button" className="nvu-driver-activity-main" onClick={onDetails} aria-label={`Ver viagem ${title}`}>
      <strong>{title}</strong><span>{number ? `Viagem ${number} · ` : ""}{driverDateLabel(date, { hour: "2-digit", minute: "2-digit" })}</span>
    </button>
    <div className="nvu-driver-activity-value"><strong>{formatTripHistoryMoney(trip)}</strong><span>{simulatorLabel}</span><TripSendStatus trip={trip} showConfirmed /></div>
    <button ref={toggle} type="button" className="nvu-driver-more" aria-label={`Opções da viagem ${title}`}
      aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}><MoreVertical size={19} /></button>
    {open && <div id={menuId} className="nvu-driver-trip-actions" aria-label="Ações da viagem">
      {actions.map(({ label, icon: Icon, run }) => <button type="button" key={label} onClick={() => { setOpen(false); run(); }}><Icon size={15} />{label}</button>)}
    </div>}
  </div>;
}
