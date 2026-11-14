import React, { createContext, useContext } from "react";
import { StableImage } from "../common/StableImage";

/** Fotos dos motoristas da empresa (id → URL), fornecidas pela página; as listas de Pagamentos usam a foto e, sem ela, as iniciais. */
export const DriverPhotosContext = createContext<ReadonlyMap<string, string>>(new Map());
const initials = (name: string) => name.split(/\s+/).map(word => word[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

export function DriverAvatar({ id, name, size = 36 }: { id: string; name: string; size?: number }) {
  const photo = useContext(DriverPhotosContext).get(id) || "";
  const fallback = <span style={{ fontWeight: 700 }}>{initials(name)}</span>;
  return <span className="nvu-central-avatar" style={{ display: "inline-grid", placeItems: "center", width: size, height: size, borderRadius: "50%", overflow: "hidden", flex: "none" }} aria-hidden="true">
    {photo ? <StableImage src={photo} alt="" loading="lazy" decoding="async" wrapperClassName="h-full w-full" className="object-cover" referrerPolicy="no-referrer" fallback={fallback} /> : fallback}
  </span>;
}
