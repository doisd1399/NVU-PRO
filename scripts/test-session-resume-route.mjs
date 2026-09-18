import assert from "node:assert/strict";
import fs from "node:fs";
import { canResumeRoute } from "../src/lib/sessionResumeRoute.ts";

assert.equal(canResumeRoute("/admin/fleet"), true);
assert.equal(canResumeRoute("/driver/profile"), true);
assert.equal(canResumeRoute("/select-profile"), true);
assert.equal(canResumeRoute("/login"), false);
assert.equal(canResumeRoute("/"), false);
assert.equal(canResumeRoute("https://evil.example"), false);
assert.equal(canResumeRoute("//evil.example"), false);

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const runtime = fs.readFileSync(
  new URL("../src/lib/webRuntimeRecovery.ts", import.meta.url),
  "utf8",
);
const login = fs.readFileSync(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");

assert.match(app, /SessionRouteMemory/);
assert.doesNotMatch(app, /isInitialWorkspaceRoute/);
assert.ok(!app.includes('navigate("/", {'));
assert.doesNotMatch(app, /Normalize an initial/);
assert.match(app, /direct refresh\/deep link keeps its explicit URL/);
assert.match(app, /writeSessionResumeRoute\(/);
assert.match(runtime, /nvu\.ranking\.snapshot\./);
assert.doesNotMatch(runtime, /key === "activeCompanyId"/);
assert.doesNotMatch(runtime, /key\.startsWith\("nvu\.session\."\)/);
assert.match(login, /navigate\("\/select-profile", \{ replace: true \}\)/);

console.log("session-resume-route: PASS route-preservation and source checks");
