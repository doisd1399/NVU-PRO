/** Share preparation and submission of the same immutable, owned receipt. */
const flights = new Map<string, Promise<string>>();
export function receiptUploadFlight(key: string, work: () => Promise<string>): Promise<string> {
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = Promise.resolve().then(work);
  flights.set(key, flight);
  const cleanup = () => { if (flights.get(key) === flight) flights.delete(key); };
  void flight.then(cleanup, cleanup);
  return flight;
}
