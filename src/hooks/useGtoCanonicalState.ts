import { useEffect, useState } from "react";
import { subscribeToGtoCanonicalSession } from "../services/gtoCanonicalState";

export function useGtoCanonicalState(driverId?: string) {
  const [state, setState] = useState<any | null>(null);
  useEffect(() => {
    if (!driverId) {
      setState(null);
      return;
    }
    return subscribeToGtoCanonicalSession(driverId, setState, error => {
      console.warn("[GTO] Falha ao acompanhar estado canônico:", error);
    });
  }, [driverId]);
  return state;
}
