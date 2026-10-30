import React, { useMemo } from "react";
import { Building2, Truck } from "lucide-react";
import { StableImage } from "../common/StableImage";
import { HistoryMoneySummary } from "../common/HistoryMoneySummary";
import { getFilteredTrips } from "../../lib/metricsEngine";
import { summarizeTripMoney } from "../../lib/tripMoneySummary";
import type { NormalizedTrip } from "../../lib/tripNormalizer";
import type { RankingAggregatePeriodType } from "../../lib/rankingAggregates";
import type { CompanyProfile } from "../../context/AppContext";
import "./DriverProfileSummary.css";

export type DriverProfileView = "summary" | "statistics";

/** Presentation inputs from the existing operation, company and photo stores. */
export interface DriverProfilePresentation {
  kind?: "driver";
  view: DriverProfileView;
  periodType: RankingAggregatePeriodType;
  onPeriodChange: (period: RankingAggregatePeriodType) => void;
  onScopeChange: (scope: "internal" | "global") => void;
  viewerId: string;
  /** The profile belongs to someone else (a company manager is looking at a driver). */
  viewingOther?: boolean;
  /** Trips of the viewed driver; when present the summary ends with the collapsible "Resultados" card. */
  results?: { trips: NormalizedTrip[]; loading: boolean };
  company: { id: string; name: string; logo?: string | null } | null;
  companyLoading?: boolean;
  vehicle: {
    id: string;
    name: string;
    photo?: string | null;
    onPhotoLoad?: () => void;
    onPhotoError?: () => void;
  } | null;
}

export interface CompanyProfilePresentation extends Omit<DriverProfilePresentation, "kind" | "company" | "vehicle"> {
  kind: "company";
  company: CompanyProfile;
  canEdit: boolean;
}

export type ProfilePresentation = DriverProfilePresentation | CompanyProfilePresentation;

export function ProfileSummaryFigures({ trips, loading, start, end }: {
  trips: NormalizedTrip[]; loading: boolean; start: Date; end: Date;
}) {
  const periodTrips = useMemo(() => getFilteredTrips(trips, start, end), [trips, start, end]);
  const money = useMemo(() => summarizeTripMoney(periodTrips), [periodTrips]);
  const waiting = loading && periodTrips.length === 0;
  return <div className="nvu-profile-summary-figures">
    <div className="nvu-profile-summary-money"><span>Ganhos no período</span>
      {waiting ? <strong aria-label="Carregando ganhos">—</strong> : <HistoryMoneySummary groups={money} totalEligibleTrips={periodTrips.length}/>}
    </div>
    <div><span>Viagens</span><strong data-nvu-profile-summary-trips>{waiting ? "—" : periodTrips.length}</strong></div>
  </div>;
}

export function DriverProfileSummary({ presentation, periodControl, trips, loading, start, end }: {
  presentation: DriverProfilePresentation;
  periodControl: React.ReactNode;
  trips: NormalizedTrip[];
  loading: boolean;
  start: Date;
  end: Date;
}) {
  // Reuse the financial eligibility, date, currency and cent-precision policy
  // of the existing trip history. Comparative ranking availability must not
  // hide a driver's own cached trips while offline.
  const { vehicle, company, viewerId, companyLoading } = presentation;

  return <>
    <section className="nvu-profile-summary-card" aria-label="Resumo do período" data-nvu-profile-summary aria-busy={loading}>
      <header className="nvu-profile-performance-heading nvu-profile-summary-heading">
        <h3>Resumo do período</h3>
        {periodControl}
      </header>
      <StableImage src={vehicle?.photo} alt={vehicle ? `Foto de ${vehicle.name}` : ""}
        wrapperClassName="nvu-profile-summary-photo" className="object-cover"
        onLoad={vehicle?.onPhotoLoad} onError={vehicle?.onPhotoError}
        fallback={<span className="nvu-profile-summary-photo-empty"><Truck size={28} aria-hidden="true"/>
          <span>{vehicle ? "Foto do veículo não disponível" : "Nenhum veículo em operação"}</span></span>} />
      <div className="nvu-profile-summary-vehicle">
        <strong>{vehicle?.name || "Sem veículo em operação"}</strong>
        <span>{vehicle ? "Veículo atual" : "O veículo aparecerá ao receber uma operação."}</span>
      </div>
      <ProfileSummaryFigures trips={trips} loading={loading} start={start} end={end}/>
    </section>
    <section className="nvu-profile-company-card" aria-label="Empresa atual" data-nvu-profile-company>
      <StableImage src={company?.logo} alt={company ? `Logo de ${company.name}` : ""}
        persistentViewerId={viewerId} persistentAssetId={company ? `company-logo:${company.id}` : undefined}
        wrapperClassName="nvu-profile-company-logo" className="object-cover"
        fallback={<Building2 size={24} aria-hidden="true"/>}/>
      <div><span>Empresa atual</span><strong>{company?.name || (companyLoading ? "Carregando empresa…" : "Sem empresa vinculada")}</strong></div>
    </section>
  </>;
}
