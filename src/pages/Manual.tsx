import React from "react";
import { Building2, ChevronDown, FileText, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useSessionStore } from "../context/AppContext";
import { APP_GUIDES, formatGuideSize, resolveAppGuide, type AppGuideId } from "../lib/appGuides";
import { downloadAppGuide } from "../lib/appGuidesDownload";
import { watchAppGuides, type AppGuideRecords } from "../services/appGuidesService";
import "../components/admin/management/ManagementDashboard.css";
import "./ManualGuides.css";

type Stage = { title: string; points: [string, string][]; tip?: [string, string] };
type GuideSummary = { label: string; title: string; lead: string; icon: React.ElementType; stages: Stage[] };

// Resumo dos guias oficiais (PDF). O texto acompanha o app; o PDF pode ser trocado pelo Painel Sênior sem nova versão do APK.
const GUIDES: Record<AppGuideId, GuideSummary> = {
  driver: {
    label: "Motorista", title: "Guia do Motorista", icon: UserRound,
    lead: "Da missão ao encerramento, com o trabalho organizado pela NVU.",
    stages: [
      { title: "Antes de começar", points: [
        ["Entre na empresa certa", "Inscreva-se e, depois de aprovado, escolha a empresa e o simulador."],
        ["Tipo de trabalho", "Designado, enviado um a um, ou fila automática, em sequência."],
        ["Entenda a missão", "Veja a meta de viagens, o veículo, o reboque e o prazo."],
      ], tip: ["Não achou a operação?", "Confira a empresa e o simulador ou fale com o gestor."] },
      { title: "Viaje com o Modo Pro", points: [
        ["Siga sua missão", "Mantenha a execução alinhada ao trabalho, à meta e ao prazo da empresa."],
        ["Registre cada viagem", "Use o Modo Pro durante a operação para registrar suas viagens."],
        ["Foque na viagem", "A NVU organiza o trabalho; você se concentra em dirigir."],
      ], tip: ["Modo Pro compatível com", "ATS, ETS 2, GTO, TOE 3, WBDS e WTDS."] },
      { title: "Conclua no prazo", points: [
        ["Confira o que falta", "Compare as viagens registradas com a meta e acompanhe o tempo restante."],
        ["Finalize pelo painel", "Ao cumprir a meta, finalize o trabalho no painel, dentro do prazo."],
        ["Continue a fila", "Na fila automática, siga os trabalhos na ordem definida."],
      ], tip: ["Histórico de viagens", "Filtre por simulador, empresa e período para conferir seus registros."] },
    ],
  },
  company: {
    label: "Empresário", title: "Guia do Empresário", icon: Building2,
    lead: "Frota, equipe e operações organizadas para a sua empresa de transporte virtual.",
    stages: [
      { title: "Prepare sua empresa", points: [
        ["Empresa e simulador", "Confira no painel de gestão antes de começar."],
        ["Veículos", "Cadastre a frota e confira os dados."],
        ["Equipe", "Receba as inscrições, avalie e aprove os candidatos."],
      ], tip: ["Dica", "Mantenha frota e equipe sempre atualizadas."] },
      { title: "Organize os trabalhos", points: [
        ["Crie a operação", "Defina a meta de viagens, o veículo, o reboque (se houver) e o prazo."],
        ["Trabalhos designados", "Envie a operação ao motorista, um a um, mantendo o controle de cada envio."],
        ["Fila automática", "Envie várias operações na ordem desejada; o motorista segue a sequência."],
      ], tip: ["Modo Pro", "O motorista registra viagens sem sair do simulador."] },
      { title: "Acompanhe e decida", points: [
        ["Veja o andamento", "Confira prazos, viagens registradas e o que falta para cumprir cada operação."],
        ["Consulte as viagens", "Abra uma viagem para ver origem, destino, valor e comprovante."],
        ["Analise os períodos", "Compare semanas ou meses; filtre por empresa, motorista e período."],
        ["Planeje", "Use os resultados para ajustar a frota e a distribuição dos trabalhos."],
      ], tip: ["Simuladores do Modo Pro", "ATS, ETS 2, GTO, TOE 3, WBDS e WTDS."] },
    ],
  },
};

export default function Manual() {
  const { activeRole } = useSessionStore();
  const [selected, setSelected] = React.useState<AppGuideId>(activeRole === "admin" ? "company" : "driver");
  const [records, setRecords] = React.useState<AppGuideRecords>({});
  const [busy, setBusy] = React.useState(false);
  // Sem rede ou sem permissão de leitura da ficha: continua valendo o guia que acompanha o app.
  React.useEffect(() => {
    try { return watchAppGuides(setRecords, () => undefined); } catch { return undefined; }
  }, []);

  const summary = GUIDES[selected];
  const Icon = summary.icon;
  const guide = resolveAppGuide(APP_GUIDES.find(item => item.id === selected)!, records[selected]);
  const detail = guide.source === "uploaded"
    ? ["Atualizado pela NVU", guide.updatedAtMs ? new Date(guide.updatedAtMs).toLocaleDateString("pt-BR") : "", formatGuideSize(guide.size)].filter(Boolean).join(" · ")
    : "Guia que acompanha o aplicativo";

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try { await downloadAppGuide(guide); }
    catch { toast.error("Não foi possível baixar o guia agora. Tente novamente."); }
    finally { setBusy(false); }
  };

  return (
    <div className="nvu-central-palette nvu-guides" data-testid="guides-page">
      <header className="nvu-guides-head">
        <div className="nvu-guides-title">
          <span className="nvu-guides-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
          <h1>{summary.title}</h1>
        </div>
        <p className="nvu-guides-lead">{summary.lead}</p>
      </header>

      <div className="nvu-guides-tabs" role="tablist" aria-label="Guias">
        {APP_GUIDES.map(item => (
          <button type="button" role="tab" key={item.id} aria-selected={selected === item.id} data-guide-tab={item.id} onClick={() => setSelected(item.id)}>
            {GUIDES[item.id].label}
          </button>
        ))}
      </div>

      <button type="button" className="nvu-guides-pdf" onClick={() => void download()} disabled={busy} aria-label={`Baixar ${guide.definition.title}`} data-guide-card={selected} data-guide-source={guide.source}>
        <FileText size={20} strokeWidth={1.7} aria-hidden="true" />
        <span><strong>Guia completo em PDF</strong><small>{detail}</small></span>
        <span>{busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}Baixar</span>
      </button>

      <div className="nvu-guides-list" key={selected}>
        {summary.stages.map((stage, index) => (
          <details className="nvu-guides-stage" key={stage.title} open={index === 0}>
            <summary>
              <span className="nvu-guides-num">{index + 1}</span>
              <strong>{stage.title}</strong>
              <ChevronDown className="nvu-guides-chev" size={18} aria-hidden="true" />
            </summary>
            <ul className="nvu-guides-points">
              {stage.points.map(([name, text]) => <li key={name}><b>{name}</b><span>{text}</span></li>)}
              {stage.tip && <li className="nvu-guides-tip"><b>{stage.tip[0]}</b><span>{stage.tip[1]}</span></li>}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
