import { ModalSelect } from "./ui/ModalSelect";
import React, { useId, useMemo, useState } from "react";
import { DriverProfileSummary, type ProfilePresentation } from "./driver/DriverProfileSummary";
import { CompanyProfileSummary } from "./CompanyProfileSummary";
import { useLocation, useNavigate } from "react-router-dom";
import { useRankingFilterStore } from "../context/AppContext";
import {
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  History,
  Package,
  Star,
  Trophy,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  useProfileRanking,
  type ProfileRankingQuery,
} from "../hooks/useProfileRanking";
import { useLiveCalendarReference } from "../hooks/useLiveCalendarReference";
import { useTripsRealtime } from "../hooks/useTripsRealtime";
import {
  buildClassificationPeriods,
  resolvePerformanceInterval,
  type ClassificationPeriod,
} from "../lib/performancePeriods";
import {
  buildProfileActivityCalendar,
  type ProfileRankingScope,
} from "../lib/profileRanking";
import { RANKING_TIME_ZONE } from "../lib/rankingPeriods";
import { resolveSimulatorName } from "../lib/resolveSimulator";
import type { NormalizedTrip } from "../lib/tripNormalizer";
import type { RankingAggregatePeriodType } from "../lib/rankingAggregates";

const currency = (entry?: { val: number; currency?: string; currencyBreakdown?: { currency: string; value: number }[] } | null) => {
  const groups = entry?.currencyBreakdown || [];
  if (groups.length) return groups.map((group) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: group.currency }).format(group.value)).join(" · ");
  if (!entry?.currency) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: entry.currency }).format(entry.val);
};
const dateLabel = (value: Date) =>
  value.toLocaleDateString("pt-BR", {
    timeZone: RANKING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  });
const scopeLabels: Record<ProfileRankingScope, string> = {
  internal: "Ranking Interno",
  global: "Ranking Global",
  companies: "Entre empresas",
};
const cardClass =
  "rounded-[24px] border border-slate-200/80 dark:border-white/5 bg-white dark:bg-nvu-surface p-4 sm:p-5 shadow-sm";
export type ProfileRankingResult = ReturnType<typeof useProfileRanking>;

/** Presentation is independent of retrieval, including loading and empty states. */
export function ProfileRankingOverview({
  result,
  scope,
  onOpenRanking,
}: {
  result: ProfileRankingResult;
  scope: ProfileRankingScope;
  onOpenRanking: () => void;
}) {
  const { summary, status } = result;
  const ready = status === "ready";
  const participantLabel =
    scope === "companies"
      ? summary.total === 1
        ? "empresa"
        : "empresas"
      : summary.total === 1
        ? "motorista"
        : "motoristas";
  const title = !ready
    ? status === "unavailable"
      ? "Ranking indisponível"
      : status === "missing" ? "Histórico não consolidado" : "Confirmando classificação"
    : !summary.current
      ? "Sem classificação no período"
      : !summary.hasActivity
        ? "Sem viagens no período"
        : `${summary.position}º de ${summary.total} ${participantLabel}`;
  const description = !ready
    ? status === "unavailable"
      ? "Não foi possível carregar o ranking agora."
      : status === "missing" ? "Este período não possui consolidação disponível. Isso não significa ausência de viagens." : "A posição será exibida quando os dados do grupo estiverem disponíveis."
    : !summary.current
      ? "Este perfil não consta no ranking selecionado."
      : !summary.hasActivity
        ? "Ainda não há viagens registradas para este perfil neste período."
        : summary.total === 1
          ? "Há somente um participante neste ranking."
          : summary.activeParticipants === 1
            ? "Somente um participante registrou viagens neste período."
              : summary.isLeader && summary.comparableCurrency
                ? "Você lidera este ranking por ganhos."
                : summary.comparableCurrency
                  ? "Sua posição na classificação por ganhos."
                  : "Classificação pelo número de viagens.";

  return (
    <div
      className="space-y-4"
      aria-live="polite"
      aria-busy={status === "loading"}
    >
      {ready && result.stale && <p role="status" className="text-xs text-slate-500 dark:text-nvu-muted">Último resultado salvo · aguardando atualização</p>}
      <div className="rounded-[20px] border border-teal-500/15 bg-teal-50 dark:bg-nvu-accent-soft p-4 sm:p-5">
        <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400 mb-3">
          <Trophy size={19} aria-hidden="true" />
          <span className="text-xs font-semibold">{scopeLabels[scope]}</span>
        </div>
        <p
          data-nvu-ranking-position
          className={cn(
            "font-bold tracking-tight text-slate-900 dark:text-white",
            ready && summary.hasActivity ? "text-3xl sm:text-4xl" : "text-xl",
          )}
        >
          {title}
        </p>
        <p className="mt-2 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-nvu-text-soft">
          {description}
        </p>
        {status === "unavailable" && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"
          >
            Tentar novamente
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[16px] border border-slate-200 dark:border-white/10 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-slate-500 dark:text-nvu-muted text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
            <Package
              size={16}
              className="text-teal-600 dark:text-teal-400"
              aria-hidden="true"
            />{" "}
            Viagens
          </div>
          <p data-nvu-profile-stat className="mt-2 text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white break-words">
            {ready && summary.current ? summary.current.trips : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-nvu-muted">
            No período
          </p>
        </div>
        <div className="rounded-[16px] border border-slate-200 dark:border-white/10 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-slate-500 dark:text-nvu-muted text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
            <Banknote
              size={16}
              className="text-teal-600 dark:text-teal-400"
              aria-hidden="true"
            />{" "}
            Ganhos
          </div>
          <p data-nvu-profile-stat className="mt-2 text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white break-words">
            {ready && summary.current ? currency(summary.current) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-nvu-muted">
            {summary.current?.currencyBreakdown?.length && summary.current.currencyBreakdown.length > 1
              ? "Valores por moeda"
              : "No período"}
          </p>
        </div>
      </div>
      {ready && summary.hasActivity && summary.next && (
        <div className="rounded-[16px] border border-slate-200 dark:border-white/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nvu-muted">
            Logo acima de você
          </p>
          <div className="flex flex-wrap items-start justify-between gap-2 mt-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-slate-900 dark:text-white">
                {(summary.position || 1) - 1}º · {summary.next.name}
              </p>
              {scope === "global" && summary.next.companyName && (
                <p className="text-xs text-slate-500 dark:text-nvu-muted mt-1">
                  {summary.next.companyName}
                </p>
              )}
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {currency(summary.next)}
            </p>
          </div>
          {summary.comparableCurrency && <p className="text-xl font-bold text-teal-700 dark:text-teal-400 mt-3">
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: summary.current?.currency }).format(summary.gapToNext || 0)}
          </p>}
          {summary.comparableCurrency && summary.current && summary.next.val > 0 && (() => {
            const ratio = Math.min(100, Math.max(0, (summary.current.val / summary.next.val) * 100));
            return <>
              <div className="flex items-center justify-between gap-3 mt-3">
                <span className="text-[11px] text-slate-500 dark:text-nvu-muted">Seus ganhos em relação ao participante acima</span>
                <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">{ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-white/5 mt-2 overflow-hidden" role="progressbar" aria-label="Seus ganhos em relação ao participante imediatamente acima" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-teal-500" style={{ width: `${ratio}%` }} />
              </div>
            </>;
          })()}
          <p className="text-xs text-slate-500 dark:text-nvu-muted mt-2">
            {!summary.comparableCurrency
              ? "Moedas não comparáveis; classificação ordenada por viagens."
              : summary.gapToNext === 0
              ? "Empate em ganhos. A posição segue o desempate do ranking."
              : "Diferença de ganhos para igualar este participante."}
          </p>
        </div>
      )}
      {ready &&
        summary.hasActivity &&
        !summary.isLeader &&
        summary.leader &&
        summary.leaderRatio !== null && (
          <div className="rounded-[16px] border border-slate-200 dark:border-white/10 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-nvu-muted">
              Ganhos em relação ao líder
            </p>
            <div className="flex items-center justify-between gap-3 mt-2">
              <p className="text-sm text-slate-900 dark:text-white min-w-0">
                {summary.leader.name}
              </p>
              <p className="font-semibold text-sm text-teal-700 dark:text-teal-400">
                {summary.leaderRatio.toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                %
              </p>
            </div>
            <div
              className="h-2 rounded-full bg-slate-100 dark:bg-white/5 mt-3 overflow-hidden"
              role="progressbar"
              aria-label="Seus ganhos em relação aos ganhos do líder"
              aria-valuenow={summary.leaderRatio}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-teal-500"
                style={{ width: `${summary.leaderRatio}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-nvu-muted mt-2">
              Você: {currency(summary.current)} · Líder:{" "}
              {currency(summary.leader)}
            </p>
          </div>
        )}
      <button
        type="button"
        onClick={onOpenRanking}
        className="w-full flex items-center justify-between gap-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-sm font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20"
      >
        Ver ranking completo <ChevronRight size={17} aria-hidden="true" />
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">
        Ordenação por ganhos. Em empate, seguem os critérios de desempate do
        ranking.
      </p>
    </div>
  );
}

export function ProfileActivityCalendar({
  trips,
  start,
  end,
  referenceDate,
  loading,
}: {
  trips: NormalizedTrip[];
  start: Date;
  end: Date;
  referenceDate: Date;
  loading: boolean;
}) {
  const days = useMemo(
    () => buildProfileActivityCalendar(start, end, trips, referenceDate),
    [end, referenceDate, start, trips],
  );
  return (
    <section className={cardClass}>
      <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-nvu-text-soft">
        Atividade no período
      </h3>
      <p className="text-xs text-slate-500 dark:text-nvu-muted mt-2 mb-5">
        Dias com viagens nesta empresa {loading ? "· atualizando" : ""}
      </p>
      <div className="grid grid-cols-7 gap-y-2 gap-x-1 max-w-md mx-auto text-center">
        {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => (
          <span
            key={day}
            className="text-[9px] sm:text-[10px] font-bold text-slate-500 mb-1"
          >
            {day}
          </span>
        ))}
        {Array.from({ length: days[0]?.weekday || 0 }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {days.map((day) => (
          <span
            key={day.key}
            title={`${day.key}: ${day.trips} viagens`}
            aria-label={`${day.key}: ${day.future ? "dia futuro" : `${day.trips} viagens no histórico`}`}
            className={cn(
              "w-8 h-8 sm:w-10 sm:h-10 mx-auto rounded-full flex items-center justify-center text-xs",
              day.trips > 0
                ? "bg-teal-500 text-white shadow-sm"
                : "border border-slate-200 dark:border-nvu-line text-slate-500 dark:text-nvu-muted",
              day.future && day.trips === 0 && "opacity-40",
            )}
          >
            {day.day}
          </span>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500 dark:text-nvu-muted mt-5">
        {dateLabel(start)} a {dateLabel(end)} · Horário de Brasília
      </p>
    </section>
  );
}

function RankingHistoryRow({
  query,
  label,
}: {
  query: ProfileRankingQuery;
  label: string;
}) {
  const result = useProfileRanking(query);
  const ready = result.status === "ready";
  const summary = result.summary;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 py-3 border-t border-slate-200 dark:border-white/5">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-nvu-text">
          {label}
        </p>
        <p className="text-xs text-slate-500 dark:text-nvu-muted mt-1">
          {ready && summary.hasActivity
            ? `${summary.position}º de ${summary.total}`
            : ready
              ? summary.current ? "Sem viagens no período" : "Sem classificação no período"
              : result.status === "missing" ? "Histórico não consolidado"
              : result.status === "unavailable"
                ? "Falha ao carregar"
                : "Carregando classificação…"}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {ready && summary.current ? currency(summary.current) : "—"}
        </p>
        {ready && summary.current && (
          <p className="text-xs text-slate-500 dark:text-nvu-muted mt-1">
            {summary.current.trips} viagens
          </p>
        )}
      </div>
    </div>
  );
}

function RankingHistory({
  query,
  periods,
}: {
  query: ProfileRankingQuery;
  periods: ClassificationPeriod[];
}) {
  // All internal periods share one company listener rather than opening the
  // same authorized company queries once for each historical row.
  const historySource = useTripsRealtime({
    startDate: periods.at(-1)?.start,
    endDate: periods[0]?.end,
    companyIds: query.companyId ? [query.companyId] : [],
    enabled: query.scope === "internal" && Boolean(query.companyId),
    keepPreviousData: false,
  });
  return (
    <div className="mt-3">
      {periods.map((period) => (
        <RankingHistoryRow
          key={`${query.scope}:${query.simulatorId}:${query.periodType}:${period.start.toISOString()}`}
          label={period.label}
          query={{
            ...query,
            start: period.start,
            end: period.end,
            internalSource:
              query.scope === "internal" ? historySource : undefined,
          }}
        />
      ))}
    </div>
  );
}

export interface ProfileRankingPerformanceCardProps {
  participantId: string;
  companyId?: string | null;
  companyProfile?: boolean;
  simulatorId?: string;
  companies: Record<string, unknown>[];
  simulators: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  companyMembers?: Record<string, unknown>[];
  ownTrips: NormalizedTrip[];
  ownTripsLoading?: boolean;
  career: { level: number; xp: number; progress: number };
  rankingScope?: "internal" | "global";
  hideScopeSelector?: boolean;
  profilePresentation?: ProfilePresentation;
}

export const ProfileRankingPerformanceCard = React.memo(
  function ProfileRankingPerformanceCard(
    props: ProfileRankingPerformanceCardProps,
  ) {
    const navigate = useNavigate();
    const location = useLocation();
    const { setGlobalPeriodPreset } = useRankingFilterStore();
    const referenceDate = useLiveCalendarReference("utc");
    const [localScope, setScope] = useState<ProfileRankingScope>(
      props.companyProfile ? "companies" : "global",
    );
    const scope = props.companyProfile ? localScope : props.rankingScope ?? localScope;
    const [localPeriodType, setLocalPeriodType] =
      useState<RankingAggregatePeriodType>("mes");
    const presentation = props.profilePresentation;
    const periodType = presentation?.periodType ?? localPeriodType;
    const setPeriodType = presentation?.onPeriodChange ?? setLocalPeriodType;
    const summaryView = presentation?.view === "summary";
    const [historyOpen, setHistoryOpen] = useState(false);
    const historyId = useId();
    const range = useMemo(
      () =>
        resolvePerformanceInterval(
          periodType === "mes" ? "Mês atual" : "Semana atual",
          undefined,
          referenceDate,
        ),
      [periodType, referenceDate],
    );
    const query: ProfileRankingQuery = {
      participantId: props.participantId,
      companyId: props.companyId,
      scope,
      simulatorId: props.simulatorId,
      periodType,
      start: range.start,
      end: range.end,
      companies: props.companies,
      simulators: props.simulators,
      users: props.users,
      companyMembers: props.companyMembers,
      // The own-trip summary paints from its local repository. Comparative
      // reads belong to Statistics, or to history rows after explicit opening.
      enabled: !summaryView,
    };
    const result = useProfileRanking(query);
    const simulatorName =
      resolveSimulatorName(
        { simulatorId: result.simulatorId },
        props.simulators,
        props.companies,
      ) || "Simulador não definido";
    const history = useMemo(
      () =>
        buildClassificationPeriods(
          periodType === "mes" ? "Mensal" : "Semanal",
          referenceDate,
          5,
        ),
      [periodType, referenceDate],
    );
    const openRanking = () => {
      setGlobalPeriodPreset(periodType);
      navigate("/ranking", {
        state: {
          backgroundLocation: location,
          profileRanking: {
            type:
              scope === "companies"
                ? "entre"
                : scope === "internal"
                  ? "interno"
                  : "global",
            simulatorId: result.simulatorId,
            companyId: props.companyId || "",
            periodType,
          },
        },
      });
    };
    const progress = Math.min(100, Math.max(0, props.career.progress || 0));
    const periodControl = (
      <label className={presentation ? "nvu-profile-period" : "inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-slate-700 dark:text-nvu-text-soft"}>
        <CalendarDays size={14} aria-hidden="true" />
        <span className="sr-only">Período do ranking</span>
        <ModalSelect title="Período do ranking" aria-label="Período do ranking" value={periodType}
          onChange={(event) => setPeriodType(event.target.value as RankingAggregatePeriodType)}
          className="w-auto border-0 bg-transparent p-0 text-xs dark:bg-transparent max-w-full outline-none">
          <option value="mes" className="dark:bg-nvu-surface">Mês atual</option>
          <option value="semana" className="dark:bg-nvu-surface">Semana atual</option>
        </ModalSelect>
      </label>
    );
    const historyCard = (
      <section className={presentation ? "nvu-profile-history" : cardClass} data-nvu-profile-history>
        <button type="button" aria-expanded={historyOpen} aria-controls={historyId}
          onClick={() => setHistoryOpen((open) => !open)}
          className={presentation ? "nvu-profile-history-toggle" : "w-full flex items-center justify-between gap-3 text-left"}>
          {presentation && <History size={19} aria-hidden="true"/>}
          <h3 className={presentation ? undefined : "text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-nvu-text-soft"}>Histórico de classificação</h3>
          {presentation ? <ChevronDown size={17} aria-hidden="true"/> : <ChevronRight size={18}
            className={cn("text-slate-500 transition-transform", historyOpen && "rotate-90")} aria-hidden="true"/>}
        </button>
        {(!presentation || historyOpen) && <div id={historyId} className={presentation ? "nvu-profile-history-content" : undefined}>
          <p className="text-xs text-slate-500 dark:text-nvu-muted mt-2">
            Últimos cinco {periodType === "mes" ? "meses" : "períodos semanais"} · {scopeLabels[scope]}
          </p>
          {historyOpen && <RankingHistory query={{ ...query, enabled: true }} periods={history} />}
        </div>}
      </section>
    );

    return (
      <div className={cn(presentation ? "space-y-3 sm:space-y-4 w-full" : "space-y-4 sm:space-y-5 w-full", (presentation || props.hideScopeSelector) && "nvu-profile-ranking-layout")} data-nvu-profile-view={presentation?.view}>
        {summaryView && presentation ? <>
          {presentation.kind === "company"
            ? <CompanyProfileSummary presentation={presentation} periodControl={periodControl} trips={props.ownTrips} loading={Boolean(props.ownTripsLoading)} start={range.start} end={range.end}/>
            : <DriverProfileSummary presentation={presentation} periodControl={periodControl} trips={props.ownTrips} loading={Boolean(props.ownTripsLoading)} start={range.start} end={range.end}/>}
          {historyCard}
        </> : <>
        {!props.companyProfile && !props.hideScopeSelector && !presentation && (
          <div
            className="inline-flex rounded-xl bg-slate-100 dark:bg-nvu-surface p-1 gap-1"
            aria-label="Grupo de comparação"
          >
            {(["internal", "global"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-bold",
                  scope === value
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 dark:text-nvu-text-soft",
                )}
              >
                {scopeLabels[value]}
              </button>
            ))}
          </div>
        )}
        <section className={cardClass}>
          <div className="nvu-profile-performance-heading flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-nvu-text-soft">
              Desempenho no ranking
            </h3>
            {periodControl}
          </div>
          {presentation && !props.companyProfile && <div className="nvu-profile-scope-control" role="group" aria-label="Grupo de comparação">
            {(["internal", "global"] as const).map((value) => <button type="button" key={value}
              aria-pressed={scope === value} onClick={() => presentation.onScopeChange(value)}>{scopeLabels[value]}</button>)}
          </div>}
          {presentation && props.companyProfile && <div className="nvu-profile-company-ranking-label">Entre empresas</div>}
          {!presentation && <p className="text-xs text-slate-500 dark:text-nvu-muted mb-4">
            {dateLabel(range.start)} a {dateLabel(range.end)} · {simulatorName}
          </p>}
          <ProfileRankingOverview
            result={result}
            scope={scope}
            onOpenRanking={openRanking}
          />
        </section>
        <section className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-nvu-text-soft">
              Carreira
            </h3>
            <span className="flex items-center gap-2 text-teal-700 dark:text-teal-400 text-sm font-bold">
              <Star size={16} aria-hidden="true" /> Nível {props.career.level}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-nvu-muted mt-4 mb-2">
            <span>{Math.floor(props.career.xp || 0) % 1000} / 1.000 XP</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="h-2 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden"
            role="progressbar"
            aria-label="Progresso de carreira"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>
        <ProfileActivityCalendar
          trips={props.ownTrips}
          start={range.start}
          end={range.end}
          referenceDate={referenceDate}
          loading={Boolean(props.ownTripsLoading)}
        />
        {!presentation && historyCard}
        </>}
      </div>
    );
  },
);
