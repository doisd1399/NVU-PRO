import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const bridge = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const runtime = read("src/lib/gtoRuntimeRevision.ts");

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const revision = String(pkg.gtoWebRuntimeRevision || "");
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || ["", "0"])[1]);

check("operation_context_store_is_separate", sync.includes('OPERATION_CONTEXT_PREFS = "nvu_gto_operation_context_v1"') && sync.includes('OPERATION_CONTEXT_KEY = "current"'));
check("operation_context_persist_copies_full_context", sync.includes("persistOperationContextSnapshot") && sync.includes("copyContextFromPrefs(snapshot, prefs)") && sync.includes('putString(OPERATION_CONTEXT_KEY, snapshot.toString())'));
check("operation_context_requires_current_job", sync.includes("GtoOperationCardPolicy.isUsableForActive(dedicated, active)") && sync.includes("operationContextFromPrefs(prefs)"));
check("bridge_persists_before_session_snapshot", bridge.includes("GtoAutoTripSync.persistOperationContextSnapshot(context, prefs)") && bridge.indexOf("persistOperationContextSnapshot(context, prefs)") < bridge.indexOf("ensureCurrentOperationSnapshot(context, prefs)"));
check("open_gto_persists_before_start", bridge.includes("GtoAutoTripSync.persistOperationContextSnapshot(context, prefs)") && bridge.includes("context.startActivity(launchIntent);") && bridge.lastIndexOf("persistOperationContextSnapshot(context, prefs)") < bridge.indexOf("context.startActivity(launchIntent);"));
check("running_card_refresh_persists_context", service.includes("GtoAutoTripSync.persistOperationContextSnapshot(live, live.prefs);") && service.includes("GtoAutoTripSync.ensureCurrentOperationSnapshot(live, live.prefs);"));
check("summary_reads_dedicated_context_first", service.includes("GtoAutoTripSync.resolveOperationContextSnapshot(this, prefs)") && sync.indexOf("AUTH_DEDICATED.equals") < sync.indexOf("AUTH_LIVE.equals") && sync.indexOf("AUTH_LIVE.equals") < sync.indexOf("AUTH_SESSION.equals"));
check("summary_does_not_query_firebase", service.includes("Queue diagnostics are local-only") && !service.includes("GtoFirebaseRuntime.currentUser(this)"));
check("card_body_is_single_measured_view", service.includes('operationSummary.setText("Operação atual\\n" + operationSummaryValue);') && service.includes("operationSummary.setVisibility(View.VISIBLE);") && service.includes("operationSummary.setMinHeight(dp(150));"));
check("card_body_has_no_legacy_split_title", !service.includes('operationTitle.setText("Operação atual");'));
check("menu_remeasures_after_mode_change", service.includes("menuParams.height = WindowManager.LayoutParams.WRAP_CONTENT;") && service.includes("menuContentView.requestLayout();") && service.includes("windowManager.updateViewLayout(menuView, menuParams);"));
check("runtime_identity_is_new", /^R3\.34-PC-HF\d+$/.test(revision) && Number((revision.match(/HF(\d+)/) || ["", "0"])[1]) >= 157 && runtime.includes(revision));
check("android_identity_is_new", versionCode >= 234 && /versionName\s+"1\.0\.(23[4-9]|2[4-9]\d|[3-9]\d\d)"/.test(gradle));
check("release_chain_contains_hf157", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf157-operation-card-snapshot"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF157 operation-card checks passed.`);
if (failed.length) process.exit(1);

como();

function como() {
  // Keep this gate intentionally deterministic and source-based; device rendering is
  // reported separately and is never inferred from these assertions.
}

