import React from "react";
import { getOperationalSuspension } from "../lib/driverSuspension";

export function useOperationalSuspension(
  user: Record<string, any> | null | undefined,
) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const suspension = React.useMemo(
    () => getOperationalSuspension(user, nowMs),
    [user, nowMs],
  );

  React.useEffect(() => {
    if (!suspension.active) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [suspension.active, suspension.endsAt?.getTime()]);

  return { suspension, nowMs };
}
