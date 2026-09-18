import assert from "node:assert/strict";
import { resolveOperationalRealtimePolicy } from "../src/services/operationalRealtimePolicy.ts";

const scenarios = [
  [
    "signed out",
    { currentUserId: null, foregroundPathname: "/login" },
    { enabled: false, reason: "signed-out" },
  ],
  [
    "profile selector",
    { currentUserId: "uid-1", foregroundPathname: "/select-profile" },
    { enabled: false, reason: "interaction-first" },
  ],
  [
    "pending applications",
    { currentUserId: "uid-1", foregroundPathname: "/pending-applications" },
    { enabled: false, reason: "interaction-first" },
  ],
  [
    "status remains legacy protected surface",
    { currentUserId: "uid-1", foregroundPathname: "/status" },
    { enabled: false, reason: "interaction-first" },
  ],
  [
    "admin workspace",
    { currentUserId: "uid-1", foregroundPathname: "/admin/fleet" },
    { enabled: true, reason: "workspace" },
  ],
  [
    "driver workspace",
    { currentUserId: "uid-1", foregroundPathname: "/driver/profile" },
    { enabled: true, reason: "workspace" },
  ],
];

for (const [label, input, expected] of scenarios) {
  assert.deepEqual(resolveOperationalRealtimePolicy(input), expected, label);
}

console.log(`operational-realtime-policy: PASS ${scenarios.length} scenarios`);
