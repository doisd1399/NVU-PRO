import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const selectProfile = fs.readFileSync(
  new URL("../src/pages/SelectProfile.tsx", import.meta.url),
  "utf8",
);
const statusController = fs.readFileSync(
  new URL("../src/components/common/NvuStatusBarController.tsx", import.meta.url),
  "utf8",
);
const mainActivity = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/com/nvu/operacional/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);

assert.match(app, /Capacitor\.isNativePlatform\(\)/);
assert.match(app, /initialSessionSelectorRedirectRef/);
assert.match(app, /profileIndex\.status === "resolving"/);
assert.match(
  app,
  /location\.pathname !== "\/"\s*&&\s*location\.pathname !== "\/login"/,
);
assert.ok(
  app.includes('Capacitor.isNativePlatform()') &&
    app.includes('nvuNativeSessionResume: true'),
);
assert.ok(
  app.includes('initialSessionSelectorRedirectRef') &&
    app.includes('const targetPath =') &&
    app.includes("nvuNativeSessionResume: true"),
);
assert.match(app, /pathname === "\/select-profile"/);
assert.match(
  app,
  /profileIndex\.profiles\.length === 1[\s\S]*?profileIndex\.profiles\[0\]\.destination/,
);
assert.match(selectProfile, /resolveProfileSessionGate/);
assert.match(
  selectProfile,
  /strict sessionReady flag backed by Firebase/s,
);
assert.match(selectProfile, /profileGateState === "diagnostic"/);
assert.match(selectProfile, /const commitProfileNavigation = useCallback/);
assert.match(statusController, /useLayoutEffect\(\(\) => \{/);
assert.match(statusController, /SystemBarsStyle\.Light/);
assert.match(statusController, /SystemBarsStyle\.Dark/);
assert.match(statusController, /SystemBarType\.StatusBar/);
assert.match(selectProfile, /void switchRole\(profile\.role, profile\.companyId\)/);
assert.match(mainActivity, /extends BridgeActivity/);
assert.match(mainActivity, /onResume\(\)/);

console.log("native-session-selector-startup: PASS 10 checks");
console.log(
  "Uma identidade retorna ao perfil ativo; múltiplos perfis abrem o seletor sob sessionReady.",
);
