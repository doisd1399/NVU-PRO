import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Building2, Mail, Phone } from "lucide-react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { ProfileCoverHero } from "../../components/common/ProfileCoverHero";
import { HistoryReadCoverageNotice } from "../../components/common/HistoryReadCoverageNotice";
import { DriverProfileToolbar } from "../../components/driver/DriverProfileToolbar";
import type { DriverProfileView } from "../../components/driver/DriverProfileSummary";
import { DriverPerformanceCard } from "../../components/DriverPerformanceCard";
import { useTripHistory } from "../../hooks/useTripHistory";
import { useManagedDriverContacts } from "../../hooks/useManagedDriverContacts";
import { filterAndSortTripHistory } from "../../lib/tripHistoryEngine";
import { applySimulatorCurrencyContext } from "../../lib/metricsEngine";
import { normalizeTrip } from "../../lib/tripNormalizer";
import { getCanonicalTripDriverId } from "../../lib/tripIdentity";
import { useVehiclePhoto } from "../../hooks/useVehiclePhoto";
import { selectCurrentOperationJob } from "../../lib/currentOperation";
import { getDriverLevelData } from "../../lib/levelUtils";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import { resolveViewedDriverCompanyId } from "../../lib/companyScope";
import { resolveCompanySimulatorFilterValue, resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { resolveVehiclePhotoOperationSimulatorId } from "../../lib/vehiclePhotoIdentity";
import type { RankingAggregatePeriodType } from "../../lib/rankingAggregates";
import { formatDriverName } from "../../lib/utils";
import "./DriverProfileReference.css";

type ReturnState = { returnUrl?: string; returnState?: unknown; companyId?: string };

/**
 * Profile of another driver (opened from the management center) in the same interface as the driver's own profile:
 * cover, identity, "Resumo" and "Estatísticas". Everything is keyed by the driver in the URL, never by the signed-in
 * user, and the company/simulator come from the operation that opened the page.
 */
export default function DriverProfileReference() {
  const { id: driverId = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as ReturnState;
  const { currentUser } = useSessionStore();
  const { companies, allCompanies, activeCompanyId, allCompanyMembers } = useCompanyStore();
  const { users, jobs, contracts, vehicles, simulators } = useOperationalStore();
  const [view, setView] = useState<DriverProfileView>("summary");
  const [scope, setScope] = useState<"internal" | "global">("global");
  const [periodType, setPeriodType] = useState<RankingAggregatePeriodType>("mes");
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => { setView("summary"); setInfoOpen(false); }, [driverId]);

  const driver = users.find(user => user.id === driverId);
  const companyId = resolveViewedDriverCompanyId({
    routeCompanyId: state.companyId,
    activeJobCompanyId: jobs.find(job => job.driverId === driverId && job.companyId)?.companyId || null,
    latestTripCompanyId: null,
    activeMembershipCompanyId: allCompanyMembers?.find(member => member.userId === driverId && member.status === "active")?.companyId,
    userCompanyId: driver?.companyId,
    historicalMembershipCompanyId: allCompanyMembers?.find(member => member.userId === driverId)?.companyId,
    fallbackActiveCompanyId: activeCompanyId,
  });
  const company = (companyId && (allCompanies.find(item => item.id === companyId) || companies.find(item => item.id === companyId))) || null;
  const { historicoTrips = [], loading, coverage, error, readCoverage } = useTripHistory(companyId, { enabled: Boolean(companyId), userId: currentUser?.id });
  // Email and WhatsApp are private: a manager of the driver's company reads them through the authorized callable, never from the public profile.
  const contact = useManagedDriverContacts(currentUser?.id || "", companyId || "", driverId && companyId ? [driverId] : []).find(row => row.id === driverId);
  const level = useMemo(() => getDriverLevelData(driverId, jobs, contracts, historicoTrips), [driverId, jobs, contracts, historicoTrips]);
  const currentJob = useMemo(() => selectCurrentOperationJob(jobs, driverId, companyId), [jobs, driverId, companyId]);
  const vehicle = currentJob?.vehicleId ? vehicles.find(item => item.id === currentJob.vehicleId) : undefined;
  const photoSimulatorId = resolveVehiclePhotoOperationSimulatorId(currentJob as any, company as any, "", simulators as any[], allCompanies as any[], vehicle ? [vehicle] : []);
  const vehiclePhoto = useVehiclePhoto(currentJob?.vehicleId && photoSimulatorId ? { userId: driverId, simulatorId: photoSimulatorId, vehicleId: String(currentJob.vehicleId), vehicleName: vehicle?.name } : null, companyId || "");
  const simulatorLabel = company ? resolveSimulatorDisplayLabel(company as any, simulators as any[], allCompanies as any[]) || "Simulador" : "Simulador";
  // Same figures as the driver's own Resultados page, computed from this driver's trips only.
  const getResultTrips = useCallback(() => filterAndSortTripHistory(historicoTrips.filter(trip => getCanonicalTripDriverId(normalizeTrip(trip as any)) === driverId), { periodPreset: "todos" })
    .map(trip => applySimulatorCurrencyContext(trip, companies, simulators)), [historicoTrips, driverId, companies, simulators]);
  const goBack = () => { if (state.returnUrl) navigate(state.returnUrl, { state: state.returnState }); else navigate(-1); };

  if (!driver) {
    return <div className="nvu-driver-reference-empty" role="status"><p>{users.length ? "Motorista não encontrado." : "Carregando motorista…"}</p><button type="button" onClick={goBack}>Voltar</button></div>;
  }
  const name = formatDriverName(driver.name || "Motorista");
  return <div className="nvu-company-profile-page nvu-driver-workspace nvu-workspace-theme nvu-driver-reference" data-profile-page="profile" data-driver-id={driverId}>
    <div className="nvu-profile-stack nvu-profile-cover-stack">
      <div className="nvu-driver-reference-hero">
        <ProfileCoverHero key={driverId} scope="driver" profileId={driverId} profile={driver} name={name} description="Motorista Parceiro" avatar={resolveDriverPhoto(driver)}
          viewerId={currentUser?.id || ""} simulator={simulatorLabel} simulatorOpen={false} onSimulator={() => undefined} canEdit={false} readOnlySimulator />
      </div>
      <div className="nvu-driver-surface" data-page="profile">
        <DriverProfileToolbar view={view} onViewChange={setView} infoOpen={infoOpen} onInfo={() => setInfoOpen(value => !value)} onEdit={() => undefined} canEdit={false} />
        <HistoryReadCoverageNotice coverage={coverage} hasError={Boolean(error)} error={error} readCoverage={readCoverage} />
        {infoOpen && <div className="nvu-driver-reference-info">
          <div><Mail size={16} aria-hidden="true" /><span><small>Email</small>{contact?.email || driver.email || "Não informado"}</span></div>
          <div><Phone size={16} aria-hidden="true" /><span><small>WhatsApp</small>{contact?.whatsapp || (driver as any).whatsapp || "Não informado"}</span></div>
          {company && <div><Building2 size={16} aria-hidden="true" /><span><small>Empresa</small>{(company as any).companyName || "Empresa"}</span></div>}
        </div>}
        {companyId ? <DriverPerformanceCard
          rankingScope={scope} hideScopeSelector
          profilePresentation={{
            view, periodType, onPeriodChange: setPeriodType, onScopeChange: setScope, viewerId: currentUser?.id || "", viewingOther: true, results: { getTrips: getResultTrips, loading },
            company: company ? { id: String((company as any).id), name: (company as any).companyName || (company as any).name || "Empresa vinculada", logo: (company as any).logoUrl || (company as any).logoURL || (company as any).companyLogoURL } : null,
            companyLoading: false,
            vehicle: currentJob?.vehicleId ? { id: String(currentJob.vehicleId), name: vehicle?.name || "Veículo atual", photo: vehiclePhoto.src, onPhotoLoad: vehiclePhoto.onImageLoad, onPhotoError: vehiclePhoto.onImageError } : null,
          }}
          historicoTrips={historicoTrips} driverId={driverId} activeCompanyId={companyId} allCompanyMembers={allCompanyMembers} users={users} currentUser={driver}
          globalTripsLoading={historicoTrips.length === 0 && loading ? true : undefined} driverTripsLoading={loading}
          simulatorId={resolveCompanySimulatorFilterValue(company as any, simulators as Record<string, unknown>[], allCompanies as Record<string, unknown>[])}
          allCompanies={allCompanies} simulators={simulators as Record<string, unknown>[]}
          displayLevel={level.displayLevel} currentLevelXp={level.currentLevelXp} xpProgress={level.xpProgress} /> : <div className="min-h-[220px]" aria-hidden="true" />}
      </div>
    </div>
  </div>;
}
