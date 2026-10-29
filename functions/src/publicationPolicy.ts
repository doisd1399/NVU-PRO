export function publishedAtForCreate<T>(
  documentExists: boolean,
  stampOnCreate: boolean,
  serverTimestampValue: T,
): { publishedAt: T } | Record<string, never> {
  if (documentExists || !stampOnCreate) return {};
  return { publishedAt: serverTimestampValue };
}
