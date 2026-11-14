import React, { useId, useMemo, useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import type { NormalizedTrip } from "../../lib/tripNormalizer";
import { DriverResults } from "./DriverResults";

/**
 * "Resultados" inside the profile summary (driver or company): the same weekly/monthly figures and daily list as the
 * driver's Resultados page, in a collapsible card with its own scroll. It stays closed (and unmounted) until opened.
 */
export function ProfileResultsCard({ getTrips, loading }: { getTrips: () => NormalizedTrip[]; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const trips = useMemo(() => open ? getTrips() : [], [open, getTrips]);
  const bodyId = useId();
  return <section className="nvu-profile-history nvu-profile-driver-results" data-nvu-profile-results>
    <button type="button" className="nvu-profile-history-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
      <BarChart3 size={19} aria-hidden="true" />
      <h3>Resultados</h3>
      <ChevronDown size={17} aria-hidden="true" />
    </button>
    {open && <div id={bodyId} className="nvu-profile-history-content">
      <div className="nvu-profile-results-scroll" role="region" aria-label="Resultados do motorista" tabIndex={0}>
        <DriverResults trips={trips} loading={loading} />
      </div>
    </div>}
  </section>;
}
