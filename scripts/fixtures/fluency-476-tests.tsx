import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useTheme } from "../../src/hooks/useTheme";
import { useProfileChrome } from "../../src/hooks/useProfileChrome";
import { AutomaticOperationsProvider, useAutomaticOperations } from "../../src/contexts/AutomaticOperationsProvider";
export { SyncEngine } from "../../src/services/sync/SyncEngine";
export { OfflineDatabase } from "../../src/services/offline/OfflineDatabase";
export { TripRegistrationService } from "../../src/application/trip/TripRegistrationService";
export { CanonicalTripCommandService } from "../../src/application/trip/CanonicalTripCommandService";
export * from "./fluency-476-ports";
export { act };
let root: ReturnType<typeof createRoot>;
export async function render(node: React.ReactNode) {
  if (!root) root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(node));
}
function ThemeProbe({ id }: { id: string }) {
  const { theme, toggleTheme } = useTheme();
  return <button id={id} onClick={toggleTheme}>{theme}</button>;
}
export const themes = (count: number) => render(<>{Array.from({ length: count }, (_, i) => <ThemeProbe key={i} id={`theme-${i}`} />)}</>);
export let chromeRenders = 0;
export let heroBottom = 300;
export const setHeroBottom = (value: number) => { heroBottom = value; };
function ChromeProbe() {
  chromeRenders++;
  const { headerRef, heroChromeActive } = useProfileChrome(true);
  return <><header ref={headerRef} data-active={String(heroChromeActive)} /><div className="nvu-profile-hero" ref={node => {
    if (node) {
      node.getBoundingClientRect = () => ({ bottom: heroBottom } as DOMRect);
      // JSDOM has no layout engine. Model the visible hero as well as its
      // position so the production hook can ignore hidden retained profiles.
      node.getClientRects = () => [node.getBoundingClientRect()] as unknown as DOMRectList;
    }
  }} /></>;
}
export const chrome = () => render(<ChromeProbe />);
export let api: ReturnType<typeof useAutomaticOperations>;
function QueueProbe() {
  api = useAutomaticOperations();
  return <output id="queue-state">{JSON.stringify({ scope: api.scopeKey, fresh: api.fresh, loading: api.loading, view: api.view, settings: api.settings })}</output>;
}
export const queue = () => render(<AutomaticOperationsProvider><QueueProbe /></AutomaticOperationsProvider>);
export const clear = () => render(null);
export async function unmount() { await act(async () => root?.unmount()); }
