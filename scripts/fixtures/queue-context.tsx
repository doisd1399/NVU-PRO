// Presentation fixture only. No Firebase, authentication or remote writes.
import { createContext, useContext } from "react";
export const AutomaticOperationsContext = createContext<any>(null);
export const useOptionalAutomaticOperations = () =>
  useContext(AutomaticOperationsContext);
export function useAutomaticOperations() {
  return useContext(AutomaticOperationsContext);
}
export const useOperationalStore = () => ({
  startAutomaticOperation: async () => {
    throw new Error("Use fixture onStart");
  },
});
