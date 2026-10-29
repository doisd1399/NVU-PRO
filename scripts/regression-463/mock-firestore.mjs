const collections = new Map();
export function resetDocuments(values = {}) {
  collections.clear();
  for (const [name, docs] of Object.entries(values)) collections.set(name, new Map(Object.entries(docs)));
}
export const doc = (_db, name, id) => ({ name, id });
export const collection = (_db, name) => ({ name });
export const where = (field, operator, value) => ({ kind: 'where', field, operator, value });
export const limit = (count) => ({ kind: 'limit', count });
export const startAfter = (snapshot) => ({ kind: 'after', id: snapshot.id });
export const query = (ref, ...constraints) => ({ ...ref, constraints });
const snapshot = (id, data) => ({ id, exists: () => data !== undefined, data: () => data });
export async function getDoc(ref) { return snapshot(ref.id, collections.get(ref.name)?.get(ref.id)); }
export const getDocFromServer = getDoc;
export async function getDocs(ref) {
  let entries = [...(collections.get(ref.name) || [])].sort(([a], [b]) => a.localeCompare(b));
  for (const constraint of ref.constraints || []) {
    if (constraint.kind === 'where') entries = entries.filter(([, data]) => data[constraint.field] === constraint.value);
    if (constraint.kind === 'after') entries = entries.filter(([id]) => id.localeCompare(constraint.id) > 0);
  }
  const take = ref.constraints?.find((c) => c.kind === 'limit')?.count;
  if (take) entries = entries.slice(0, take);
  return { docs: entries.map(([id, data]) => snapshot(id, data)), metadata: { fromCache: false } };
}
export async function setDoc(ref, data, options) {
  const items = collections.get(ref.name) || new Map();
  items.set(ref.id, options?.merge ? { ...items.get(ref.id), ...data } : data);
  collections.set(ref.name, items);
}
export const serverTimestamp = () => ({ seconds: 1_700_000_000 });
