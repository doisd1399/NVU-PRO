import React, { useEffect, useId, useState } from "react";
import { useOptionalAutomaticOperations } from "../../contexts/AutomaticOperationsProvider";
import { driverQueuePresentation } from "../../lib/driverQueuePresentation";
import { AutomaticDriverQueue } from "./AutomaticDriverQueue";
import "../driver/DriverLandscape.css";

type PanelTab = "queue" | "routes" | "trips";

/**
 * Right-hand card of the horizontal "Painel do motorista". One fixed card with
 * tabs replaces the two collapsible sections used on portrait screens; the
 * queue, contract routes and trip history are the same components.
 */
export function LandscapeOperationPanel({ blocked = false, tripCount, routes = null, trips }: {
  blocked?: boolean;
  tripCount: number;
  /** Detailed contracts only: the existing route card. */
  routes?: React.ReactNode;
  trips: React.ReactNode;
}) {
  const automatic = useOptionalAutomaticOperations();
  const view = automatic?.view;
  const presentation = view?.queues.length ? driverQueuePresentation(view) : null;
  const baseId = useId();
  const [chosen, setChosen] = useState<PanelTab | null>(null);
  const [tripsMounted, setTripsMounted] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null);

  const tabs: { id: PanelTab; label: string; count: string | null }[] = [];
  if (presentation) tabs.push({ id: "queue", label: "Fila operacional", count: `${presentation.done}/${presentation.count}` });
  if (routes) tabs.push({ id: "routes", label: "Rotas do contrato", count: null });
  tabs.push({ id: "trips", label: "Viagens da operação", count: String(tripCount) });

  // The queue is the first view when it exists; a chosen tab only wins while it is available.
  const active: PanelTab = chosen && tabs.some(tab => tab.id === chosen) ? chosen : tabs[0].id;
  useEffect(() => { if (active === "trips") setTripsMounted(true); }, [active]);

  const tabId = (id: PanelTab) => `${baseId}-tab-${id}`;
  const panelId = (id: PanelTab) => `${baseId}-panel-${id}`;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(tab => tab.id === active);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next].id;
    setChosen(target);
    document.getElementById(tabId(target))?.focus();
  };

  return (
    <section className="nvu-landscape-panel" aria-label="Fila e viagens da operação" data-testid="landscape-operation-panel">
      <div className="nvu-landscape-panel-card">
        <header className="nvu-landscape-panel-head">
          <div className="nvu-landscape-tabs" role="tablist" aria-label="Fila e viagens da operação" onKeyDown={onKeyDown}>
            {tabs.map(tab => (
              <button key={tab.id} type="button" role="tab" id={tabId(tab.id)} aria-selected={active === tab.id}
                aria-controls={panelId(tab.id)} tabIndex={active === tab.id ? 0 : -1} onClick={() => setChosen(tab.id)}>
                <span>{tab.label}</span>
                {tab.count !== null && <span className="nvu-landscape-tab-count">{tab.count}</span>}
              </button>
            ))}
          </div>
          <div className="nvu-landscape-panel-tools" ref={setToolsSlot} hidden={active !== "queue"} />
        </header>
        {presentation && (
          <div role="tabpanel" id={panelId("queue")} aria-labelledby={tabId("queue")} hidden={active !== "queue"} className="nvu-landscape-panel-body">
            <AutomaticDriverQueue blocked={blocked} variant="tab" toolsSlot={toolsSlot} />
          </div>
        )}
        {routes && (
          <div role="tabpanel" id={panelId("routes")} aria-labelledby={tabId("routes")} hidden={active !== "routes"} className="nvu-landscape-panel-body nvu-landscape-panel-scroll nvu-landscape-panel-routes">
            {routes}
          </div>
        )}
        <div role="tabpanel" id={panelId("trips")} aria-labelledby={tabId("trips")} hidden={active !== "trips"} className="nvu-landscape-panel-body nvu-landscape-panel-scroll">
          {tripsMounted && trips}
        </div>
      </div>
    </section>
  );
}
