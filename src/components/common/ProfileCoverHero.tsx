import { CachedImage } from "./CachedImage";
import React, { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Building2, Camera, ChevronDown, UserRound } from "lucide-react";
import { resolveProfileCover, type ProfileCoverScope } from "../../lib/profileCover";
import { useProfileCover } from "../../hooks/useProfileCover";
import { StableImage } from "./StableImage";
import "./ProfileCoverHero.css";

const Editor = lazy(() => import("../ProfileCoverEditorModal"));

export function ProfileCoverHero({ scope, profileId, profile, name, description, avatar, viewerId, simulator, simulatorOpen, onSimulator, canEdit = false }: {
  scope: ProfileCoverScope; profileId: string; profile: unknown; name: string; description: string;
  avatar: string; viewerId: string; simulator: string; simulatorOpen: boolean; onSimulator: () => void; canEdit?: boolean;
}) {
  const target = { scope, profileId };
  const cover = useProfileCover(viewerId, target, resolveProfileCover(profile));
  const [editing, setEditing] = useState(false);
  const [showCoverActions, setShowCoverActions] = useState(false);
  const imageArea = useRef<HTMLDivElement>(null);
  const coverTrigger = useRef<HTMLButtonElement>(null);
  const actionsId = useId();
  useEffect(() => { setShowCoverActions(false); setEditing(false); }, [scope, profileId, canEdit]);
  useEffect(() => {
    if (!showCoverActions) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !imageArea.current?.contains(event.target)) setShowCoverActions(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editing) { setShowCoverActions(false); coverTrigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
  }, [showCoverActions, editing]);
  const [failedImage, setFailedImage] = useState("");
  const Icon = scope === "company" ? Building2 : UserRound;
  return <section className="nvu-cover-hero" data-nvu-profile-cover data-profile-scope={scope} aria-label={scope === "company" ? "Perfil da empresa" : "Perfil do motorista"}>
    <div className="nvu-cover-image" ref={imageArea}>
      {cover.src && failedImage !== cover.src ? <CachedImage src={cover.src} onError={() => setFailedImage(cover.src)} alt={`Capa do perfil de ${name}`} decoding="async" fetchPriority="high"/> : <div className="nvu-cover-placeholder" aria-hidden="true"><Icon size={46}/></div>}
      {canEdit && <button ref={coverTrigger} type="button" className="nvu-cover-activate" aria-label="Mostrar opções da capa do perfil" aria-expanded={showCoverActions} aria-controls={showCoverActions ? actionsId : undefined} onClick={() => setShowCoverActions(value => !value)}/>}
      {canEdit && showCoverActions && <button id={actionsId} type="button" className="nvu-cover-edit" aria-label="Editar capa do perfil" onClick={() => setEditing(true)}><Camera size={17}/><span>Editar capa</span></button>}
    </div>
    <div className="nvu-cover-identity">
      <StableImage src={avatar} persistentViewerId={viewerId} persistentAssetId={`${scope}-profile:${profileId}`} alt={scope === "company" ? `Logo de ${name}` : `Foto de ${name}`} wrapperClassName="nvu-cover-avatar" className="object-cover" fallback={<Icon size={29}/>} loading="eager" referrerPolicy="no-referrer"/>
      <div className="nvu-cover-copy"><h2>{name}</h2><p>{description}</p></div>
      <button type="button" className="nvu-cover-simulator" aria-label={scope === "company" ? "Selecionar simulador da empresa" : "Selecionar simulador"} aria-expanded={simulatorOpen} aria-haspopup="dialog" onClick={onSimulator}><span>{simulator}</span><ChevronDown size={17}/></button>
    </div>
    {canEdit && cover.pending && <div className="nvu-cover-sync" role="status"><span>{cover.failed ? "Capa salva no aparelho. Sincronização pendente." : "Capa salva no aparelho. Aguardando sincronização."}</span>{cover.failed && <button type="button" onClick={cover.retry}>Tentar novamente</button>}</div>}
    {editing && canEdit && <Suspense fallback={<span className="sr-only" role="status">Abrindo edição da capa…</span>}><Editor key={`${scope}:${profileId}`} viewerId={viewerId} target={target} image={cover.src} onClose={() => { setEditing(false); setShowCoverActions(false); coverTrigger.current?.focus({ preventScroll: true }); }}/></Suspense>}
  </section>;
}
