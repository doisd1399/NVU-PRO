import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = (file) => fs.readFileSync(file, "utf8");
const root = process.cwd();
const javaRoot = path.join(root, "android/app/src/main/java/com/nvu/operacional");
const policyPath = path.join(javaRoot, "GtoOperationCardPolicy.java");
const fixturePath = path.join(root, "scripts/java-tests/com/nvu/operacional/GtoHf158OperationCardPolicyTest.java");
const sync = read(path.join(javaRoot, "GtoAutoTripSync.java"));
const plugin = read(path.join(javaRoot, "GtoObserverPlugin.java"));
const service = read(path.join(javaRoot, "GtoObserverService.java"));
const observerTs = read(path.join(root, "src/lib/gtoObserver.ts"));
const launcher = read(path.join(root, "src/services/gtoWorkLauncher.ts"));
const dashboard = read(path.join(root, "src/pages/driver/Dashboard.tsx"));
const profile = read(path.join(root, "src/pages/driver/Profile.tsx"));
const recordTrip = read(path.join(root, "src/pages/driver/RecordTrip.tsx"));
const pkg = JSON.parse(read(path.join(root, "package.json")));
const gradle = read(path.join(root, "android/app/build.gradle"));
const runtime = read(path.join(root, "src/lib/gtoRuntimeRevision.ts"));

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const section = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, Math.max(0, a + start.length));
  return a >= 0 && b > a ? source.slice(a, b) : "";
};
const contextFields = [
  "driverId", "companyId", "jobId", "contractId", "contractName", "operationName",
  "jobStatus", "jobProgress", "jobTotalDeliveries", "vehicleName", "trailerName",
];

check("production policy exists", fs.existsSync(policyPath));
check("functional fixture exists", fs.existsSync(fixturePath));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf158-"));
let result = spawnSync("javac", ["-encoding", "UTF-8", "-d", tmp, policyPath, fixturePath], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
check("operation policy compiles", result.status === 0);
if (result.status === 0) {
  result = spawnSync("java", ["-cp", tmp, "com.nvu.operacional.GtoHf158OperationCardPolicyTest"], { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  check("operation policy scenarios pass", result.status === 0 && result.stdout.includes("PASS"));
} else {
  check("operation policy scenarios pass", false);
}
fs.rmSync(tmp, { recursive: true, force: true });

check("dedicated snapshot commit is checked", sync.includes("static boolean persistOperationContextSnapshot") && sync.includes('"COMMIT_FAILED"') && plugin.includes("if (!GtoAutoTripSync.persistOperationContextSnapshot(context, prefs))"));
check("dedicated snapshot validates full active identity", sync.includes("GtoOperationCardPolicy.isUsableForActive(dedicated, active)") && sync.includes("driverId") && sync.includes("companyId") && sync.includes("contractId"));
check("dedicated snapshot validates current revision", sync.includes("GtoOperationCardPolicy.revisionMatches(dedicated, active)"));
check("resolver order is dedicated then live then session", sync.indexOf("AUTH_DEDICATED.equals") < sync.indexOf("AUTH_LIVE.equals") && sync.indexOf("AUTH_LIVE.equals") < sync.indexOf("AUTH_SESSION.equals"));
check("summary and status use the same resolver", service.includes("GtoAutoTripSync.resolveOperationContextSnapshot(this, prefs)") && plugin.includes("GtoAutoTripSync.resolveOperationContextSnapshot(context, prefs)"));
check("production summary uses tested formatter", service.includes("GtoAutoTripSync.renderOperationSummary(operationSnapshot)"));
check("logout clears dedicated operation context", plugin.includes("GtoAutoTripSync.clearOperationContextSnapshot(context)") && sync.includes("static boolean clearOperationContextSnapshot"));

const populate = section(service, "private void populateMenuContents", "private String menuRenderSignature");
const expandedIndex = populate.indexOf("if (operationSummaryExpanded)");
const titleIndex = populate.indexOf("TextView title = new TextView(this)");
check("expanded operation branches before freight title", expandedIndex >= 0 && titleIndex > expandedIndex);
check("expanded operation renders summary before return button", populate.indexOf("addOperationSummaryView(target)") < populate.indexOf('menuButton("Voltar ao frete atual")'));
check("expanded operation resets scroll to top", populate.includes("menuScrollView.scrollTo(0, 0)"));
check("summary view is visible and unbounded", service.includes("operationSummary.setVisibility(View.VISIBLE)") && service.includes("operationSummary.setMaxLines(Integer.MAX_VALUE)") && service.includes("operationSummary.setEllipsize(null)"));
check("summary view records rendered authority and job", service.includes('putString("operationCardRenderedAuthority"') && service.includes('putString("operationCardRenderedJobId"'));
check("window is remeasured after mode change", service.includes("menuParams.height = WindowManager.LayoutParams.WRAP_CONTENT") && service.includes("menuContentView.requestLayout()") && service.includes("windowManager.updateViewLayout(menuView, menuParams)"));

check("web context type exposes all required fields", contextFields.every((field) => observerTs.includes(`${field}?:`)));
check("launcher writes context before and after observer start", (launcher.match(/GtoObserver\.setContext\(runtimeContext\)/g) || []).length >= 2 && launcher.indexOf("setContext(runtimeContext)") < launcher.indexOf("openGto()"));
for (const [name, source] of [["dashboard", dashboard], ["profile", profile], ["record_trip", recordTrip]]) {
  check(`${name} launch carries complete operation fields`, contextFields.every((field) => source.includes(`${field}:`)));
}

const summarySection = section(service, "private String buildOperationSummaryText()", "private Button menuButton");
check("card rendering does not depend on Firebase", !summarySection.includes("GtoFirebaseRuntime") && !summarySection.includes("FirebaseAuth") && !summarySection.includes("FirebaseFunctions") && !summarySection.includes("getHttpsCallable(") && !summarySection.includes("currentUser("));
check("company name is never operation fallback", !summarySection.includes('getString("companyName"') && !read(policyPath).includes("companyName"));

const revision = String(pkg.gtoWebRuntimeRevision || "");
const revisionNumber = Number((revision.match(/HF(\d+)$/) || ["", "0"])[1]);
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || ["", "0"])[1]);
const versionPatch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || ["", "0"])[1]);
check("HF158+ runtime identity", revisionNumber >= 158 && runtime.includes(revision));
check("Android 1.0.235+ identity", versionCode >= 235 && versionPatch >= 235);
check("HF158 gate is mandatory", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf158-operation-card-end-to-end"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF158 operation-card checks passed.`);
if (failed.length) process.exit(1);
