// Isolated presentation ports: never initialize Firebase or contact production.
export const session = { currentUser: { id: "fixture-driver", roles: ["admin", "driver"] }, activeRole: "driver" };
export const useSessionStore = () => session;
export const useOperationalStore = () => ({ startAutomaticOperation: async () => { throw new Error("Use explicit fixture onStart"); } });
export const useAutomaticOperations = () => { throw new Error("Use DriverQueuePanel with explicit fixture API"); };
export const preloadRoute = async (_path: string) => {};
export const preloadFleetPanel = async (_panel: string) => {};
export const prepareAndCommitNavigation = async (prepare: () => unknown, commit: () => void) => { commit(); await prepare(); };
