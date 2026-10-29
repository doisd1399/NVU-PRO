import { CachedImage } from "./common/CachedImage";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { driverDisplayIdentity } from "../lib/driverDisplayIdentity";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, History, Loader2, WifiOff, X } from "lucide-react";
import { useProfileRanking, type ProfileRankingQuery } from "../hooks/useProfileRanking";
import { useVehiclePhoto } from "../hooks/useVehiclePhoto";
import { useRankingParticipantVehicle } from "../hooks/useRankingParticipantVehicle";
import { buildClassificationPeriods, type ClassificationPeriod } from "../lib/performancePeriods";
import { resolveVehiclePhotoOperationSimulatorId, vehiclePhotoKey } from "../lib/vehiclePhotoIdentity";
import { writeVehiclePhotoIdentitySnapshot } from "../services/vehiclePhotoIdentitySnapshot";
import { resolveDriverPhoto } from "../lib/resolveDriverPhoto";
import { rankingCompanyDisplayName, rankingDisplayName } from "../lib/rankingDisplayName";
import { selectCurrentOperationJob, operationAssignmentTimestamp } from "../lib/currentOperation";
import { StableImage } from "./common/StableImage";
import { invalidateRankingPremiumCache, makeRankingPremiumCacheKey, readRankingPremiumCache, writeRankingPremiumCache, type RankingPremiumCacheRecord } from "../services/rankingPremiumCache";

import { registerOptionModal } from "../lib/optionModalStack";
import { GamerCrown, GamerRouteIcon, rankingMetal } from "./RankingGamerDecor";
import "./RankingParticipantPremiumModal.css";

type RankingItem = {
  id: string; name: string; logo?: string; val?: number; trips?: number; currency?: string;
  currencyBreakdown?: { currency: string; value: number; tripCount?: number }[];
  companyId?: string; companyName?: string; companyLogo?: string;
};
type ModalProps = {
  item: RankingItem; rank: number; rankingScope: "global" | "internal" | "companies";
  simulatorId: string; periodType: "semana" | "mes"; periodLabel: string; start: Date; end: Date;
  companies: Record<string, unknown>[]; simulators: Record<string, unknown>[];
  users: Record<string, unknown>[]; companyMembers: Record<string, unknown>[];
  currentUserId?: string; jobs: Array<Record<string, any>>; vehicles: Array<Record<string, any>>;
  onClose: () => void;
};
const money = (item?: { val?: number; currency?: string; currencyBreakdown?: { currency: string; value: number }[] } | null) => {
  if (!item) return "—";
  const groups = item.currencyBreakdown || [];
  if (groups.length) return groups.map((group) => { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: group.currency }).format(Number(group.value || 0)); } catch { return `${group.currency} ${Number(group.value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; } }).join(" · ");
  if (!item.currency) return "—";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency }).format(Number(item.val || 0)); } catch { return `${item.currency} ${Number(item.val || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; }
};

/** Each currency remains intact on its own line; mixed currencies are never summed. */
function MoneyLines({ value }: { value: string }) {
  const parts = value.split(" · ");
  return <div className={`nvu-ranking-profile-earnings${parts.some(part => part.length > 18) ? " nvu-profile-earnings-long" : ""}`}>
    {parts.map((part, index) => <span key={index} className="nvu-profile-money-line">{part}</span>)}
  </div>;
}

type HistoryRowProps = { query: ProfileRankingQuery; period: ClassificationPeriod; viewerId?: string; participantId: string; scope: string; companyId: string; simulatorId: string };
function HistoryRow({ query, period, viewerId, participantId, scope, companyId, simulatorId }: HistoryRowProps) {
  const result = useProfileRanking({ ...query, start: period.start, end: period.end });
  const cacheKey = useMemo(() => makeRankingPremiumCacheKey({ viewerId, participantId, scope, companyId, simulatorId, periodType: query.periodType, periodStart: period.start, periodEnd: period.end }), [viewerId, participantId, scope, companyId, simulatorId, query.periodType, period.start, period.end]);
  const [cached, setCached] = useState<RankingPremiumCacheRecord | null>(() => readRankingPremiumCache(cacheKey));
  useEffect(() => setCached(readRankingPremiumCache(cacheKey)), [cacheKey]);
  useEffect(() => { if (result.status === "ready") { const record = { key: cacheKey, viewerId: viewerId || "anonymous", participantId, scope, companyId, simulatorId, periodType: query.periodType, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(), updatedAt: Date.now(), summary: result.summary as unknown as Record<string, unknown> }; writeRankingPremiumCache(record); setCached(record); } }, [cacheKey, companyId, participantId, period.end, period.start, query.periodType, result.status, result.summary, scope, simulatorId, viewerId]);
  const summary = result.status === "ready" ? result.summary : (cached?.key === cacheKey ? cached.summary : undefined) as typeof result.summary | undefined;
  const status = result.status !== "ready" && summary ? "Última atualização local"
    : result.status === "loading" ? "Confirmando…"
    : result.status === "missing" ? "Histórico não consolidado"
    : result.status === "unavailable" ? "Falha ao carregar"
    : summary?.current && summary.hasActivity ? `${summary.position}º de ${summary.total}`
    : summary?.current ? "Sem viagens no período" : "Sem classificação no período";
  return <div className="nvu-profile-history-row">
    <div><p className="nvu-profile-history-period">{period.label}</p><p className="nvu-profile-history-status">{status}</p></div>
    <div className="nvu-profile-history-result"><MoneyLines value={summary?.current ? money(summary.current) : "—"} />{summary?.current && <p className="nvu-profile-history-status">{summary.current.trips} viagens</p>}</div>
  </div>;
}
function RankingHistory({ query, periodType, referenceDate, viewerId, participantId, scope, companyId, simulatorId }: { query: ProfileRankingQuery; periodType: "semana" | "mes"; referenceDate: Date; viewerId?: string; participantId: string; scope: string; companyId: string; simulatorId: string }) {
  const [open, setOpen] = useState(false);
  const [historyType, setHistoryType] = useState<"semana" | "mes">(periodType);
  const [visibleCounts, setVisibleCounts] = useState<Record<"semana" | "mes", number>>({ semana: 5, mes: 5 });
  const visibleCount = visibleCounts[historyType];
  const periods = useMemo(() => buildClassificationPeriods(historyType === "mes" ? "Mensal" : "Semanal", referenceDate, visibleCount), [historyType, referenceDate, visibleCount]);
  const historyQuery = useMemo(() => ({ ...query, periodType: historyType }), [historyType, query]);
  const historyId = useId();
  return <section className="nvu-profile-history" data-testid="ranking-profile-history">
    <button type="button" className="nvu-profile-history-toggle" aria-expanded={open} aria-controls={historyId} onClick={() => setOpen((value) => !value)}>
      <span className="nvu-profile-history-icon" aria-hidden="true"><History size={20} strokeWidth={1.6} /></span>
      <span>Histórico de classificações</span>{open ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
    </button>
    {open && <div className="nvu-profile-history-body" id={historyId}>
      <div className="nvu-profile-history-types" role="group" aria-label="Periodicidade do histórico">
        <button type="button" aria-pressed={historyType === "semana"} onClick={() => setHistoryType("semana")}>Semanal ({visibleCounts.semana})</button>
        <button type="button" aria-pressed={historyType === "mes"} onClick={() => setHistoryType("mes")}>Mensal ({visibleCounts.mes})</button>
      </div>
      {periods.map((period) => <HistoryRow key={`${historyType}:${period.start.toISOString()}`} query={historyQuery} period={period} viewerId={viewerId} participantId={participantId} scope={scope} companyId={companyId} simulatorId={simulatorId} />)}
      {visibleCount < 20 && <button type="button" className="nvu-profile-history-more" onClick={() => setVisibleCounts((counts) => ({ ...counts, [historyType]: Math.min(20, counts[historyType] + 5) }))}>Ver mais 5 classificações</button>}
    </div>}
  </section>;
}

export default function RankingParticipantPremiumModal({ item, rank, rankingScope, simulatorId, periodType, periodLabel, start, end, companies, simulators, users, companyMembers, currentUserId, jobs, vehicles, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const isCompany = rankingScope === "companies"; const participantId = String(item.id); const companyId = String(item.companyId || (isCompany ? item.id : ""));
  const localCurrentJob = !isCompany ? selectCurrentOperationJob(jobs.filter((job) => job.operationProgressReconciled !== false), participantId, companyId || undefined) : undefined;
  const localVehicle = localCurrentJob ? vehicles.find((candidate) => String(candidate.id) === String(localCurrentJob.vehicleId)) : undefined;
  const participantVehicle = useRankingParticipantVehicle(isCompany ? "" : participantId, String(item.companyId || companyId), localCurrentJob, localVehicle, { viewerId: currentUserId, simulatorId, companies, simulators });
  const currentJob = participantVehicle.authoritative && participantVehicle.status === "unavailable" ? null : participantVehicle.operation || localCurrentJob;
  const vehicle = participantVehicle.vehicle || (currentJob ? vehicles.find((candidate) => String(candidate.id) === String(currentJob.vehicleId)) : undefined);
  const user = users.find((candidate) => String(candidate.id || "") === participantId);
  // Match the dashboard namespace: its photo identity resolves from the current company first.
  // Resolving only from a job without simulator metadata incorrectly yields an empty identity.
  const operationCompany = companies.find((candidate) => String(candidate.id || "") === String(currentJob?.companyId || companyId));
  // Never interpret the company NAME as the simulator. A mismatch between
  // operation/company/selected filter must not display an unrelated vehicle.
  const photoSimulatorId = resolveVehiclePhotoOperationSimulatorId(
    currentJob, operationCompany, simulatorId, simulators, companies, [vehicle],
  );
  const selectedVehicleId = String(currentJob?.vehicleId || currentJob?.veiculoId || vehicle?.id || "").trim();
  const photoIdentity = !isCompany && currentJob && photoSimulatorId && selectedVehicleId
    ? { userId: participantId, simulatorId: photoSimulatorId, vehicleId: selectedVehicleId, vehicleName: String(vehicle?.name || "Veículo atual") } : null;
  const vehiclePhoto = useVehiclePhoto(photoIdentity, String(currentJob?.companyId || companyId), false);
  const profilePhoto = isCompany ? String(item.logo || "") : resolveDriverPhoto(user || { ...item, profilePhotoURL: item.logo });
  const participantName = isCompany ? item.name : driverDisplayIdentity(user || { name: item.name }).name;
  const photoScope = photoIdentity ? vehiclePhotoKey(photoIdentity) : "";
  const imageMountKey = useMemo(() => crypto.randomUUID(), [photoScope, vehiclePhoto.src]);
  const [failedImage, setFailedImage] = useState<{ key: string; src: string | null } | null>(null);
  const vehicleImageFailed = failedImage?.key === photoScope && failedImage?.src === vehiclePhoto.src;
  useEffect(() => {
    if (!photoIdentity || !currentJob) return;
    writeVehiclePhotoIdentitySnapshot({ ...photoIdentity, companyId, operationCompanyId: String(currentJob.companyId || ""), companyName: String(operationCompany?.name || operationCompany?.companyName || currentJob.companyName || item.companyName || ""), companyLogo: String(operationCompany?.logoUrl || operationCompany?.logoURL || operationCompany?.companyLogoURL || currentJob.companyLogo || item.companyLogo || ""), vehicleName: String(vehicle?.name || currentJob.vehicleName || "Veículo atual"), operationId: String(currentJob.id || currentJob.operationId || ""), evidenceAt: operationAssignmentTimestamp(currentJob), source: "last-used" }, { viewerId: currentUserId, simulatorId });
  }, [photoScope, companyId, currentUserId, simulatorId, currentJob?.id, currentJob?.assignedAt, vehicle?.name]);
  const query: ProfileRankingQuery = { participantId, companyId: isCompany ? undefined : companyId || undefined, scope: isCompany ? "companies" : rankingScope, simulatorId, periodType, start, end, companies, simulators, users, companyMembers };
  const result = useProfileRanking(query); const cacheKey = useMemo(() => makeRankingPremiumCacheKey({ viewerId: currentUserId, participantId, scope: rankingScope, companyId, simulatorId, periodType, periodStart: start, periodEnd: end }), [companyId, currentUserId, end, participantId, periodType, rankingScope, simulatorId, start]);
  const [cached, setCached] = useState<RankingPremiumCacheRecord | null>(() => readRankingPremiumCache(cacheKey));
  useEffect(() => setCached(readRankingPremiumCache(cacheKey)), [cacheKey]);
  useEffect(() => { if (result.status === "ready") { const record = { key: cacheKey, viewerId: currentUserId || "anonymous", participantId, scope: rankingScope, companyId, simulatorId, periodType, periodStart: start.toISOString(), periodEnd: end.toISOString(), updatedAt: Date.now(), item: item as unknown as Record<string, unknown>, summary: result.summary as unknown as Record<string, unknown> }; writeRankingPremiumCache(record); setCached(record); } }, [cacheKey, companyId, currentUserId, end, item, participantId, periodType, rankingScope, result.status, result.summary, simulatorId, start]);
  useEffect(() => { const handler = (event: Event) => { const trip = (event as CustomEvent).detail || {}; if (!trip.companyId || String(trip.companyId) === companyId) { invalidateRankingPremiumCache(cacheKey); setCached(null); } }; window.addEventListener("nvu:canonical-trip-updated", handler); return () => window.removeEventListener("nvu:canonical-trip-updated", handler); }, [cacheKey, companyId]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    // The app's native backButton handler dismisses this shared stack first.
    const modal = registerOptionModal(() => closeRef.current());
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (modal.isTop() && dialogRef.current && !dialogRef.current.contains(event.target as Node)) dialogRef.current.focus();
    };
    const onPop = () => { if (modal.isTop()) closeRef.current(); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", keepFocus);
    window.addEventListener("popstate", onPop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", keepFocus);
      window.removeEventListener("popstate", onPop);
      modal.dispose();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const cachedSummary = cached?.summary as any; const liveCurrent = result.status === "ready" ? result.summary.current : null; const current = liveCurrent || cachedSummary?.current || cached?.item || item; const online = typeof navigator === "undefined" || navigator.onLine; const company = companies.find((candidate) => String(candidate.id || "") === companyId) || operationCompany;
  const companyLogo = String(company?.logoUrl || company?.logoURL || company?.companyLogoURL || item.companyLogo || currentJob?.companyLogo || (isCompany ? item.logo : "") || "").trim();
  const companyName = String(company?.name || company?.companyName || item.companyName || currentJob?.companyName || (isCompany ? item.name : "Vínculo não disponível"));
  const scopeLabel = rankingScope === "global" ? "Ranking global" : rankingScope === "internal" ? "Ranking interno" : "Ranking entre empresas";
  const vehiclePhotoMessage = vehiclePhoto.remoteErrorCode === "VEHICLE_PHOTO_OFFLINE_COPY_MISSING"
    ? "Fotografia ainda não salva neste aparelho. Conecte-se para baixá-la."
    : !online && !currentJob
      ? "Veículo ainda não disponível neste aparelho. Conecte-se para atualizar o perfil."
      : participantVehicle.status === "loading" && !currentJob
    ? "Localizando a operação atual…"
    : participantVehicle.status === "permission-denied"
    ? "Indisponível para este participante: a leitura autorizada da operação/foto foi recusada"
      : participantVehicle.status === "loading" && !vehiclePhoto.src
        ? "Consultando fotografia do veículo…"
        : currentJob && !photoIdentity
          ? "Não foi possível identificar o veículo ou simulador da operação"
          : vehiclePhoto.remoteStatus === "loading"
            ? "Consultando fotografia cadastrada…"
							: vehiclePhoto.remoteStatus === "error"
							  ? `Não foi possível consultar a fotografia (${vehiclePhoto.remoteErrorCode || "erro desconhecido"}). Verifique a sincronização e o acesso à imagem.`
							  : currentJob
							    ? "Foto não Adicionada"
							    : "Foto não Adicionada";
  const summaryPending = result.status === "loading" && !cachedSummary;
  const companyDisplayName = companyName === "Vínculo não disponível" ? companyName : rankingCompanyDisplayName(companyName);
  return createPortal(
    <div className="nvu-ranking-profile-overlay" role="presentation" onClick={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="nvu-ranking-profile-modal" data-testid="ranking-profile-sheet">
        <header className="nvu-profile-header">
          <span className="nvu-profile-handle" aria-hidden="true" />
          <h2 id={titleId}>{isCompany ? "Perfil da empresa" : "Perfil do motorista"}</h2>
          <button type="button" className="nvu-profile-close" onClick={onClose} aria-label="Fechar participante"><X size={17} strokeWidth={1.5} /></button>
        </header>
        <div className="nvu-profile-content">
          {!isCompany && <figure className="nvu-profile-cover">
            {vehiclePhoto.src && !vehicleImageFailed ? <CachedImage key={imageMountKey} src={vehiclePhoto.src} alt={String(vehicle?.name || "Veículo atual")}
              onLoad={() => { setFailedImage(null); vehiclePhoto.onImageLoad(); }}
              onError={() => { setFailedImage({ key: photoScope, src: vehiclePhoto.src }); vehiclePhoto.onImageError(); }} />
              : <div className="nvu-profile-cover-fallback" role="status">{vehiclePhoto.remoteErrorCode === "VEHICLE_PHOTO_OFFLINE_COPY_MISSING" ? vehiclePhotoMessage : vehicleImageFailed || vehiclePhoto.remoteErrorCode ? `Não foi possível carregar a fotografia (${vehiclePhoto.remoteErrorCode || "imagem inválida"}).` : vehiclePhotoMessage}</div>}
            <figcaption>{String(vehicle?.name || currentJob?.vehicleName || "Veículo atual")}</figcaption>
          </figure>}
          <div className={`nvu-ranking-profile-identity${isCompany ? " nvu-profile-company-identity" : ""}`}>
            <StableImage src={profilePhoto} persistentViewerId={currentUserId} persistentAssetId={`${isCompany ? "company" : "driver"}:${participantId}`} alt={participantName}
              wrapperClassName="nvu-profile-avatar" className="object-cover"
              fallback={<span className="nvu-profile-initials">{participantName.slice(0, 2).toUpperCase()}</span>} />
            <div className="nvu-profile-person">
              <h3 title={participantName}>{rankingDisplayName(participantName)}</h3>
              <div className="nvu-profile-ranking-line">
                <span className={`nvu-profile-position nvu-metal-${rankingMetal(rank)}`} aria-label={`${rank}º lugar`}>
                  {rank === 1 && <GamerCrown />}<span>{rank}º</span>
                </span>
                <span className="nvu-profile-scope">{scopeLabel}</span>
              </div>
            </div>
          </div>
          {!online && <p className="nvu-profile-notice" role="status"><WifiOff size={14} aria-hidden="true" />Última versão salva no aparelho</p>}
          {vehiclePhoto.src && !vehicleImageFailed && vehiclePhoto.cacheStatus === "error" && <p className="nvu-profile-photo-notice" role="status">{vehiclePhoto.src.startsWith("data:") ? "Última fotografia salva; atualização pendente." : "Fotografia disponível online; cópia offline pendente."}</p>}
          <section className="nvu-profile-summary" data-testid="ranking-profile-summary" aria-label="Resultados do período e empresa atual">
            <div className="nvu-profile-results" aria-busy={summaryPending}>
              <div className="nvu-profile-earnings-group">
                <p className="nvu-profile-label" data-testid="ranking-profile-period">{periodLabel}</p>
                {summaryPending && !current.currency && !current.currencyBreakdown?.length
                  ? <span className="nvu-profile-loading" role="status" aria-label="Atualizando resultados"><Loader2 size={18} className="animate-spin" /></span>
                  : <MoneyLines value={money(current)} />}
              </div>
              <div className="nvu-profile-trips-group">
                <p className="nvu-profile-label">Viagens</p>
                <div className="nvu-profile-trip-count"><GamerRouteIcon /><span>{summaryPending && current.trips == null ? "…" : `${current.trips || 0}`}</span></div>
              </div>
            </div>
            <div className="nvu-profile-company" data-testid="ranking-profile-company">
              <span className="nvu-profile-label">Empresa atual</span>
              <div className="nvu-profile-company-value">
                {companyLogo && <StableImage src={companyLogo} persistentViewerId={currentUserId}
                  persistentAssetId={`company:${String(company?.id || companyId || currentJob?.companyId || "")}`} alt={`Logo ${companyName}`}
                  wrapperClassName="nvu-profile-company-logo" className="object-cover" fallback={<span className="nvu-profile-initials">—</span>} />}
                <span className="nvu-profile-company-name" title={companyName}>{companyDisplayName}</span>
              </div>
            </div>
          </section>
          <RankingHistory query={query} periodType={periodType} referenceDate={end} viewerId={currentUserId} participantId={participantId} scope={rankingScope} companyId={companyId} simulatorId={simulatorId} />
        </div>
      </div>
    </div>, document.body,
  );
}
