import React, { createContext, useContext } from "react";
import { ArrowLeft } from "lucide-react";
import { StableImage } from "../common/StableImage";
import { initialsOf } from "../../lib/partnerships";
import "../admin/management/ManagementDashboard.css";
import "./Partnerships.css";

const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dayTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dayOnly = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const fmt = (formatter: Intl.DateTimeFormat, ms: number) => ms ? formatter.format(new Date(ms)).replace(".", "") : "—";
export const fmtDateTime = (ms: number) => fmt(dateTime, ms);
export const fmtDayTime = (ms: number) => fmt(dayTime, ms);
export const fmtDay = (ms: number) => fmt(dayOnly, ms);

/** Logos das empresas (catálogo público); sem logo, a sigla. */
export const LogoContext = createContext<{ logo: (companyId: string) => string; viewerId: string; driverPhoto: (driverId: string) => string }>({ logo: () => "", viewerId: "", driverPhoto: () => "" });

export function Avatar({ name, companyId, driverId, size = 38 }: { name: string; companyId?: string; driverId?: string; size?: number }) {
  const { logo, viewerId, driverPhoto } = useContext(LogoContext);
  const src = companyId ? logo(companyId) : driverId ? driverPhoto(driverId) : "";
  return <StableImage src={src} alt="" loading="lazy" decoding="async" wrapperClassName={"nvu-central-avatar" + (companyId ? " b2p-logo" : "")} className={companyId ? "object-contain" : "object-cover"} referrerPolicy="no-referrer"
    persistentViewerId={viewerId} persistentAssetId={companyId ? `company-logo:${companyId}` : driverId ? `partnership-driver:${driverId}` : undefined} fallback={<span style={{ display: "grid", placeItems: "center", width: "100%", fontWeight: 700 }}>{initialsOf(name)}</span>}
    {...({ style: { width: size, height: size } } as object)} />;
}

/** Cabeçalho igual ao da Central: título e descrição centralizados, empresa à esquerda e simulador à direita. */
export function PageHeader({ title, description, companyName, simulator }: { title: string; description: string; companyName: string; simulator: string }) {
  return <header className="nvu-central-intro nvu-workspace-page-heading">
    <div className="nvu-workspace-page-title"><h1>{title}</h1><p>{description}</p></div>
    <div className="nvu-central-company-row b2p-company-row">
      <div className="nvu-central-company-name"><h2 title={companyName}>{companyName}</h2></div>
      {simulator ? <span className="nvu-central-simulator"><span>{simulator}</span></span> : null}
    </div>
  </header>;
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="b2p-back" onClick={onClick}><ArrowLeft size={19} aria-hidden="true" />{label}</button>;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: { id: T; label: string; count?: number; warn?: boolean }[]; label: string }) {
  return <div className="b2p-tabs" role="tablist" aria-label={label}>
    {items.map(item => <button type="button" role="tab" key={item.id} aria-selected={value === item.id} data-on={value === item.id ? "1" : "0"} onClick={() => onChange(item.id)}>
      {item.label}{item.count ? <i data-warn={item.warn ? "1" : "0"}>{item.count}</i> : null}</button>)}
  </div>;
}

export const Section: React.FC<{ title: React.ReactNode; count?: number; action?: React.ReactNode; id?: string; children: React.ReactNode }> = ({ title, count, action, id, children }) =>
  <section className="nvu-central-section b2p-sec" id={id}>
    <div className="b2p-sec-head"><h2>{title}{count ? <small>{count}</small> : null}</h2>{action}</div>
    {children}
  </section>;
