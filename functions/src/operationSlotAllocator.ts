/** Slot numbers are identities, not the count: deletions can leave gaps. */
export function allocateOperationSlot(rows: readonly Record<string, unknown>[], total: number): number {
  const occupied = new Set<number>();
  for (const row of rows) {
    if (row.deleted === true || row.softDeleted === true || row.status === "DELETED") continue;
    const slot = Number(row.operationSlot);
    if (Number.isInteger(slot) && slot > 0) occupied.add(slot);
  }
  let slot = 1;
  while (occupied.has(slot) && slot <= total) slot += 1;
  return slot;
}
