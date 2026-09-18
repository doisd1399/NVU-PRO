import fs from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(`${root}/${relative}`, "utf8");
const checks = [];
const check = (name, condition, detail = "") => {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const resolver = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const policyTest = read("scripts/java-tests/com/nvu/operacional/GtoCityTextResolverTest.java");
const cityTestSources = [
  "android/app/src/main/java/com/nvu/operacional/GtoFreightTextGuard.java",
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "scripts/java-tests/com/nvu/operacional/GtoCityTextResolverTest.java",
];

check(
  "composite city canonicalizer exists",
  resolver.includes("canonicalizeDestinationWithCompany") &&
    resolver.includes("uniqueOfficialCanonicalCandidate") &&
    resolver.includes("destinationCompany")
);
check(
  "Itapetuna is the approved canonical spelling",
  resolver.includes('"Itapetuna"')
);
check(
  "direct selected-row path calls the composite canonicalizer",
  service.includes("canonicalizeOfficialSelectedDestination(selected, stableSamePage)") &&
    service.includes("canonicalizeSelectedListDestinationSpelling")
);
check(
  "corrected destination refreshes accepted-list authority",
  service.includes("exact.acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination") &&
    service.includes("stable.acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination")
);
check(
  "retry corrected destination refreshes accepted-list authority",
  service.includes("resolved.acceptedListDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination")
);
check(
  "commit protects the authority before recomposition",
  service.includes("if (!selected.pauseMenuEvidence && selected.destinationSelectedRowEvidence)") &&
    service.includes("canonicalizeSelectedListDestinationSpelling(selected);")
);
check(
  "Pause is explicitly excluded from the direct-list helper",
  service.includes("if (option == null || option.pauseMenuEvidence) return false;")
);
check(
  "literal OCR advisory contract remains unchanged",
  !service.includes("option.destination = destinationResolution.value") &&
    policyTest.includes("known/expected destinations are advisory only")
);
check(
  "unknown/ambiguous city remains fail-closed",
  resolver.includes("if (canonicalSuffix.isEmpty()) return \"\";") &&
    policyTest.includes("unknown or non-unique city spelling")
);

const out = "/tmp/nvu-hf131-city-test";
fs.rmSync(out, { recursive: true, force: true });
const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", out, ...cityTestSources], {
  cwd: root,
  encoding: "utf8",
});
check("HF131 Java city proof compiles", compile.status === 0, (compile.stderr || compile.stdout || "").trim());
if (compile.status === 0) {
  const run = spawnSync("java", ["-cp", out, "com.nvu.operacional.GtoCityTextResolverTest"], {
    cwd: root,
    encoding: "utf8",
  });
  check("HF131 Itapetuna composite behavior passes", run.status === 0, (run.stderr || run.stdout || "").trim());
}

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF131 direct-list Itapetuna checks passed.`);
if (passed !== checks.length) process.exit(1);
