/**
 * Small, framework-independent lifecycle bridge for auth teardown.
 *
 * Firebase listeners owned by pages/hooks cannot all be registered in
 * AppContext.  The bridge lets those listeners stop before signOut() revokes
 * the credentials, while keeping the operation safe in React StrictMode and
 * in a Capacitor WebView.
 */
export const AUTH_TEARDOWN_EVENT = "nvu-auth-teardown";

let teardownActive = false;
let teardownGeneration = 0;

export function beginAuthTeardown() {
  teardownActive = true;
  teardownGeneration += 1;

  if (typeof window !== "undefined") {
    try {
      const event =
        typeof CustomEvent === "function"
          ? new CustomEvent(AUTH_TEARDOWN_EVENT, {
              detail: { generation: teardownGeneration },
            })
          : Object.assign(new Event(AUTH_TEARDOWN_EVENT), {
              detail: { generation: teardownGeneration },
            });
      window.dispatchEvent(event);
    } catch {
      // The flag remains active even if an older WebView cannot dispatch the
      // optional DOM event; every guarded operation still observes it.
    }
  }

  return teardownGeneration;
}

export function endAuthTeardown() {
  teardownActive = false;
}

export function isAuthTeardownActive() {
  return teardownActive;
}

export function getAuthTeardownGeneration() {
  return teardownGeneration;
}

export function onAuthTeardown(listener: (generation: number) => void) {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ generation?: number }>).detail;
    listener(detail?.generation ?? teardownGeneration);
  };

  window.addEventListener(AUTH_TEARDOWN_EVENT, handler);
  return () => window.removeEventListener(AUTH_TEARDOWN_EVENT, handler);
}
