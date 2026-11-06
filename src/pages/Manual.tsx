import React from "react";
import {
  BookOpen,
  Building2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileText,
  Gauge,
  History,
  Loader2,
  Route,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useSessionStore } from "../context/AppContext";
import { cn } from "../lib/utils";
import { APP_GUIDES, formatGuideSize, resolveAppGuide, type AppGuideId, type ResolvedAppGuide } from "../lib/appGuides";
import { downloadAppGuide } from "../lib/appGuidesDownload";
import { watchAppGuides, type AppGuideRecords } from "../services/appGuidesService";

type ManualItem = {
  title: string;
  description: string;
  icon: React.ElementType;
  content: React.ReactNode;
};

type ManualGroupProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ElementType;
  accent: "teal" | "blue";
  items: ManualItem[];
  defaultOpenFirst?: boolean;
};

const accentStyles = {
  teal: {
    icon: "bg-[#0cb49f]/10 text-[#0a8d7e] dark:text-[#39c8b5]",
    marker: "bg-[#0cb49f]",
  },
  blue: {
    icon: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
    marker: "bg-blue-500",
  },
};

const StepList = ({ children }: { children: React.ReactNode }) => (
  <div className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-nvu-muted">
    {children}
  </div>
);

const Step = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-2.5">
    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
    <p>{children}</p>
  </div>
);

const ManualAccordionItem = ({
  item,
  markerClassName,
  initiallyOpen,
}: {
  item: ManualItem;
  markerClassName: string;
  initiallyOpen: boolean;
}) => {
  const [isOpen, setIsOpen] = React.useState(initiallyOpen);
  const ItemIcon = item.icon;

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-nvu-line dark:bg-nvu-page"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-nvu-strip dark:text-nvu-muted">
          <ItemIcon size={16} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
            {item.title}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-nvu-muted">
            {item.description}
          </span>
        </span>
        <ChevronDown
          size={17}
          className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="relative border-t border-slate-100 px-4 py-4 dark:border-nvu-line">
        <span
          className={cn(
            "absolute left-0 top-4 h-8 w-0.5 rounded-r-full",
            markerClassName,
          )}
        />
        {item.content}
      </div>
    </details>
  );
};

const ManualGroup = ({
  id,
  eyebrow,
  title,
  description,
  icon: GroupIcon,
  accent,
  items,
  defaultOpenFirst = false,
}: ManualGroupProps) => {
  const styles = accentStyles[accent];

  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            styles.icon,
          )}
        >
          <GroupIcon size={20} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-nvu-muted">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-nvu-muted">
            {description}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => (
          <ManualAccordionItem
            key={item.title}
            item={item}
            markerClassName={styles.marker}
            initiallyOpen={defaultOpenFirst && index === 0}
          />
        ))}
      </div>
    </section>
  );
};

const TripReceiptRules = () => (
  <div className="space-y-3">
    <div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">
        Padrão do comprovante
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-nvu-muted">
        Registre a viagem somente com um print que cumpra as regras abaixo.
      </p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-500/15 dark:bg-emerald-500/5">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Deve aparecer
        </p>
        <div className="space-y-1.5 text-sm text-slate-700 dark:text-nvu-text-soft">
          <p>✅ Print mostrando o valor.</p>
          <p>✅ Câmera próxima ao veículo.</p>
          <p>✅ Utilização das pinturas da empresa.</p>
          <p>✅ Registro feito à luz do dia.</p>
          <p>✅ Print sem bônus de vídeo.</p>
        </div>
      </div>

      <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 dark:border-red-500/15 dark:bg-red-500/5">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
          Não é permitido
        </p>
        <div className="space-y-1.5 text-sm text-slate-700 dark:text-nvu-text-soft">
          <p>❌ Print dentro da cabine.</p>
          <p>❌ Veículo sem a pintura da empresa.</p>
          <p>❌ Print escuro ou realizado durante a noite.</p>
          <p>❌ Print com bônus de vídeo.</p>
        </div>
      </div>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
      <strong>⚠️ Atenção:</strong> viagens fora do padrão podem gerar ocorrência
      e suspensão da empresa ou do motorista.
    </div>
  </div>
);

const PlatformRules = () => (
  <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-4 dark:border-amber-500/20 dark:bg-amber-500/10">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <ShieldCheck size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
          Regras da plataforma
        </p>
        <div className="mt-2 space-y-1.5 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
          <p>• Não trabalhe em duas empresas do mesmo simulador.</p>
          <p>• Registre todas as viagens dentro dos padrões exigidos.</p>
          <p>• Revise suas viagens regularmente para evitar ocorrências e suspensões.</p>
          <p>• Fraudes, quebra de regras ou má conduta podem resultar em suspensão ou banimento.</p>
        </div>
        <p className="mt-2 text-xs font-medium text-amber-800/80 dark:text-amber-200/70">
          A plataforma é monitorada regularmente para proteger usuários e empresas.
        </p>
      </div>
    </div>
  </section>
);


type GuidePoint = { title: string; text: string };
type GuideStage = { title: string; description: string; icon: React.ElementType; points: GuidePoint[]; note?: { title: string; text: string } };
type GuideSummary = { id: AppGuideId; eyebrow: string; title: string; description: string; icon: React.ElementType; accent: "teal" | "blue"; stages: GuideStage[]; howTo: string[] };

// Resumo dos guias oficiais (PDF). O texto abaixo acompanha o app; o PDF pode ser trocado pelo Painel Sênior sem nova versão do APK.
const GUIDE_SUMMARIES: Record<AppGuideId, GuideSummary> = {
  driver: {
    id: "driver", eyebrow: "Para motoristas", title: "Guia do Motorista", icon: Truck, accent: "teal",
    description: "Da missão ao encerramento: a NVU organiza seu trabalho para você se concentrar na viagem.",
    stages: [
      { title: "Etapa 1 · Antes de começar", description: "Receba a missão da empresa e confira como os trabalhos estão organizados.", icon: ClipboardCheck, points: [
        { title: "Entre na empresa certa", text: "Inscreva-se em uma empresa virtual. Após a aprovação, selecione a empresa e o simulador da operação." },
        { title: "Identifique o tipo de trabalho", text: "Em Trabalhos designados, a empresa envia cada operação manualmente. Na Fila automática, várias operações chegam juntas, na ordem planejada." },
        { title: "Entenda a missão", text: "Cada operação reúne viagens, especificações de transporte e prazo. Confira a meta, o veículo e o reboque, quando necessário." },
      ], note: { title: "Não encontrou a operação?", text: "Confira a empresa e o simulador selecionados. Se necessário, confirme a designação do trabalho com o gestor." } },
      { title: "Etapa 2 · Viaje com o Modo Pro", description: "Registre viagens sem sair do simulador, com o trabalho organizado pela NVU.", icon: Route, points: [
        { title: "Siga sua missão", text: "Mantenha a execução alinhada às especificações do trabalho recebido e respeite a meta e o prazo definidos pela empresa." },
        { title: "Registre cada viagem", text: "Use o Modo Pro durante a operação para registrar suas viagens e dar continuidade ao trabalho." },
        { title: "Mantenha o foco no que importa", text: "A NVU organiza seu trabalho para apoiar a eficiência e a produtividade. Concentre-se na execução das viagens." },
      ], note: { title: "Modo Pro compatível com", text: "ATS, ETS 2, GTO, TOE 3, WBDS e WTDS." } },
      { title: "Etapa 3 · Conclua no prazo", description: "Conclua a missão no prazo e mantenha a sequência dos trabalhos em andamento.", icon: Gauge, points: [
        { title: "Confira o que falta", text: "Compare as viagens registradas com a meta da operação e acompanhe o tempo restante." },
        { title: "Finalize pelo painel", text: "Quando cumprir a meta de viagens, finalize o trabalho no painel. Respeite o prazo definido pela empresa." },
        { title: "Continue a fila automática", text: "Se estiver na fila automática, siga os trabalhos na ordem definida. As operações já foram encaminhadas pela empresa." },
      ], note: { title: "Histórico de viagens", text: "Use os filtros de simulador, empresa e período para localizar e conferir seus registros concluídos." } },
    ],
    howTo: ["Toque em Baixar guia para salvar o PDF completo do Guia do Motorista.", "Abra o PDF no aparelho para consultar quando quiser, mesmo sem internet.", "Dúvida sobre uma operação? Confirme a designação com o gestor da empresa."],
  },
  company: {
    id: "company", eyebrow: "Para empresários", title: "Guia do Empresário", icon: Building2, accent: "blue",
    description: "Frota, equipe e operações organizadas para a sua empresa de transporte virtual.",
    stages: [
      { title: "Etapa 1 · Prepare sua empresa", description: "Organize a estrutura antes de colocar a equipe em operação.", icon: Building2, points: [
        { title: "Escolha empresa e simulador", text: "Confira a empresa virtual e o simulador no painel de gestão antes de cadastrar a frota e organizar os trabalhos." },
        { title: "Registre os veículos", text: "Cadastre os veículos da frota da empresa. Confira os dados para organizar os recursos usados nas operações." },
        { title: "Recrute sua equipe", text: "Receba inscrições, avalie os candidatos e aprove os usuários que vão fazer parte da empresa." },
      ], note: { title: "Base organizada", text: "Frota e equipe cadastradas ajudam a preparar a distribuição dos trabalhos. Mantenha essas informações atualizadas." } },
      { title: "Etapa 2 · Organize os trabalhos", description: "Cada operação é uma missão com viagens, especificações de transporte e prazo.", icon: Users, points: [
        { title: "Crie a operação", text: "Defina a meta de viagens, o veículo, o reboque quando necessário e o prazo para o motorista cumprir a missão." },
        { title: "Trabalhos designados", text: "Encaminhe a operação manualmente ao motorista. Esse fluxo dá à empresa o controle de cada envio." },
        { title: "Fila automática", text: "Envie várias operações de uma vez, na ordem desejada. O motorista executa a sequência sem esperar um novo envio a cada trabalho." },
      ], note: { title: "Mais foco com o Modo Pro", text: "O motorista registra viagens sem sair do simulador. A NVU organiza o trabalho para favorecer eficiência e produtividade." } },
      { title: "Etapa 3 · Acompanhe e decida", description: "Use o andamento e os registros para orientar o futuro da empresa.", icon: Gauge, points: [
        { title: "Veja o andamento", text: "Confira prazos, viagens registradas e o que falta para cumprir cada operação." },
        { title: "Consulte as viagens", text: "Abra uma viagem para conferir origem, destino, valor e comprovante." },
        { title: "Analise os períodos", text: "Compare semanas ou meses nos relatórios. Filtre por empresa, motorista e período." },
        { title: "Planeje os próximos passos", text: "Use os resultados para ajustar o planejamento, a frota e a distribuição dos trabalhos." },
      ], note: { title: "Simuladores do Modo Pro", text: "ATS, ETS 2, GTO, TOE 3, WBDS e WTDS." } },
    ],
    howTo: ["Toque em Baixar guia para salvar o PDF completo do Guia do Empresário.", "Compartilhe o PDF com os gestores e recrutadores da sua equipe.", "Siga as etapas na ordem: empresa e frota, depois trabalhos, depois acompanhamento."],
  },
};

const stageItems = (summary: GuideSummary): ManualItem[] => summary.stages.map(stage => ({
  title: stage.title,
  description: stage.description,
  icon: stage.icon,
  content: (
    <div className="space-y-3">
      <ol className="space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-nvu-muted">
        {stage.points.map((point, index) => (
          <li key={point.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 dark:bg-nvu-strip dark:text-nvu-text-soft">{String(index + 1).padStart(2, "0")}</span>
            <p><strong className="text-slate-900 dark:text-white">{point.title}.</strong> {point.text}</p>
          </li>
        ))}
      </ol>
      {stage.note && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-relaxed text-slate-600 dark:border-nvu-line dark:bg-nvu-strip dark:text-nvu-text-soft">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-nvu-muted">{stage.note.title}</p>
          <p className="mt-1">{stage.note.text}</p>
        </div>
      )}
    </div>
  ),
}));

const GuideDownloadCard = ({ guide, accent }: { guide: ResolvedAppGuide; accent: "teal" | "blue" }) => {
  const [busy, setBusy] = React.useState(false);
  const styles = accentStyles[accent];
  const updated = guide.updatedAtMs ? new Date(guide.updatedAtMs).toLocaleDateString("pt-BR") : "";
  const size = formatGuideSize(guide.size);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try { await downloadAppGuide(guide); }
    catch { toast.error("Não foi possível baixar o guia agora. Tente novamente."); }
    finally { setBusy(false); }
  };
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-nvu-line dark:bg-nvu-page" data-guide-card={guide.definition.id} data-guide-source={guide.source}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", styles.icon)}><FileText size={20} /></span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{guide.definition.title} (PDF)</p>
        <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-nvu-muted">
          {guide.source === "uploaded" ? ["Atualizado pela NVU", updated, size].filter(Boolean).join(" · ") : "Guia que acompanha o aplicativo"}
        </p>
      </div>
      <button type="button" onClick={() => void download()} disabled={busy} aria-label={`Baixar ${guide.definition.title}`}
        className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-semibold sm:w-auto text-white transition-colors hover:bg-slate-700 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Baixar guia
      </button>
    </div>
  );
};

export default function Manual() {
  const { activeRole } = useSessionStore();
  const [records, setRecords] = React.useState<AppGuideRecords>({});
  // Sem rede ou sem permissão de leitura da ficha: continua valendo o guia que acompanha o app.
  React.useEffect(() => {
    try { return watchAppGuides(setRecords, () => undefined); } catch { return undefined; }
  }, []);

  const order: AppGuideId[] = activeRole === "driver" ? ["driver", "company"] : activeRole === "admin" ? ["company", "driver"] : ["driver", "company"];
  const guides = order.map(id => ({ summary: GUIDE_SUMMARIES[id], resolved: resolveAppGuide(APP_GUIDES.find(guide => guide.id === id)!, records[id]) }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <header className="mb-6 rounded-3xl border border-slate-200 bg-white px-5 py-5 dark:border-nvu-line dark:bg-nvu-page sm:px-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <BookOpen size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-nvu-muted">Central de orientação</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Manual da Plataforma</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-nvu-muted">
              Guias oficiais da NVU para motoristas e empresários: resumo das etapas e PDF para baixar.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:w-fit">
          {guides.map(({ summary }) => (
            <a key={summary.id} href={`#manual-${summary.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-nvu-line dark:text-nvu-text-soft dark:hover:bg-nvu-strip">
              <summary.icon size={14} />{summary.title}
            </a>
          ))}
        </div>
      </header>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-nvu-line dark:bg-nvu-page" aria-label="Como usar os guias">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Como usar os guias</p>
        <ol className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-600 dark:text-nvu-muted">
          <li>1. Leia o resumo das etapas logo abaixo — cada etapa abre com um toque.</li>
          <li>2. Toque em <strong>Baixar guia</strong> para salvar o PDF completo no aparelho.</li>
          <li>3. Quando a NVU publicar uma versão nova do guia, o botão passa a baixar o arquivo atualizado automaticamente.</li>
        </ol>
      </section>

      <div className="space-y-8">
        {guides.map(({ summary, resolved }) => (
          <div key={summary.id}>
            <GuideDownloadCard guide={resolved} accent={summary.accent} />
            <ManualGroup
              id={`manual-${summary.id}`}
              eyebrow={summary.eyebrow}
              title={summary.title}
              description={summary.description}
              icon={summary.icon}
              accent={summary.accent}
              items={stageItems(summary)}
              defaultOpenFirst={(summary.id === "driver" && activeRole === "driver") || (summary.id === "company" && activeRole === "admin")}
            />
            <ul className="mt-3 space-y-1 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500 dark:bg-nvu-strip dark:text-nvu-muted">
              {summary.howTo.map(line => <li key={line}>• {line}</li>)}
            </ul>
          </div>
        ))}

        <PlatformRules />

        <section id="manual-comprovante" className="scroll-mt-20">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-nvu-line dark:bg-nvu-page"><TripReceiptRules /></div>
        </section>
      </div>

      <footer className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-nvu-muted">
        <History size={13} />
        Consulte os guias sempre que precisar revisar um fluxo.
      </footer>
    </div>
  );
}
