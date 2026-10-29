import React from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { tripSendStatus } from "../../lib/pendingHistoryTrips";
import "./TripSendStatus.css";

export function TripSendStatus({ trip, showConfirmed = false }: { trip: any; showConfirmed?: boolean }) {
  const status = tripSendStatus(trip);
  if (status === "confirmed" && !showConfirmed) return null;
  const label = { pending: "Aguardando envio", sending: "Enviando", failed: "Revisar envio", confirmed: "Enviada" }[status];
  const Icon = { pending: Clock3, sending: RefreshCw, failed: AlertCircle, confirmed: CheckCircle2 }[status];
  return <span role="status" aria-label={label} title={label} data-send-status={status}
    className="nvu-trip-send-status inline-flex items-center gap-1 text-[11px] font-medium">
    <Icon size={13} aria-hidden="true" className={status === "sending" ? "motion-safe:animate-spin" : ""} />{label}
  </span>;
}
