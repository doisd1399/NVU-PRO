/** Retry a failed startup step without duplicating services already installed. */
export function createRuntimeStartup(steps: readonly (() => void)[]) {
  let completed = 0;
  return () => {
    while (completed < steps.length) {
      steps[completed]();
      completed += 1;
    }
  };
}
