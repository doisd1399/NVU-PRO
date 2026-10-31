import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

// Android status-bar icon colour on the company profile page. "Dark" style = white icons, "Light" style = dark icons.
const root = process.cwd(), errors: string[] = [], checks: string[] = [];
const fakeCapacitor = `
export const SystemBarsStyle = { Dark: "DARK", Light: "LIGHT" };
export const SystemBarType = { StatusBar: "StatusBar", NavigationBar: "NavigationBar" };
window.__bars = window.__bars || [];
export const SystemBars = { setStyle: async (options) => { window.__bars.push(options); } };
export const Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };`;
const server = await createServer({ configFile: false, root, plugins: [{ name: "fake-native", enforce: "pre",
  resolveId(source) { if (source === "@capacitor/core") return "\0fake-capacitor"; },
  load(id) {
    if (id === "\0fake-capacitor") return fakeCapacitor;
    if (id.split("?")[0] === path.join(root, "src/lib/gtoObserver.ts")) return "export const isNativeAndroid = () => true;";
  } }, react()], server: { host: "127.0.0.1", port: 4193, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on("pageerror", error => errors.push(error.message));
const url = (route: string) => `http://127.0.0.1:4193/scripts/fixtures/status-bar.html?route=${route}`;
const statusIcons = () => page.evaluate(() => { const rows = (window as any).__bars.filter((row: any) => row.bar === "StatusBar"); return rows.at(-1)?.style as string | undefined; });
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)))));
const place = async (heroTop: number, marker: "active" | "settled") => {
  await page.evaluate(([top, state]) => { document.getElementById("hero")!.style.top = `${top}px`; document.getElementById("hdr")!.dataset.nvuHeroChrome = state as string; window.dispatchEvent(new Event("scroll")); }, [heroTop, marker]);
  await settle();
};
const theme = async (value: "light" | "dark") => { await page.evaluate(v => (window as any).qaSetTheme(v), value); await settle(); };
try {
  await page.route("**/*", route => /^http:\/\/127\.0\.0\.1:4193\//.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto(url("company")); await settle();

  // Light theme, top of the company profile page: the banner starts BELOW the app bar, the status bar sits on the light page.
  await theme("light"); await place(90, "active");
  assert.equal(await statusIcons(), "LIGHT", "light theme, banner below the app bar: dark icons (like the Ranking page)");
  checks.push("light theme, page top (banner below the bar) -> dark icons");

  // The banner image really under the status bar: white icons stay (they sit on a photo).
  await place(0, "active");
  assert.equal(await statusIcons(), "DARK", "banner under the status bar: white icons");
  checks.push("banner image under the status bar -> white icons");

  // Back below it, or settled after scrolling: dark icons again in the light theme.
  await place(90, "active");
  assert.equal(await statusIcons(), "LIGHT");
  await place(-220, "settled");
  assert.equal(await statusIcons(), "LIGHT", "settled header on the light surface: dark icons");
  checks.push("scrolled / settled in light theme -> dark icons");

  // Dark theme always uses white icons.
  await theme("dark"); await place(90, "active");
  assert.equal(await statusIcons(), "DARK", "dark theme, page top");
  await place(-220, "settled");
  assert.equal(await statusIcons(), "DARK", "dark theme, settled");
  checks.push("dark theme -> white icons");

  // Other routes follow the theme only.
  await page.goto(url("ranking")); await settle();
  await theme("light"); assert.equal(await statusIcons(), "LIGHT");
  await theme("dark"); assert.equal(await statusIcons(), "DARK");
  checks.push("other routes follow the theme");

  // Switching the theme with the page open updates the icons.
  await page.goto(url("company")); await settle();
  await theme("light"); await place(90, "active"); assert.equal(await statusIcons(), "LIGHT");
  await theme("dark"); assert.equal(await statusIcons(), "DARK");
  await theme("light"); assert.equal(await statusIcons(), "LIGHT");
  checks.push("theme switch with the page open");

  // The driver's "Operação atual": the photo is full bleed under the status bar in the light theme, even when it mounts late.
  await page.goto(url("dashboard") + "&late=1"); 
  await theme("light");
  assert.equal(await statusIcons(), "DARK", "before the banner exists the icons stay white (never dark on a late photo)");
  await page.waitForSelector("#hero"); await settle(); await page.waitForTimeout(250); await settle();
  assert.equal(await statusIcons(), "DARK", "light theme, full-bleed photo under the status bar: white icons");
  await place(-8, "active");
  assert.equal(await statusIcons(), "DARK");
  await place(-260, "settled");
  assert.equal(await statusIcons(), "LIGHT", "scrolled past the photo in the light theme: dark icons");
  await place(-8, "active");
  assert.equal(await statusIcons(), "DARK", "back on the photo: white icons");
  checks.push("driver 'Operação atual' (photo under the status bar, late mount) -> white icons; scrolled -> dark");
  await page.goto(url("dashboard"));
  await theme("light"); await settle(); assert.equal(await statusIcons(), "DARK", "banner present from the first render");
  checks.push("driver dashboard, banner present at start -> white icons");

  assert.deepEqual(errors, []);
  console.log("STATUS_BAR_UI_PASS", checks.length);
} finally { await browser.close(); await server.close(); }
