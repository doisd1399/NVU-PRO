import assert from "node:assert/strict";
import { projectAuthSession } from "../src/services/authSessionProjection.ts";

const scenarios = [
  {
    name: "identity coherent, server pending",
    input: {
      authInitialized: true,
      firebaseSessionUid: "uid-1",
      currentUserId: "uid-1",
      sessionRecovering: true,
      membershipsLoaded: false,
    },
    expected: { sessionUiReady: true, sessionAuthorized: false },
  },
  {
    name: "identity coherent, authorized",
    input: {
      authInitialized: true,
      firebaseSessionUid: "uid-1",
      currentUserId: "uid-1",
      sessionRecovering: false,
      membershipsLoaded: true,
    },
    expected: { sessionUiReady: true, sessionAuthorized: true },
  },
  {
    name: "authorized snapshot remains available during background recovery",
    input: {
      authInitialized: true,
      firebaseSessionUid: "uid-1",
      currentUserId: "uid-1",
      sessionRecovering: true,
      membershipsLoaded: true,
    },
    expected: { sessionUiReady: true, sessionAuthorized: true },
  },
  {
    name: "different user cannot become UI-ready",
    input: {
      authInitialized: true,
      firebaseSessionUid: "uid-1",
      currentUserId: "uid-2",
      sessionRecovering: false,
      membershipsLoaded: true,
    },
    expected: { sessionUiReady: false, sessionAuthorized: false },
  },
  {
    name: "auth not initialized",
    input: {
      authInitialized: false,
      firebaseSessionUid: "uid-1",
      currentUserId: "uid-1",
      sessionRecovering: false,
      membershipsLoaded: true,
    },
    expected: { sessionUiReady: false, sessionAuthorized: false },
  },
  {
    name: "UID-scoped visual snapshot before Firebase settles",
    input: {
      authInitialized: false,
      firebaseSessionUid: null,
      currentUserId: "uid-1",
      visualIdentityReady: true,
      sessionRecovering: true,
      membershipsLoaded: false,
    },
    expected: { sessionUiReady: true, sessionAuthorized: false },
  },
];

for (const scenario of scenarios) {
  assert.deepEqual(projectAuthSession(scenario.input), scenario.expected, scenario.name);
}

console.log(`auth-session-projection: PASS ${scenarios.length} scenarios`);
