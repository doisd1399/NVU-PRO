import React from "react";
import {
  AlertCircle,
  Award,
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Gamepad2,
  Loader2,
  Megaphone,
  Newspaper,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { StableImage } from "../components/common/StableImage";
import { cn } from "../lib/utils";
import { RANKING_TIME_ZONE } from "../lib/rankingPeriods";

type SimulatorOption = { value: string; label: string };

type FeedItem = any;
type Section = "noticias" | "comunicados";
type PeriodFilter = "all" | "semana" | "mes";

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const CURRENT_MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: RANKING_TIME_ZONE,
  month: "long",
  year: "numeric",
});
const UTC_MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const CURRENCY_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

type Props = {
  activeSection: Section;
  periodFilter: PeriodFilter;
  filteredPosts: FeedItem[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  searching: boolean;
  hasMore: boolean;
  historyPreparing: boolean;
  feedError: string | null;
  searchTerm: string;
  selectedSimulator: string;
  simulatorOptions: SimulatorOption[];
  activeSimulatorLabel: string;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  sectionUnreadCounts: Record<Section, number>;
  onRefresh: () => void;
  onSectionChange: (section: Section) => void;
  onPeriodFilterChange: (value: PeriodFilter) => void;
  onSearchChange: (value: string) => void;
  onSimulatorChange: (value: string) => void;
  onLoadMore: () => void;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown })?.toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof (value as { seconds?: unknown })?.seconds === "number") {
    const date = new Date(Number((value as { seconds: number }).seconds) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

type PublicationStamp = {
  value: unknown;
  label: "Publicado" | "Atualizado" | "Criado";
};

function publicationStamp(post: FeedItem): PublicationStamp | null {
  const publishedValue = post?.publishedAt ??
    post?.published_at ??
    post?.publicadoEm ??
    post?.dataPublicacao ??
    post?.approvedAt;
  if (publishedValue != null) return { value: publishedValue, label: "Publicado" };
  if (post?.updatedAt != null) return { value: post.updatedAt, label: "Atualizado" };
  if (post?.createdAt != null) return { value: post.createdAt, label: "Criado" };
  return null;
}

function publicationValue(post: FeedItem): unknown {
  return publicationStamp(post)?.value ?? null;
}

function publicationLabel(post: FeedItem): string {
  const stamp = publicationStamp(post);
  return stamp ? `${stamp.label} ${relativeTime(stamp.value)}` : "Publicação sem data";
}

function relativeTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return "há pouco";
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.abs(Math.round(diffMs / 60000));
  if (absMinutes < 60) return diffMs <= 0 ? `há ${Math.max(1, absMinutes)} min` : `em ${Math.max(1, absMinutes)} min`;
  if (absMinutes < 90) return diffMs <= 0 ? "há cerca de 1 hora" : "em cerca de 1 hora";
  const absHours = Math.abs(Math.round(diffMs / 3600000));
  if (absHours < 24) return diffMs <= 0 ? `há ${Math.max(1, absHours)} h` : `em ${Math.max(1, absHours)} h`;
  const absDays = Math.abs(Math.round(diffMs / 86400000));
  if (absDays < 7) return diffMs <= 0 ? `há ${Math.max(1, absDays)} dia${absDays > 1 ? "s" : ""}` : `em ${Math.max(1, absDays)} dia${absDays > 1 ? "s" : ""}`;
  return FULL_DATE_FORMATTER.format(date);
}

function compactPeriod(post: FeedItem): string {
  const startKey = String(post?.periodoInicioKey || "").trim();
  const endKey = String(post?.periodoFimKey || "").trim();
  if (!startKey || !endKey) return String(post?.periodo || "—");
  const startParts = startKey.split("-").map(Number);
  const endParts = endKey.split("-").map(Number);
  if (startParts.length !== 3 || endParts.length !== 3) return String(post?.periodo || "—");
  const [sy, sm, sd] = startParts;
  const [ey, em, ed] = endParts;
  if (![sy, sm, sd, ey, em, ed].every(Number.isFinite)) return String(post?.periodo || "—");
  const dd = (value: number) => String(value).padStart(2, "0");
  const mm = (value: number) => String(value).padStart(2, "0");
  const startYear = String(sy).slice(-2);
  const endYear = String(ey).slice(-2);
  if (sy === ey) return `${dd(sd)}/${mm(sm)}-${dd(ed)}/${mm(em)}/${endYear}`;
  return `${dd(sd)}/${mm(sm)}/${startYear}-${dd(ed)}/${mm(em)}/${endYear}`;
}


function SectionHeader({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <Newspaper size={14} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-black leading-tight text-slate-950 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-slate-200 bg-white px-1.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-[#101014] dark:text-slate-300">
        {count}
      </span>
    </div>
  );
}

function FeedNotice() {
  const raw = CURRENT_MONTH_FORMATTER.format(new Date());
  const monthLabel = raw.charAt(0).toLocaleUpperCase("pt-BR") + raw.slice(1);
  return `${monthLabel} está em andamento. As classificações mostram somente períodos encerrados. Novas empresas aprovadas também entram na linha do tempo na data da aprovação. A semana completa publica na segunda-feira e o mês encerrado no primeiro dia do mês seguinte.`;
}

function monthTitleLabel(post: FeedItem): string {
  if ((post?.periodoTipo || post?.periodicidade) !== "mes") return "";

  const key = String(post?.periodoInicioKey || post?.periodoFimKey || "").trim();
  const keyMatch = key.match(/^(\d{4})-(\d{1,2})-/);
  if (keyMatch) {
    const year = Number(keyMatch[1]);
    const month = Number(keyMatch[2]);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      const label = UTC_MONTH_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
      return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
    }
  }

  const period = String(post?.periodo || "").trim();
  const periodMatch = period.match(/\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/i);
  if (periodMatch) {
    const normalizedMonth = periodMatch[1].toLocaleLowerCase("pt-BR").replace("marco", "março");
    return `${normalizedMonth.charAt(0).toLocaleUpperCase("pt-BR") + normalizedMonth.slice(1)} de ${periodMatch[2]}`;
  }

  return "";
}

function postDisplayTitle(post: FeedItem): string {
  const title = String(post?.titulo || "").trim();
  const month = monthTitleLabel(post);
  if (!title || !month || !/^3\s+melhores\b/i.test(title) || !/\bdo mês\b/i.test(title)) return title;
  if (title.toLocaleLowerCase("pt-BR").includes(month.toLocaleLowerCase("pt-BR"))) return title;
  if (/\bdo mês\s+de\b/i.test(title)) return title;
  return title.replace(/\bdo mês\b/i, `do mês de ${month}`);
}
function formatMoney(value: unknown): string {
  const numeric = Number(value || 0);
  return CURRENCY_FORMATTER.format(Number.isFinite(numeric) ? numeric : 0);
}

function CompanyFooter({
  logo,
  name,
  priority,
  compact = false,
}: {
  logo: string | undefined | null;
  name: string;
  priority: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50/90 px-2 dark:border-slate-700 dark:bg-slate-900/70",
      compact ? "min-h-7 py-1" : "min-h-8 py-1.5",
    )}>
      <StableImage
        src={logo as string | undefined}
        alt={name}
        loading={priority ? "eager" : "lazy"}
        preload={priority}
        wrapperClassName={cn(
          "shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111318]",
          compact ? "h-5 w-5" : "h-6 w-6",
        )}
        className="object-cover"
        fallback={<span className="text-[7px] font-black text-slate-500">{name.slice(0, 2).toUpperCase()}</span>}
      />
      <span className={cn(
        "min-w-0 truncate text-center font-bold text-slate-500 dark:text-slate-400",
        compact ? "text-[9px]" : "text-[10px]",
      )}>
        {name}
      </span>
    </div>
  );
}

function RankingRow({
  entry,
  entity,
  priority,
}: {
  entry: FeedItem;
  entity: "empresa" | "motorista";
  priority: boolean;
}) {
  const name = String(entry?.nome || (entity === "empresa" ? "Empresa NVU" : "Motorista NVU"));
  const companyName = String(entry?.empresaNome || "Empresa NVU");
  const photo = entity === "empresa" ? entry?.logo : entry?.foto;
  const position = Number(entry?.posicao || 0);

  if (entity === "motorista") {
    return (
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-[#101014]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1 text-[10px] font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {position > 0 ? `${position}º` : "—"}
          </span>
          <StableImage
            src={photo}
            alt={name}
            loading={priority ? "eager" : "lazy"}
            preload={priority}
            wrapperClassName="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-[#111318]"
            className="object-cover"
            fallback={<span className="text-[10px] font-black text-slate-500">{name.slice(0, 2).toUpperCase()}</span>}
          />
          <div className="min-w-0 flex-1 self-stretch py-0.5">
            <p className="truncate text-[12px] font-black leading-tight text-slate-950 dark:text-white">{name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-black text-slate-600 dark:text-slate-300">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900">
                {entry?.viagens ?? 0} viagens
              </span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900">
                {formatMoney(entry?.ganhos)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 w-full">
          <CompanyFooter
            logo={entry?.empresaLogo}
            name={companyName}
            priority={priority}
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-[#101014]">
      <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1 text-[10px] font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        {position > 0 ? `${position}º` : "—"}
      </span>
      <StableImage
        src={photo}
        alt={name}
        loading={priority ? "eager" : "lazy"}
        preload={priority}
        wrapperClassName="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-[#111318]"
        className="object-cover"
        fallback={<span className="text-[10px] font-black text-slate-500">{name.slice(0, 2).toUpperCase()}</span>}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-black leading-tight text-slate-950 dark:text-white">{name}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-black text-slate-600 dark:text-slate-300">
          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900">
            {entry?.viagens ?? 0} viagens
          </span>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-900">
            {formatMoney(entry?.ganhos)}
          </span>
        </div>
      </div>
    </div>
  );
}

function classificationCategoryTitle(post: FeedItem, entity: "empresa" | "motorista"): string {
  const period = (post?.periodoTipo || post?.periodicidade) === "mes" ? "mensal" : "semanal";
  const subject = entity === "empresa" ? "empresas" : "motoristas";
  return `Classificação ${period} de ${subject}`;
}

function rankingEntries(post: FeedItem, entity: "empresa" | "motorista"): FeedItem[] {
  return entity === "empresa"
    ? (Array.isArray(post?.topEmpresas) ? post.topEmpresas : [])
    : (Array.isArray(post?.topMotoristas) ? post.topMotoristas : []);
}

function spotlightWinner(post: FeedItem, entity: "empresa" | "motorista"): FeedItem | null {
  const entries = rankingEntries(post, entity);
  if (entries.length === 0) return null;
  return entries.find((entry: FeedItem) => Number(entry?.posicao) === 1) || entries[0] || null;
}

function spotlightTitle(post: FeedItem, entity: "empresa" | "motorista"): string {
  const isMonthly = (post?.periodoTipo || post?.periodicidade) === "mes";
  if (rankingEntries(post, entity).length === 1) {
    if (!isMonthly) return "Fim da temporada semanal";
    const month = monthTitleLabel(post);
    return month ? `Fim da temporada mensal — ${month}` : "Fim da temporada mensal";
  }

  const subject = entity === "empresa" ? "Melhor empresa" : "Melhor motorista";
  if (!isMonthly) return `${subject} da semana`;
  const month = monthTitleLabel(post);
  return month ? `${subject} do mês de ${month}` : `${subject} do mês`;
}

function spotlightCaption(post: FeedItem, entity: "empresa" | "motorista", winner: FeedItem): string {
  const name = String(winner?.nome || (entity === "empresa" ? "Empresa NVU" : "Motorista NVU"));
  const simulator = String(post?.simulador || "simulador selecionado");
  const isMonthly = (post?.periodoTipo || post?.periodicidade) === "mes";
  const month = monthTitleLabel(post);
  const period = String(post?.periodo || compactPeriod(post) || "período encerrado");
  const periodPhrase = isMonthly
    ? (month ? `no mês de ${month}` : "no período mensal encerrado")
    : `na semana de ${period}`;
  const result = `${winner?.viagens ?? 0} viagens e ${formatMoney(winner?.ganhos)} em ganhos registrados`;

  if (rankingEntries(post, entity).length === 1) {
    const subject = entity === "empresa" ? "a empresa" : "o motorista";
    return `Sem concorrentes no período, ${subject} gerou ${formatMoney(winner?.ganhos)} em ganhos e realizou ${winner?.viagens ?? 0} viagens.`;
  }

  if (entity === "motorista") {
    const companyName = String(winner?.empresaNome || "sua empresa");
    return `A NVU reconhece ${name}, representando ${companyName}, como o motorista de maior destaque ${periodPhrase} no ${simulator}, com ${result}.`;
  }

  return `A NVU reconhece ${name} como a empresa de maior destaque ${periodPhrase} no ${simulator}, com ${result}.`;
}

function SpotlightCard({ post, priority }: { post: FeedItem; priority: boolean }) {
  const entity: "empresa" | "motorista" = post?.entidade === "motorista" || (
    !post?.entidade && Array.isArray(post?.topMotoristas) && post.topMotoristas.length > 0
  ) ? "motorista" : "empresa";
  const winner = spotlightWinner(post, entity);
  if (!winner) return null;

  const name = String(winner?.nome || (entity === "empresa" ? "Empresa NVU" : "Motorista NVU"));
  const companyName = String(winner?.empresaNome || "Empresa NVU");
  const photo = entity === "empresa" ? winner?.logo : winner?.foto;
  const publication = publicationLabel(post);
  const periodValue = compactPeriod(post);
  const isMonthly = (post?.periodoTipo || post?.periodicidade) === "mes";
  const caption = spotlightCaption(post, entity, winner);
  const isSolo = rankingEntries(post, entity).length === 1;

  return (
    <article className="nvu-content-auto overflow-hidden rounded-[20px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101014]">
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <Award size={12} /> {isSolo ? "Fim da temporada" : `Destaque ${isMonthly ? "mensal" : "semanal"}`}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{isSolo ? "Sem concorrentes" : "1º lugar"}</span>
        </div>

        <h3 className="mt-3 text-[18px] font-black leading-tight tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[21px]">
          {spotlightTitle(post, entity)}
        </h3>
        <p className="mt-2 max-w-[60ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 sm:text-[13px]">
          {caption}
        </p>

        {entity === "motorista" ? (
          <div className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-[#0d0f13] sm:p-4">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <StableImage
                src={photo}
                alt={name}
                loading={priority ? "eager" : "lazy"}
                preload={priority}
                wrapperClassName="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111318] sm:h-20 sm:w-20"
                className="object-cover"
                fallback={<span className="text-[17px] font-black text-slate-500">{name.slice(0, 2).toUpperCase()}</span>}
              />

              <div className="min-w-0 flex-1 self-stretch py-1">
                <p className="truncate text-[15px] font-black leading-tight text-slate-950 dark:text-white sm:text-[17px]">{name}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-black text-slate-700 dark:text-slate-200">
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-[#101014]">
                    {winner?.viagens ?? 0} viagens
                  </span>
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-[#101014]">
                    {formatMoney(winner?.ganhos)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 w-full">
              <CompanyFooter
                logo={winner?.empresaLogo}
                name={companyName}
                priority={priority}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-[#0d0f13] sm:gap-4 sm:p-4">
            <StableImage
              src={photo}
              alt={name}
              loading={priority ? "eager" : "lazy"}
              preload={priority}
              wrapperClassName="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111318] sm:h-20 sm:w-20"
              className="object-cover"
              fallback={<span className="text-[17px] font-black text-slate-500">{name.slice(0, 2).toUpperCase()}</span>}
            />

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Building2 size={14} className="shrink-0 text-slate-400" />
                <p className="truncate text-[15px] font-black leading-tight text-slate-950 dark:text-white sm:text-[17px]">{name}</p>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-black text-slate-700 dark:text-slate-200">
                <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-[#101014]">
                  {winner?.viagens ?? 0} viagens
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-[#101014]">
                  {formatMoney(winner?.ganhos)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
          <span className="inline-flex min-w-0 items-center gap-1"><CalendarDays size={11} className="shrink-0" /> <span className="truncate">{periodValue}</span></span>
          <span className="inline-flex min-w-0 items-center justify-end gap-1"><Gamepad2 size={11} className="shrink-0" /> <span className="truncate">{String(post?.simulador || "—")}</span></span>
        </div>

        <div className="mt-3 flex items-center border-t border-slate-200/80 pt-3 text-[10px] font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Clock3 size={12} /> {publication}</span>
        </div>
      </div>
    </article>
  );
}

function ClassificationCard({ post, priority }: { post: FeedItem; priority: boolean }) {
  const entity: "empresa" | "motorista" = post?.entidade === "motorista" || (
    !post?.entidade && Array.isArray(post?.topMotoristas) && post.topMotoristas.length > 0
  ) ? "motorista" : "empresa";
  const entries = (entity === "empresa"
    ? (Array.isArray(post?.topEmpresas) ? post.topEmpresas : [])
    : (Array.isArray(post?.topMotoristas) ? post.topMotoristas : [])
  ).slice(0, 3);
  const title = classificationCategoryTitle(post, entity);
  const subtitle = entity === "empresa"
    ? "Empresas em destaque no período encerrado."
    : "Motoristas em destaque no período encerrado.";
  const publication = publicationLabel(post);
  const periodValue = compactPeriod(post);
  const caption = String(post?.legenda || "").trim() || `Confira o destaque principal entre ${entity === "empresa" ? "empresas" : "motoristas"} no período selecionado.`;

  return (
    <div className="nvu-content-auto-lg space-y-2.5">
      <SectionHeader title={title} subtitle={subtitle} count={Math.max(entries.length, 1)} />
      <article className="overflow-hidden rounded-[18px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101014]">
        <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
          <h3 className="text-[18px] font-black leading-tight tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[20px]">
            {postDisplayTitle(post)}
          </h3>
          <p className="mt-2 max-w-[54ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 sm:text-[13px]">
            {caption}
          </p>

          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-[#0d0f13]">
            <div className="mb-2 grid grid-cols-2 gap-2 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
              <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {periodValue}</span>
              <span className="inline-flex items-center justify-end gap-1"><Gamepad2 size={11} /> {String(post?.simulador || "—")}</span>
            </div>
            <div className="space-y-2">
              {entries.length > 0
                ? entries.map((entry: FeedItem, index: number) => (
                  <RankingRow
                    key={`${entry?.id || index}-${entry?.posicao || index}`}
                    entry={entry}
                    entity={entity}
                    priority={priority}
                  />
                ))
                : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-[#101014] dark:text-slate-400">
                    Nenhum classificado elegível para este período.
                  </div>
                )}
            </div>
          </div>

          <div className="mt-3 flex items-center border-t border-slate-200/80 pt-3 text-[10px] font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Clock3 size={12} /> {publication}</span>
          </div>
        </div>
      </article>
    </div>
  );
}

function CommunicationCard({ post }: { post: FeedItem }) {
  return (
    <article className="nvu-content-auto overflow-hidden rounded-[18px] border border-sky-200 bg-white dark:border-sky-500/25 dark:bg-[#101014]">
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5 sm:py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
          <Megaphone size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-black leading-tight text-slate-950 dark:text-white">Central de comunicados</p>
              <p className="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">{publicationLabel(post)}</p>
            </div>
          </div>
          <span className="mt-2 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300">
            Comunicado oficial
          </span>
          <h3 className="mt-3 text-[17px] font-black leading-tight tracking-[-0.03em] text-slate-950 dark:text-white">
            {post?.titulo}
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
            {post?.mensagem}
          </p>
        </div>
      </div>
    </article>
  );
}

function CompanyApprovalCard({ post, priority }: { post: FeedItem; priority: boolean }) {
  const companyName = String(post?.empresaNome || post?.empresa?.nome || "Empresa NVU");
  const companyLogo = post?.empresaLogo || post?.empresa?.logo;
  const ownerName = String(post?.proprietarioNome || post?.proprietario?.nome || "Proprietário");
  const ownerPhoto = post?.proprietarioFoto || post?.proprietario?.foto;
  const publicationDate = toDate(publicationValue(post));
  const dateLabel = String(post?.dataAprovacaoLabel || (publicationDate ? FULL_DATE_FORMATTER.format(publicationDate) : "Data não informada"));
  const simulator = String(post?.simulador || "Simulador NVU");
  const caption = String(post?.legenda || "").trim() || `${companyName} agora faz parte do ecossistema NVU.`;

  return (
    <article className="nvu-content-auto overflow-hidden rounded-[20px] border border-emerald-200 bg-white dark:border-emerald-500/25 dark:bg-[#101014]">
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
            <BadgeCheck size={12} /> Nova empresa
          </span>
          <span className="text-[9px] font-bold text-slate-400">
            {publicationLabel(post)}
          </span>
        </div>

        <h3 className="mt-3 text-[18px] font-black leading-tight tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[21px]">
          {String(post?.titulo || "Nova empresa no ecossistema NVU")}
        </h3>
        <p className="mt-2 max-w-[62ch] text-[12px] leading-relaxed text-slate-600 dark:text-slate-300 sm:text-[13px]">
          {caption}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-[#0d0f13]">
            <StableImage
              src={companyLogo}
              alt={companyName}
              loading={priority ? "eager" : "lazy"}
              preload={priority}
              wrapperClassName="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111318]"
              className="object-cover"
              fallback={<Building2 size={20} className="text-slate-400" />}
            />
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Empresa</p>
              <p className="mt-1 truncate text-[14px] font-black leading-tight text-slate-950 dark:text-white">{companyName}</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-[#0d0f13]">
            <StableImage
              src={ownerPhoto}
              alt={ownerName}
              loading={priority ? "eager" : "lazy"}
              preload={priority}
              wrapperClassName="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111318]"
              className="object-cover"
              fallback={<UserRound size={20} className="text-slate-400" />}
            />
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Proprietário</p>
              <p className="mt-1 truncate text-[14px] font-black leading-tight text-slate-950 dark:text-white">{ownerName}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200/80 pt-3 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400 dark:border-slate-800">
          <span className="inline-flex min-w-0 items-center gap-1.5"><CalendarDays size={11} className="shrink-0" /><span className="truncate">{dateLabel}</span></span>
          <span className="inline-flex min-w-0 items-center justify-end gap-1.5"><Gamepad2 size={11} className="shrink-0" /><span className="truncate">{simulator}</span></span>
        </div>
      </div>
    </article>
  );
}

const MemoSpotlightCard = React.memo(SpotlightCard);
const MemoClassificationCard = React.memo(ClassificationCard);
const MemoCommunicationCard = React.memo(CommunicationCard);
const MemoCompanyApprovalCard = React.memo(CompanyApprovalCard);

function LoadingCardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-full bg-slate-200/70 dark:bg-slate-800/80" />
        <div className="h-24 rounded-[18px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#101014]" />
      </div>
      <div className="space-y-2">
        <div className="h-7 w-44 rounded-full bg-slate-200/70 dark:bg-slate-800/80" />
        <div className="h-24 rounded-[18px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#101014]" />
      </div>
    </div>
  );
}

export default function NewsFeedView({
  activeSection,
  periodFilter,
  filteredPosts,
  loading,
  loadingMore,
  refreshing,
  searching,
  hasMore,
  historyPreparing,
  feedError,
  searchTerm,
  selectedSimulator,
  simulatorOptions,
  activeSimulatorLabel,
  sentinelRef,
  sectionUnreadCounts,
  onRefresh,
  onSectionChange,
  onPeriodFilterChange,
  onSearchChange,
  onSimulatorChange,
  onLoadMore,
}: Props) {
  const feedNotice = activeSection === "noticias"
    ? FeedNotice()
    : "Comunicados oficiais publicados manualmente pelo Painel Sênior. Use a busca ou o filtro de simulador para localizar avisos específicos.";

  return (
    <div className="mx-auto w-full max-w-[820px] px-3 pb-10 pt-5 sm:px-4 sm:pt-6 md:px-6 md:pt-7">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <Newspaper size={20} className="mt-0.5 shrink-0 text-blue-600" />
            <div className="min-w-0">
              <h1 className="text-[22px] font-black leading-none tracking-[-0.04em] text-slate-950 dark:text-white sm:text-[24px]">
                NVU News
              </h1>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Fique por dentro das notícias, rankings e comunicados.
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Atualizar feed"
          onClick={onRefresh}
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-[#101014]">
        {([
          ["noticias", "Notícias", <Newspaper key="noticias-icon" size={14} />],
          ["comunicados", "Comunicados", <Megaphone key="comunicados-icon" size={14} />],
        ] as Array<[Section, string, React.ReactNode]>).map(([section, label, icon]) => (
          <button
            key={section}
            type="button"
            onClick={() => onSectionChange(section)}
            className={cn(
              "relative flex h-9 items-center justify-center gap-1.5 rounded-full text-[10px] font-black transition-colors sm:text-[11px]",
              activeSection === section
                ? "bg-white text-slate-950 dark:bg-slate-800 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
            )}
          >
            {icon}
            {label}
            {sectionUnreadCounts[section] > 0 && (
              <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-black leading-none text-white dark:bg-blue-500">
                {sectionUnreadCounts[section] > 99 ? "99+" : sectionUnreadCounts[section]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(126px,168px)] gap-2">
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={activeSection === "noticias" ? "Empresa, motorista ou período" : "Buscar comunicado"}
            className="h-10 w-full rounded-full border border-slate-200 bg-white pl-10 pr-10 text-[11px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-[#101014] dark:text-white"
          />
          {searching && <Loader2 size={14} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
        </label>

        <label className="relative block">
          <SlidersHorizontal size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={selectedSimulator}
            onChange={(event) => onSimulatorChange(event.target.value)}
            className="h-10 w-full appearance-none rounded-full border border-slate-200 bg-white pl-9 pr-8 text-[11px] font-bold text-slate-700 outline-none transition-colors focus:border-blue-500 dark:border-slate-700 dark:bg-[#101014] dark:text-slate-200"
          >
            <option value="all">Todos os simuladores</option>
            {simulatorOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
        </label>
      </div>

      {activeSection === "noticias" && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {([
            ["all", "Todas"],
            ["semana", "Semanais"],
            ["mes", "Mensais"],
          ] as Array<[PeriodFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onPeriodFilterChange(value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-black transition-colors",
                periodFilter === value
                  ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-[#101014] dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-[18px] border border-blue-100 bg-blue-50/80 px-4 py-3 text-[11px] leading-relaxed text-blue-950 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
        <div className="flex items-start gap-2">
          <Clock3 size={12} className="mt-0.5 shrink-0 text-blue-700 dark:text-blue-300" />
          <p>{feedNotice}</p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {feedError && filteredPosts.length > 0 && !loading && (
          <div className="flex items-start justify-between gap-3 rounded-[16px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            <div className="flex min-w-0 items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <p className="text-[11px] leading-relaxed">{feedError}</p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 text-[10px] font-black uppercase tracking-wide hover:underline"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {loading ? (
          <LoadingCardSkeleton />
        ) : filteredPosts.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-[#0f0f12]">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {feedError ? <AlertCircle size={20} /> : activeSection === "noticias" ? <Newspaper size={20} /> : <Megaphone size={20} />}
            </span>
            <h2 className="mt-3 text-[14px] font-black text-slate-900 dark:text-white">
              {feedError
                ? "Não foi possível carregar"
                : historyPreparing && activeSection === "noticias"
                  ? "Preparando o histórico"
                  : "Nenhuma publicação encontrada"}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {feedError
                ? feedError
                : historyPreparing && activeSection === "noticias"
                ? "As classificações anteriores estão sendo organizadas para este simulador."
                : `Não há publicações compatíveis com ${activeSimulatorLabel} e os filtros selecionados.`}
            </p>
            <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRefresh}>
              <RefreshCw size={14} /> Atualizar
            </Button>
          </div>
        ) : (
          <>
            {filteredPosts.map((post, index) => {
              if (activeSection !== "noticias") {
                return <MemoCommunicationCard key={post.id} post={post} />;
              }

              if (post?.tipo === "empresa_aprovada") {
                return (
                  <MemoCompanyApprovalCard
                    key={post.id}
                    post={post}
                    priority={index < 2}
                  />
                );
              }

              const entity: "empresa" | "motorista" = post?.entidade === "motorista" || (
                !post?.entidade && Array.isArray(post?.topMotoristas) && post.topMotoristas.length > 0
              ) ? "motorista" : "empresa";
              const hasCompetition = rankingEntries(post, entity).length > 1;

              return (
                <div key={post.id} className="space-y-4">
                  <MemoSpotlightCard post={post} priority={index < 2} />
                  {hasCompetition && <MemoClassificationCard post={post} priority={index < 2} />}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div ref={sentinelRef} className="flex min-h-14 items-center justify-center py-3">
        {loadingMore && <Loader2 size={19} className="animate-spin text-slate-400" />}
        {!loading && !loadingMore && hasMore && searchTerm.trim().length < 3 && (
          <Button variant="outline" size="sm" onClick={onLoadMore}>Carregar mais 10</Button>
        )}
        {!loading && !hasMore && filteredPosts.length > 0 && (
          <span className="text-[10px] font-semibold text-slate-400">Fim das publicações carregadas</span>
        )}
      </div>
    </div>
  );
}
