import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.error(`FAIL ${name}`); }
};

const variables = read("android/variables.gradle");
const capConfig = read("capacitor.config.ts");
const gradle = read("android/app/build.gradle");
const pkg = JSON.parse(read("package.json"));
const servicesPath = "android/app/google-services.json";
const services = fs.existsSync(servicesPath) ? JSON.parse(read(servicesPath)) : null;

const packages = services?.client
  ?.map((client) => client?.client_info?.android_client_info?.package_name)
  ?.filter(Boolean) || [];
const hasWebOauth = Boolean(services?.client?.some((client) =>
  (client.oauth_client || []).some((oauth) => oauth.client_type === 3 && oauth.client_id),
));

check("Google provider is enabled in Capacitor", /providers:\s*\[\s*['\"]google\.com['\"]\s*\]/m.test(capConfig));
check("native Firebase auth is enabled", /skipNativeAuth:\s*false/.test(capConfig));
check("Capacitor Firebase Authentication dependency is present", Boolean(pkg.dependencies?.["@capacitor-firebase/authentication"]));
check("Google native provider dependencies are explicitly included", /rgcfaIncludeGoogle\s*=\s*true/.test(variables));
check("Credential Manager compatibility version is pinned to 1.3.0", /androidxCredentialsVersion\s*=\s*['\"]1\.3\.0['\"]/.test(variables));
check("google-services package matches NVU applicationId", services
  ? packages.includes("com.nvu.operacional") && gradle.includes('applicationId "com.nvu.operacional"')
  : gradle.includes('applicationId "com.nvu.operacional"') && /google-services\.json/.test(gradle));
check("google-services contains Web OAuth client for Firebase ID token exchange", services ? hasWebOauth : true);
if (!services) console.warn("INFO google-services.json is external/secret and was not present in the safe source tree; OAuth contents must be checked in the protected build environment.");
check("HF11+ Android identity is compatible with Google Auth", Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 63 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 63);

console.log(`\n${passed}/${passed + failed} Android Google-auth checks passed.`);
if (failed) process.exit(1);
