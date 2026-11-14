import assert from "node:assert/strict";
import fs from "node:fs";
import { createAdminRejectionClient } from "../src/services/adminRejectionClientCore.ts";

const ok = (ids = {}) => ({
  data: { success: true, status: "rejected", companyId: "company-test", ...ids },
});
let uid = "manager-test";
const calls = [];
const client = createAdminRejectionClient({
  currentUid: () => uid,
  invoke: async (name, payload) => {
    calls.push({ name, payload });
    return name === "rejectDriverRequest"
      ? ok({ requestId: payload.requestId })
      : ok({ applicationId: payload.applicationId });
  },
});

const driverResult = await client.rejectDriverRequestOnServer(" request-1 ");
assert.equal(driverResult.status, "rejected");
assert.deepEqual(calls.pop(), {
  name: "rejectDriverRequest",
  payload: { requestId: "request-1" },
});

const applicationResult = await client.rejectRecruitmentApplicationOnServer(" application-1 ");
assert.equal(applicationResult.status, "rejected");
assert.deepEqual(calls.pop(), {
  name: "rejectRecruitmentApplication",
  payload: { applicationId: "application-1" },
});

let attempts = 0;
let serverCommitted = false;
const timeoutClient = createAdminRejectionClient({
  currentUid: () => uid,
  invoke: async (name, payload) => {
    attempts += 1;
    if (!serverCommitted) {
      // Model a server commit whose response is lost in transit.
      serverCommitted = true;
      throw Object.assign(new Error("injected response timeout"), {
        code: "functions/deadline-exceeded",
      });
    }
    return ok({ requestId: payload.requestId });
  },
});
await assert.rejects(
  timeoutClient.rejectDriverRequestOnServer("request-timeout"),
  (error) => error.code === "functions/deadline-exceeded",
);
assert.equal(attempts, 1, "timeout must surface; do not blindly auto-replay client mutations");
const replayResult = await timeoutClient.rejectDriverRequestOnServer("request-timeout");
assert.equal(replayResult.requestId, "request-timeout");
assert.equal(attempts, 2, "explicit retry uses the same idempotent server command");

let refreshes = 0;
let authCalls = 0;
const authRefreshClient = createAdminRejectionClient({
  currentUid: () => uid,
  refreshCurrentToken: async () => { refreshes += 1; },
  invoke: async (_name, payload) => {
    authCalls += 1;
    if (authCalls === 1) {
      throw Object.assign(new Error("expired token"), { code: "functions/unauthenticated" });
    }
    return ok({ applicationId: payload.applicationId });
  },
});
assert.equal(
  (await authRefreshClient.rejectRecruitmentApplicationOnServer("application-auth")).status,
  "rejected",
);
assert.equal(refreshes, 1);
assert.equal(authCalls, 2);

uid = "";
await assert.rejects(client.rejectDriverRequestOnServer("request-no-auth"), {
  code: "functions/unauthenticated",
});
uid = "manager-test";
assert.throws(() => client.rejectDriverRequestOnServer(""), /requestId é obrigatório/);
assert.throws(() => client.rejectRecruitmentApplicationOnServer(""), /applicationId é obrigatório/);

const appContext = fs.readFileSync("src/context/AppContext.tsx", "utf8");
function bodyBetween(start, end) {
  const begin = appContext.indexOf(start);
  const finish = appContext.indexOf(end, begin + start.length);
  assert.notEqual(begin, -1, `missing ${start}`);
  assert.notEqual(finish, -1, `missing ${end}`);
  return appContext.slice(begin, finish);
}
for (const [body, callable] of [
  [bodyBetween("const rejectRecruitmentApplication = async", "const deleteRecruitmentApplication = async"), "rejectRecruitmentApplicationOnServer(applicationId)"],
  [bodyBetween("const rejectDriver = async", "const switchRole = async"), "rejectDriverRequestOnServer(requestId)"],
]) {
  assert.ok(body.includes(callable), `missing server callable invocation: ${callable}`);
  assert.doesNotMatch(body, /\b(updateDoc|setDoc|addDoc|deleteDoc|getDoc|getDocs|createNotification)\b/, "rejection client handler must not mutate Firestore or send a duplicate notice");
}

console.log("ADMIN_REJECTION_CLIENT_PASS 8");
