export function isWorkModeMaintenanceError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Sistema em manutenção:");
}
