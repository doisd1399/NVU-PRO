import {
  getProSimulatorDefinition,
  isAllowedProContext,
  type ProAllowedContext,
  type ProCaptureFailureCode,
  type ProSessionSnapshot,
  type ProSessionState,
  type ProVisibility,
} from "./proUniversalContracts";

export type ProSessionEvent =
  | { type: "context_ready"; context: ProAllowedContext; sessionId: string; now: number }
  | { type: "simulator_visibility"; visibility: ProVisibility }
  | { type: "route_selected"; origin: string; destination: string; now: number }
  | { type: "capture_requested"; attemptId: string }
  | { type: "projection_granted" }
  | { type: "projection_denied"; failureCode?: ProCaptureFailureCode }
  | { type: "capture_started" }
  | { type: "ocr_started" }
  | { type: "ocr_rejected"; failureCode?: ProCaptureFailureCode }
  | { type: "submission_started" }
  | { type: "completed" }
  | { type: "cancelled" }
  | { type: "reset" };

const clean = (value: unknown): string => String(value || "").trim();

function stateError(state: ProSessionState, expected: string): never {
  throw new Error(`PRO_INVALID_TRANSITION:${state}:${expected}`);
}

export function createIdleProSession(): null {
  return null;
}

export function applyProSessionEvent(
  session: ProSessionSnapshot | null,
  event: ProSessionEvent,
): ProSessionSnapshot | null {
  if (event.type === "reset") return null;

  if (event.type === "context_ready") {
    const definition = getProSimulatorDefinition(event.context.simulatorKey);
    if (!definition || !isAllowedProContext(event.context)) throw new Error("PRO_CONTEXT_NOT_ALLOWED");
    return {
      sessionId: event.sessionId,
      contextEpoch: event.context.contextEpoch,
      state: "CONTEXT_READY",
      simulatorKey: event.context.simulatorKey,
      expectedPackage: event.context.expectedPackage,
      origin: "",
      destination: "",
      tripStartedAt: 0,
      visibility: "UNKNOWN",
      projection: "NOT_GRANTED",
      attemptId: "",
    };
  }

  if (!session) throw new Error("PRO_SESSION_MISSING");

  switch (event.type) {
    case "simulator_visibility":
      if (session.state === "CAPTURING" || session.state === "OCR_VALIDATING" || session.state === "SUBMITTING") {
        return { ...session, visibility: event.visibility };
      }
      return {
        ...session,
        visibility: event.visibility,
        state: event.visibility === "VISIBLE" && session.state === "CONTEXT_READY"
          ? "SIMULATOR_VISIBLE"
          : session.state,
      };
    case "route_selected":
      if (session.state !== "CONTEXT_READY" && session.state !== "SIMULATOR_VISIBLE" && session.state !== "ROUTE_SELECTING") {
        stateError(session.state, "route_selected");
      }
      if (!clean(event.origin) || !clean(event.destination) || clean(event.origin).toLowerCase() === clean(event.destination).toLowerCase()) {
        throw new Error("PRO_ROUTE_INVALID");
      }
      return { ...session, state: "TRIP_ACTIVE", origin: clean(event.origin), destination: clean(event.destination), tripStartedAt: event.now };
    case "capture_requested":
      if (session.state !== "TRIP_ACTIVE") stateError(session.state, "capture_requested");
      if (!session.origin || !session.destination) throw new Error("PRO_ROUTE_MISSING");
      if (session.visibility !== "VISIBLE") return { ...session, lastFailureCode: "FOREGROUND_MISMATCH" };
      return { ...session, state: "CAPTURE_AUTH_PENDING", projection: "PENDING", attemptId: event.attemptId, lastFailureCode: undefined };
    case "projection_granted":
      if (session.state !== "CAPTURE_AUTH_PENDING") stateError(session.state, "projection_granted");
      return { ...session, state: "CAPTURING", projection: "GRANTED" };
    case "projection_denied":
      if (session.state !== "CAPTURE_AUTH_PENDING") stateError(session.state, "projection_denied");
      return { ...session, state: "TRIP_ACTIVE", projection: "NOT_GRANTED", lastFailureCode: event.failureCode || "PROJECTION_DENIED" };
    case "capture_started":
      if (session.state !== "CAPTURING") stateError(session.state, "capture_started");
      return { ...session, state: "OCR_VALIDATING" };
    case "ocr_started":
      if (session.state !== "CAPTURING") stateError(session.state, "ocr_started");
      return { ...session, state: "OCR_VALIDATING" };
    case "ocr_rejected":
      if (session.state !== "OCR_VALIDATING") stateError(session.state, "ocr_rejected");
      return { ...session, state: "REJECTED", lastFailureCode: event.failureCode || "RESULT_SCREEN_UNCONFIRMED" };
    case "submission_started":
      if (session.state !== "OCR_VALIDATING") stateError(session.state, "submission_started");
      return { ...session, state: "SUBMITTING" };
    case "completed":
      if (session.state !== "SUBMITTING") stateError(session.state, "completed");
      return { ...session, state: "COMPLETED" };
    case "cancelled":
      if (["COMPLETED", "CANCELLED"].includes(session.state)) stateError(session.state, "cancelled");
      return { ...session, state: "CANCELLED", origin: "", destination: "", tripStartedAt: 0 };
    default:
      return session;
  }
}
