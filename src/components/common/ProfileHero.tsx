import { Building2, ChevronDown, UserRound } from "lucide-react";
import { StableImage } from "./StableImage";
import "./OperationIdentity.css";

/** Shared geometry and chrome for the personal and company profiles. */
export function ProfileHero({ scope, name, description, image, viewerId, assetId, simulator, simulatorOpen, onSimulator, compactIdentity = false }: {
  scope: "driver" | "company"; name: string; description: string; image: string;
  viewerId: string; assetId: string; simulator: string; simulatorOpen: boolean; onSimulator: () => void; compactIdentity?: boolean;
}) {
  const Icon = scope === "company" ? Building2 : UserRound;
  return <section data-nvu-profile-banner data-profile-scope={scope}
    className={`nvu-profile-hero nvu-driver-hero ${compactIdentity ? "nvu-operation-hero" : ""} relative isolate -mx-2 -mt-2 h-[300px] min-h-0 overflow-hidden rounded-b-[18px] bg-[#0e1d29] sm:-mx-4 sm:-mt-4 sm:h-[320px]`}
    onClick={() => window.dispatchEvent(new CustomEvent("nvu-profile-banner-tapped", { detail: { scope } }))}>
    <div className="absolute inset-0 overflow-hidden">
      <StableImage src={image} persistentViewerId={viewerId} persistentAssetId={assetId} alt="" loading="eager" decoding="async" fetchPriority="high"
        wrapperClassName="absolute inset-0 h-full w-full" className="object-cover object-center" referrerPolicy="no-referrer"
        fallback={<span className="h-full w-full bg-[radial-gradient(circle_at_72%_22%,#1a5362_0%,#102839_46%,#07131e_100%)]" />} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,16,28,0.18)_0%,rgba(4,16,28,0.04)_38%,rgba(4,16,28,0.10)_78%,rgba(4,16,28,0.40)_100%)]" />
      <div className="absolute inset-y-0 left-0 w-2/3 bg-[linear-gradient(90deg,rgba(4,16,28,0.12)_0%,transparent_100%)]" />
    </div>
    <div className="nvu-driver-hero-content relative z-10 flex h-full min-h-0 flex-col justify-end p-4 pb-8 pt-[calc(env(safe-area-inset-top)+3.75rem)] sm:p-6 sm:pb-9">
      {compactIdentity ? <div className="nvu-operation-identity" data-nvu-operation-identity>
        <div className="nvu-operation-driver"><span className="nvu-operation-accent" aria-hidden="true"/><Icon aria-hidden="true"/><h2 title={name}>{name}</h2></div>
        <button type="button" className="nvu-driver-simulator nvu-operation-simulator" aria-label="Selecionar simulador" aria-expanded={simulatorOpen} aria-haspopup="dialog"
          onClick={event => { event.stopPropagation(); onSimulator(); }}><span>{simulator || "Simulador"}</span><ChevronDown size={15} className={simulatorOpen ? "rotate-180" : ""}/></button>
      </div> : <div className="flex items-end justify-between gap-4 sm:gap-6">
        <div className="flex min-w-0 flex-1 items-end gap-3 sm:gap-4">
          <div className="h-11 w-1 shrink-0 rounded-full bg-[#13c9b4] sm:h-16" />
          <div className="min-w-0 text-white">
            <div className="flex items-center gap-2"><Icon size={19} className="shrink-0 text-white/95 sm:h-6 sm:w-6" /><h2 className="truncate text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)] sm:text-[22px]">{name}</h2></div>
            <p className="mt-1 text-[12px] font-medium text-white/90 sm:text-[14px]">{description}</p>
          </div>
        </div>
        <button type="button" className="nvu-driver-simulator shrink-0 self-end" aria-label={scope === "company" ? "Selecionar simulador da empresa" : "Selecionar simulador"} aria-expanded={simulatorOpen} aria-haspopup="dialog"
          onClick={event => { event.stopPropagation(); onSimulator(); }}><span>{simulator || "Simulador"}</span><ChevronDown size={15} className={simulatorOpen ? "rotate-180" : ""} /></button>
      </div>}
    </div>
  </section>;
}
