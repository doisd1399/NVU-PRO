import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  sanitizeSimpleAutomationCities,
  type SimpleAutomationCity,
  type SimpleAutomationSimulatorKey,
} from "../lib/simpleAutomation";

const CITIES_COLLECTION = "simple_automation_cities";
const CACHE_PREFIX = "nvu:pro-cities:v1:";
const memory = new Map<SimpleAutomationSimulatorKey, SimpleAutomationCity[]>();
const pending = new Map<SimpleAutomationSimulatorKey, Promise<SimpleAutomationCity[]>>();

export function getCachedSimpleAutomationCities(key: SimpleAutomationSimulatorKey): SimpleAutomationCity[] {
  const current = memory.get(key);
  if (current) return [...current];
  try {
    const saved = localStorage.getItem(CACHE_PREFIX + key);
    if (saved) {
      const cities = sanitizeSimpleAutomationCities(JSON.parse(saved));
      memory.set(key, cities);
      return [...cities];
    }
  } catch { /* A missing or corrupt local cache must never block launch. */ }
  return [];
}

export function cacheSimpleAutomationCities(key: SimpleAutomationSimulatorKey, values: unknown): void {
  const cities = sanitizeSimpleAutomationCities(values);
  memory.set(key, cities);
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cities.map(city => city.name))); }
  catch { /* Storage may be unavailable in private WebViews. */ }
}

export async function loadSimpleAutomationCities(
  simulatorKey: SimpleAutomationSimulatorKey,
): Promise<SimpleAutomationCity[]> {
  const existing = pending.get(simulatorKey);
  if (existing) return existing;
  const request = getDoc(doc(db, CITIES_COLLECTION, simulatorKey)).then(snapshot => {
    // Firestore uses an in-memory cache on Android. An unconfirmed empty
    // snapshot while offline must not erase the durable last known city list.
    if (snapshot.metadata.fromCache) {
      const saved = getCachedSimpleAutomationCities(simulatorKey);
      if (saved.length) return saved;
      throw new Error("A lista de cidades não foi confirmada pelo servidor nesta sessão.");
    }
    const cities = sanitizeSimpleAutomationCities(snapshot.exists() ? snapshot.data()?.cities : []);
    cacheSimpleAutomationCities(simulatorKey, cities);
    return cities;
  }).finally(() => pending.delete(simulatorKey));
  pending.set(simulatorKey, request);
  return request;
}
