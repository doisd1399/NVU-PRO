type Timer = number;
type Ports = {
  isCurrent: () => boolean;
  canRefresh: () => boolean;
  refresh: () => Promise<void>;
  schedule?: (callback: () => void, milliseconds: number) => Timer;
  cancel?: (timer: Timer) => void;
};

/** Read-only fallback when a canonical member lacks the older signal projection. */
export function createQueueSignalFallback(ports: Ports) {
  const schedule = ports.schedule || ((callback: () => void, milliseconds: number) => window.setTimeout(callback, milliseconds));
  const cancel = ports.cancel || ((id: Timer) => window.clearTimeout(id));
  let timer: Timer | undefined;
  let generation = 0;
  let active = false;
  function stop() {
    active = false;
    generation += 1;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }
  function arm(token: number) {
    if (!active || token !== generation || !ports.isCurrent()) return;
    timer = schedule(() => { void tick(token); }, 30_000);
  }
  async function tick(token: number) {
    timer = undefined;
    if (!active || token !== generation || !ports.isCurrent()) return;
    try {
      if (ports.canRefresh()) await ports.refresh();
    } catch {
      // The existing refresh owns the UI error. A read failure must not leave
      // an unhandled timer promise or reactivate an obsolete session.
    } finally {
      arm(token);
    }
  }
  function start() {
    if (active || !ports.isCurrent()) return;
    active = true;
    arm(++generation);
  }
  return { start, stop };
}
