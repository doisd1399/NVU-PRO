import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const review = read("android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java");
const repo = read("src/repositories/TripsRepository.ts");
const moderation = read("src/services/tripModerationService.ts");
const historyHook = read("src/hooks/useTripHistory.ts");
const driverHook = read("src/hooks/useDriverTrips.ts");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const runtime = read("src/lib/gtoRuntimeRevision.ts");
const pkg = JSON.parse(read("package.json"));
const gradle = read("android/app/build.gradle");
const metadata = JSON.parse(read("NVU_RELEASE_METADATA.json"));

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const activeVersionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const activeVersionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
check("HF154 runtime revision is current", /^R3\.34-PC-HF\d+$/.test(pkg.gtoWebRuntimeRevision) && runtime.includes(pkg.gtoWebRuntimeRevision) && metadata.webRuntimeRevision === pkg.gtoWebRuntimeRevision && plugin.includes(pkg.gtoWebRuntimeRevision));
check("HF154 Android identity is above 1.0.230", activeVersionCode > 230 && activeVersionName === `1.0.${activeVersionCode}`);
check("Origin has its own review field", review.includes('static final String ORIGIN = "ORIGIN"') && review.includes("if (!isOperationalTextUsable(origin)) return ORIGIN;"));
check("Retry reads origin from origin, not originCompany", service.includes("resolveFreightFieldAfterRetry(resolved, GtoFreightReviewPolicy.ORIGIN,") && service.includes("exact == null ? \"\" : exact.origin") && service.includes("retry == null ? \"\" : retry.origin"));
check("Origin-company retry cannot overwrite origin", service.includes("} else if (GtoFreightReviewPolicy.ORIGIN_COMPANY.equals(field)) {") && !service.includes("target.originCompany = value;\n            target.origin = value;"));
check("Origin sample stays literal", !service.includes('replace("o", "c")') && !service.includes("Metalurgioa"));
check("Certified freight remains the sync source", sync.includes("GtoCertifiedFreight") && sync.includes("restoreLockedFreightToPrefs") && sync.includes("buildPayload"));
check("Snapshot is ensured before card refresh", plugin.includes("GtoAutoTripSync.ensureCurrentOperationSnapshot(context, prefs)") && service.includes("GtoAutoTripSync.ensureCurrentOperationSnapshot(live, live.prefs)"));
check("Operation card refresh is identity-local", service.includes("public static void refreshOperationCardIfRunning()") && service.includes("if (live.menuView != null) live.refreshMenuContents();"));
check("Repository has persistent deletion tombstone", repo.includes("DELETED_TRIP_PREFIX") && repo.includes("rememberDeletedTrip") && repo.includes("filterDeletedTrips"));
check("All repository merges filter deleted IDs", (repo.match(/filterDeletedTrips\(mergeTripSources\(canonicalTrips, legacyTrips\)\)/g) || []).length === 3 && repo.includes("return filterDeletedTrips(Array.from(merged.values()));"));
check("Simple deletion marks tombstone only after server delete", repo.includes("const result = await deleteDoc") && repo.includes("TripsRepository.markTripDeleted(tripId)") && repo.indexOf("const result = await deleteDoc") < repo.indexOf("TripsRepository.markTripDeleted(tripId)"));
check("Moderated deletion uses the same authority", moderation.includes("TripsRepository.markTripDeleted(input.tripId)") && moderation.includes('from "../repositories/TripsRepository"'));
check("History hook subscribes to confirmed deletion", historyHook.includes("TripsRepository.onTripDeleted") && historyHook.includes("writePersistedTrips(entry.companyId, visibleTrips)"));
check("Driver hook subscribes to confirmed deletion", driverHook.includes("TripsRepository.onTripDeleted") && driverHook.includes("writePersistedTrips(entry.driverId, visibleTrips)"));
check("Release gate includes HF154", String(pkg.scripts?.["verify:release"] || "").includes("test:gto-r3.34-hf154-gto-stability"));

const failed = checks.filter(({ ok }) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF154 stability checks passed.`);
if (failed.length) process.exit(1);
