import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, User } from "lucide-react";
import type {
  CompanyProfile,
  RecruitmentApplication,
  User as NvuUser,
} from "../../context/AppContext";
import { resolveProfilePhoto } from "../../lib/resolveProfilePhoto";
import { resolveRecruitmentPhoto } from "../../lib/recruitmentPhoto";
import { StableImage } from "../common/StableImage";

interface PendingApplicationsCarouselProps {
  applications: RecruitmentApplication[];
  currentUser: NvuUser | null;
  companies: CompanyProfile[];
  className?: string;
  deferImages?: boolean;
}

const resolveApplicationType = (application: RecruitmentApplication) =>
  String(application.type || application.registrationType || "driver_application");

const formatDateTime = (rawValue?: string) => {
  if (!rawValue) return "Data indisponível";
  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
};

export function PendingApplicationsCarousel({
  applications,
  currentUser,
  companies,
  className = "",
  deferImages = false,
}: PendingApplicationsCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const cards = useMemo(
    () =>
      applications.map((application) => {
        const isCompanyRegistration =
          resolveApplicationType(application) === "company_registration";
        const company = companies.find(
          (candidate) => candidate.id === application.companyId,
        );

        const personName = isCompanyRegistration
          ? String(application.ownerName || "").trim() ||
            currentUser?.name?.trim() ||
            currentUser?.email?.split("@")[0] ||
            "Proprietário"
          : currentUser?.name?.trim() ||
            application.fullName?.trim() ||
            currentUser?.email?.split("@")[0] ||
            "Motorista";

        const personPhoto = isCompanyRegistration
          ? String(application.ownerPhotoUrl || "").trim() ||
            resolveProfilePhoto(currentUser) ||
            null
          : resolveRecruitmentPhoto(application, currentUser) ||
            resolveProfilePhoto(currentUser) ||
            null;

        const companyName = isCompanyRegistration
          ? String(application.companyName || "").trim() || "Empresa em análise"
          : String(application.companyName || "").trim() ||
            company?.companyName?.trim() ||
            company?.fleetName?.trim() ||
            "Empresa em análise";

        const companyLogo = isCompanyRegistration
          ? String(application.companyLogoURL || "").trim() || null
          : String(application.companyLogoURL || "").trim() ||
            company?.logoUrl ||
            company?.logoURL ||
            company?.companyLogoURL ||
            null;

        const simulatorName =
          String(application.simulatorName || "").trim() ||
          String(company?.simulatorName || "").trim();

        return {
          application,
          isCompanyRegistration,
          personName,
          personPhoto,
          companyName,
          companyLogo,
          simulatorName,
          dateTime: formatDateTime(application.createdAt),
        };
      }),
    [applications, companies, currentUser],
  );

  useEffect(() => {
    if (activeIndex < cards.length) return;
    setActiveIndex(Math.max(0, cards.length - 1));
  }, [activeIndex, cards.length]);

  const updateActiveIndex = () => {
    const container = scrollerRef.current;
    if (!container || container.children.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.left + containerRect.width / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    Array.from(container.children).forEach((child, index) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      const childCenter = rect.left + rect.width / 2;
      const distance = Math.abs(childCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setActiveIndex(nearestIndex);
  };

  const goToCard = (requestedIndex: number) => {
    const container = scrollerRef.current;
    if (!container || cards.length === 0) return;

    const index = Math.max(0, Math.min(requestedIndex, cards.length - 1));
    const child = container.children.item(index) as HTMLElement | null;
    if (!child) return;

    const containerRect = container.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const targetLeft = Math.max(
      0,
      Math.min(
        container.scrollLeft + childRect.left - containerRect.left,
        maxScrollLeft,
      ),
    );

    setActiveIndex(index);
    container.scrollTo({ left: targetLeft, behavior: "smooth" });
  };

  const handleScrollerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToCard(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goToCard(activeIndex + 1);
    }
  };

  if (cards.length === 0) return null;

  return (
    <div className={className}>
      <div
        ref={scrollerRef}
        onScroll={updateActiveIndex}
        onKeyDown={handleScrollerKeyDown}
        tabIndex={cards.length > 1 ? 0 : -1}
        className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus:outline-none"
        aria-label="Inscrições e cadastros pendentes"
      >
        {cards.map((card) => (
          <article
            key={card.application.id}
            className="w-full min-w-full shrink-0 snap-center rounded-2xl border border-slate-200 dark:border-[#2A2F3A] bg-slate-50/80 dark:bg-[#111318] p-3.5 sm:p-4 text-left"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-[#71717a]">
                  {card.isCompanyRegistration
                    ? "Cadastro de empresa"
                    : "Inscrição de motorista"}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#a1a1aa] mt-0.5">
                  {card.dateTime}
                </p>
              </div>
              <span className="inline-flex w-fit items-center rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[10px] sm:text-[11px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap">
                Aguardando avaliação
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] px-3 py-2">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#27272a] flex items-center justify-center shrink-0">
                  {card.personPhoto ? (
                    <StableImage
                      src={card.personPhoto}
                      alt={card.personName}
                      wrapperClassName="w-full h-full"
                      className="object-cover"
                      preload={!deferImages}
                      loading={deferImages ? "lazy" : undefined}
                      decoding="async"
                      fallback={
                        <User
                          size={16}
                          className="text-slate-400 dark:text-[#a1a1aa]"
                        />
                      }
                    />
                  ) : (
                    <User
                      size={16}
                      className="text-slate-400 dark:text-[#a1a1aa]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-[#71717a] mb-0.5">
                    {card.isCompanyRegistration ? "Proprietário" : "Motorista"}
                  </p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {card.personName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] px-3 py-2">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#27272a] flex items-center justify-center shrink-0">
                  {card.companyLogo ? (
                    <StableImage
                      src={card.companyLogo}
                      alt={card.companyName}
                      wrapperClassName="w-full h-full"
                      className="object-cover"
                      preload={!deferImages}
                      loading={deferImages ? "lazy" : undefined}
                      decoding="async"
                      fallback={
                        <Building2
                          size={16}
                          className="text-slate-400 dark:text-[#a1a1aa]"
                        />
                      }
                    />
                  ) : (
                    <Building2
                      size={16}
                      className="text-slate-400 dark:text-[#a1a1aa]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-[#71717a] mb-0.5">
                    Empresa
                  </p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {card.companyName}
                  </p>
                  {card.simulatorName && (
                    <p className="text-[11px] text-slate-500 dark:text-[#a1a1aa] truncate mt-0.5">
                      {card.simulatorName}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {cards.length > 1 && (
        <div
          className="mt-2 flex items-center justify-center gap-1"
          aria-label={`${cards.length} solicitações pendentes`}
        >
          <button
            type="button"
            onClick={() => goToCard(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 dark:text-[#a1a1aa] hover:bg-slate-100 dark:hover:bg-[#27272a] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            aria-label="Solicitação anterior"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="flex items-center justify-center gap-0.5">
            {cards.map((card, index) => (
              <button
                key={card.application.id}
                type="button"
                onClick={() => goToCard(index)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                aria-label={`Visualizar solicitação ${index + 1}`}
                aria-current={activeIndex === index ? "true" : undefined}
              >
                <span
                  className={`block h-2 rounded-full transition-[width,background-color] ${
                    activeIndex === index
                      ? "w-5 bg-slate-700 dark:bg-slate-200"
                      : "w-2 bg-slate-300 dark:bg-[#52525b]"
                  }`}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => goToCard(activeIndex + 1)}
            disabled={activeIndex === cards.length - 1}
            className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 dark:text-[#a1a1aa] hover:bg-slate-100 dark:hover:bg-[#27272a] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            aria-label="Próxima solicitação"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
