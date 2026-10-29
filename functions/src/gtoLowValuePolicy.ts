import type { CanonicalOperationProjection } from "./canonicalOperationProjection";

/**
 * Retired compatibility hook. A low positive price cannot prove an OCR error
 * or identify a duplicate delivery, so it must never authorize deletion.
 * The old repair callable still acknowledges previously audited tombstones.
 */
export function isInvalidLowValueGtoPrint(
  _row: Record<string, unknown>,
  _projection: CanonicalOperationProjection,
  _uid: string,
): boolean {
  return false;
}
