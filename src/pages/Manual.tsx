import React from "react";
import {
  Activity,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileImage,
  History,
  ShieldCheck,
  Truck,
  UserCheck,
} from "lucide-react";
import { useSessionStore } from "../context/AppContext";
import { cn } from "../lib/utils";

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
  <div className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-[#b4b4bd]">
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
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-[#2A2F3A] dark:bg-[#111318]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-[#20242b] dark:text-[#a1a1aa]">
          <ItemIcon size={16} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
            {item.title}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-[#8f8f99]">
            {item.description}
          </span>
        </span>
        <ChevronDown
          size={17}
          className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="relative border-t border-slate-100 px-4 py-4 dark:border-[#242933]">
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
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-[#71717a]">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
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
      <p className="mt-1 text-xs text-slate-500 dark:text-[#8f8f99]">
        Registre a viagem somente com um print que cumpra as regras abaixo.
      </p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-500/15 dark:bg-emerald-500/5">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Deve aparecer
        </p>
        <div className="space-y-1.5 text-sm text-slate-700 dark:text-[#d4d4d8]">
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
        <div className="space-y-1.5 text-sm text-slate-700 dark:text-[#d4d4d8]">
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

const PaintDownloadNotice = () => (
  <div className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2.5 text-sm leading-relaxed text-teal-900 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-200">
    <Download size={16} className="mt-0.5 shrink-0" />
    <p>
      <strong>Baixar pintura:</strong> na página de operação ativa, clique no
      nome do veículo ou do reboque para baixar a pintura cadastrada pela
      empresa.
    </p>
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

export default function Manual() {
  const { activeRole } = useSessionStore();

  const driverItems: ManualItem[] = [
    {
      title: "Como iniciar um trabalho",
      description: "Solicite, receba e inicie sua operação.",
      icon: BriefcaseBusiness,
      content: (
        <StepList>
          <Step>Sem operação ativa, toque em <strong>Solicitar Nova Operação</strong>.</Step>
          <Step>Quando a empresa enviar o trabalho, confira contrato, veículo, reboque e prazo.</Step>
          <Step>Toque em <strong>Iniciar Operação</strong> para liberar o acompanhamento e o registro das viagens.</Step>
        </StepList>
      ),
    },
    {
      title: "Pinturas dos veículos",
      description: "Baixe a pintura diretamente na operação ativa.",
      icon: Download,
      content: (
        <div className="space-y-3">
          <StepList>
            <Step>Abra a página da operação ativa.</Step>
            <Step>Clique no nome do veículo ou do reboque para baixar a pintura cadastrada pela empresa.</Step>
            <Step>Use a pintura correta antes de registrar a viagem.</Step>
          </StepList>
          <PaintDownloadNotice />
        </div>
      ),
    },
    {
      title: "Como enviar viagens",
      description: "Registre o comprovante e acompanhe o histórico.",
      icon: FileImage,
      content: (
        <div className="space-y-3">
          <StepList>
            <Step>Na operação ativa, toque em <strong>Registrar viagem</strong>.</Step>
            <Step>Preencha os dados, envie o print e confirme o registro.</Step>
            <Step>Revise as viagens no histórico e acompanhe o progresso da operação.</Step>
          </StepList>
          <TripReceiptRules />
        </div>
      ),
    },
    {
      title: "Notificações",
      description: "Receba avisos para acompanhar suas atividades.",
      icon: Bell,
      content: (
        <StepList>
          <Step>As notificações informam respostas de solicitações, novos trabalhos e mudanças na operação.</Step>
          <Step>Também podem avisar sobre viagens, ocorrências, suspensões e comunicados importantes.</Step>
          <Step>Mantenha as permissões de notificação ativadas no dispositivo.</Step>
        </StepList>
      ),
    },
  ];

  const adminItems: ManualItem[] = [
    {
      title: "Preparar a estrutura da empresa",
      description: "Cadastre os recursos antes de criar operações.",
      icon: Truck,
      content: (
        <StepList>
          <Step>Cadastre os veículos e os reboques da frota.</Step>
          <Step>Mantenha nomes, dados e pinturas atualizados.</Step>
          <Step>Confira os motoristas ativos antes de distribuir trabalhos.</Step>
        </StepList>
      ),
    },
    {
      title: "Criar e enviar uma operação",
      description: "Defina o trabalho e designe o motorista.",
      icon: ClipboardCheck,
      content: (
        <StepList>
          <Step>Abra <strong>Nova Operação</strong> e selecione o contrato operacional.</Step>
          <Step>Escolha o veículo, o reboque quando necessário, o motorista e o prazo.</Step>
          <Step>Confirme em <strong>Designar</strong> para enviar a operação ao motorista.</Step>
        </StepList>
      ),
    },
    {
      title: "Acompanhar ou cancelar trabalhos",
      description: "Monitore o andamento de cada operação.",
      icon: Activity,
      content: (
        <StepList>
          <Step>Acompanhe operações não iniciadas, ativas e finalizadas pela área de trabalhos.</Step>
          <Step>Abra o trabalho para conferir motorista, prazo, viagens e progresso.</Step>
          <Step>Quando necessário, use <strong>Cancelar</strong> para encerrar uma operação em andamento.</Step>
        </StepList>
      ),
    },
    {
      title: "Recursos Humanos e motoristas",
      description: "Analise inscrições e mantenha a equipe atualizada.",
      icon: UserCheck,
      content: (
        <StepList>
          <Step>No Recursos Humanos, confira os dados e a foto enviados pelo candidato.</Step>
          <Step>Aprove ou reprove a inscrição conforme os critérios da empresa.</Step>
          <Step>Na lista de motoristas, abra o perfil e use <strong>Remover da frota</strong> quando necessário.</Step>
        </StepList>
      ),
    },
    {
      title: "Fiscalizar viagens",
      description: "Confira comprovantes e mantenha o padrão da empresa.",
      icon: ShieldCheck,
      content: (
        <StepList>
          <Step>Use o histórico de viagens para conferir valores, datas, motorista, veículo e comprovante.</Step>
          <Step>Verifique se a pintura, iluminação, enquadramento e valor seguem as regras da plataforma.</Step>
          <Step>Registre as medidas disponíveis quando encontrar viagens fora do padrão.</Step>
        </StepList>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <header className="mb-6 rounded-3xl border border-slate-200 bg-white px-5 py-5 dark:border-[#2A2F3A] dark:bg-[#111318] sm:px-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <BookOpen size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-[#71717a]">
              Central de orientação
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Manual da Plataforma
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
              Guia rápido para motoristas e administradores.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:w-fit">
          <a
            href="#manual-motorista"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#2A2F3A] dark:text-[#d4d4d8] dark:hover:bg-[#20242b]"
          >
            <Truck size={14} />
            Motorista
          </a>
          <a
            href="#manual-administrativo"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#2A2F3A] dark:text-[#d4d4d8] dark:hover:bg-[#20242b]"
          >
            <Building2 size={14} />
            Administrativo
          </a>
        </div>
      </header>

      <PlatformRules />

      <div className="space-y-8">
        <ManualGroup
          id="manual-motorista"
          eyebrow="Perfil do motorista"
          title="Como usar os trabalhos da plataforma"
          description="Inicie trabalhos, use as pinturas corretas e registre suas viagens."
          icon={Truck}
          accent="teal"
          items={driverItems}
          defaultOpenFirst={activeRole === "driver"}
        />

        <ManualGroup
          id="manual-administrativo"
          eyebrow="Empresa e administração"
          title="Como funciona a gestão da empresa"
          description="Cadastre recursos, distribua operações e fiscalize os trabalhos."
          icon={ShieldCheck}
          accent="blue"
          items={adminItems}
          defaultOpenFirst={activeRole === "admin"}
        />
      </div>

      <footer className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-[#71717a]">
        <History size={13} />
        Consulte este manual para revisar os principais fluxos.
      </footer>
    </div>
  );
}
