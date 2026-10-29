import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const controller = read("src/components/common/NvuStatusBarController.tsx");
const app = read("src/App.tsx");
const login = read("src/pages/Login.tsx");
const selectProfile = read("src/pages/SelectProfile.tsx");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const driverProfile = read("src/pages/driver/Profile.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");
const adminLayout = read("src/layouts/AdminLayout.tsx");
const ranking = read("src/pages/RankingGlobal.tsx");
const activity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const androidStyles = read("android/app/src/main/res/values/styles.xml");
const capacitorConfig = read("capacitor.config.ts");
const theme = read("src/hooks/useTheme.ts");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  app.includes('NvuStatusBarController from "./components/common/NvuStatusBarController"'),
  "App não monta o controlador único de status bar",
);
assert(app.includes("<NvuStatusBarController />"), "Controlador não está no shell de rotas");
assert(controller.includes("The NVU theme is the only authority"), "Controlador global não declara autoridade do tema NVU");
assert(controller.includes("const { theme } = useTheme()"), "Controlador não usa o tema do NVU");
assert(controller.includes('location.pathname.replace(/\\/+$/, "")'), "Controlador não normaliza barra final das rotas");
assert(controller.includes("location.key"), "Controlador não reaplica o estilo em retornos/overlays");
assert(controller.includes("const isProfileBannerRoute"), "Exceção de perfil não está centralizada");
assert(controller.includes('normalizedPathname === "/driver/profile"'), "Perfil Driver não está no escopo da exceção");
assert(controller.includes('(normalizedPathname === "/admin/fleet" && (location.state as { activeTab?: string } | null)?.activeTab === "company")'), "Exceção Admin deve exigir a aba company e não alcançar Central, Frota ou outras abas");
const profileRouteMatch = controller.match(/const isProfileBannerRoute =([\s\S]*?);/);
assert(Boolean(profileRouteMatch), "Predicado de banner ausente");
const expression = profileRouteMatch[1].trim().replace('(location.state as { activeTab?: string } | null)', '(location.state)');
const isProfileCoverPage = (pathname, state) => {
  const navigation = state || {};
  if (["/admin/history", "/admin/reports", "/driver/history", "/driver/reports"].includes(pathname)) return true;
  if (pathname === "/driver/profile") return ["activity", "operations", "results", "profile"].includes(String(navigation.profileTab));
  return pathname === "/admin/fleet" && ["company", "history", "reports"].includes(String(navigation.activeTab));
};
const isBanner = new Function('normalizedPathname', 'location', 'isProfileCoverPage', `return ${expression}`);
for (const [route, tab, expected] of [["/admin/fleet",undefined,false],["/admin/fleet","operations",false],["/admin/fleet","fleet",false],["/admin/fleet","hr",false],["/admin/fleet","history",false],["/admin/fleet","company",true],["/driver/profile",undefined,true],["/ranking",undefined,false],["/driver/trip",undefined,false]]) {
  assert(isBanner(route,{state:tab?{activeTab:tab}:null},isProfileCoverPage)===expected, `Escopo incorreto do banner: ${route}/${tab}`);
}
assert(controller.includes("data-nvu-hero-chrome"), "Controlador não observa a transição do cabeçalho de perfil");
assert(controller.includes("MutationObserver"), "Transição do cabeçalho não é observada após a rolagem");
assert(controller.includes("profileChromeSettled"), "Estado settled do banner não chega ao controlador");
assert(controller.includes('isProfileBannerRoute && !profileChromeSettled'), "A regra de ícones sobre o banner não está restrita ao estado active");
assert(controller.includes("? SystemBarsStyle.Dark"), "Ícones brancos do banner não estão configurados");
assert(controller.includes('theme === "dark"'), "Tema escuro NVU não está mapeado");
assert(controller.includes(": SystemBarsStyle.Light"), "Tema claro NVU não está mapeado");
assert(!controller.includes("prefers-color-scheme"), "Controlador consulta o tema do sistema");
assert(!controller.includes("isSystemInDarkTheme"), "Controlador usa API de tema Android");
assert(!login.includes("SystemBars"), "Login criou uma regra concorrente de status bar");
assert(!selectProfile.includes("SystemBars"), "SelectProfile manteve regra duplicada de status bar");
assert(!recordTrip.includes("SystemBars"), "RecordTrip manteve regra duplicada de status bar");
assert(!driverProfile.includes("SystemBars"), "Driver Profile ainda escreve a barra de status");
assert(!driverLayout.includes("SystemBars"), "DriverLayout ainda escreve a barra de status");
assert(!adminLayout.includes("SystemBars"), "AdminLayout ainda escreve a barra de status");
assert(!ranking.includes("SystemBars"), "RankingGlobal ainda escreve a barra de status");
assert(!driverLayout.includes("nvu-ranking-closed"), "DriverLayout ainda restaura status bar por evento concorrente");
assert(!adminLayout.includes("nvu-ranking-closed"), "AdminLayout ainda restaura status bar por evento concorrente");
assert(!ranking.includes("nvu-ranking-closed"), "RankingGlobal ainda dispara evento concorrente");
assert(theme.includes("frotalog-theme"), "Tema persistido do NVU não está sendo usado");
assert(theme.includes("NVU_THEME_CHANGE_EVENT"), "Troca de tema não é propagada ao controlador");
assert(activity.includes("setAppearanceLightStatusBars(true)"), "Padrão nativo inicial não é o tema claro do NVU");
assert(!activity.includes("setAppearanceLightStatusBars(false)"), "Activity força ícones brancos independente do NVU");
assert(capacitorConfig.includes('SystemBars: { style: "LIGHT" }'), "Capacitor SystemBars ainda inicia pelo tema do Android");
assert((androidStyles.match(/android:windowLightStatusBar">true/g) || []).length >= 2, "Temas Android de lançamento não garantem ícones escuros");
assert(!androidStyles.includes('android:windowLightStatusBar">false'), "Tema Android ainda força ícones brancos");
assert((androidStyles.match(/android:windowLightNavigationBar">true/g) || []).length >= 2, "Tema Android de lançamento não garante navegação clara");

assert(driverLayout.includes('data-nvu-hero-chrome={isDriverHeroRoute ? (heroChromeActive ? "active" : "settled") : undefined}'), "DriverLayout não expõe o estado da transição do banner");
assert(adminLayout.includes('data-nvu-hero-chrome={isCompanyProfileRoute ? (heroChromeActive ? "active" : "settled") : undefined}'), "AdminLayout deve expor o estado do banner somente no perfil da empresa, sem alcançar a Central de gestão");

console.log("PASS: status bar segue tema NVU; perfis alternam branco/dark somente após a transição do banner");
