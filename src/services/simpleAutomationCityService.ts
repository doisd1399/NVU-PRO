import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  sanitizeSimpleAutomationCities,
  type SimpleAutomationCity,
  type SimpleAutomationSimulatorKey,
} from "../lib/simpleAutomation";

const CITIES_COLLECTION = "simple_automation_cities";

export async function loadSimpleAutomationCities(
  simulatorKey: SimpleAutomationSimulatorKey,
): Promise<SimpleAutomationCity[]> {
  const snapshot = await getDoc(doc(db, CITIES_COLLECTION, simulatorKey));
  if (!snapshot.exists()) return [];
  return sanitizeSimpleAutomationCities(snapshot.data()?.cities);
}
