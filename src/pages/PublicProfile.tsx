import { CachedImage } from "../components/common/CachedImage";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, CalendarDays, MapPin, Navigation, Trophy, Truck, Users } from "lucide-react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { normalizeTrip as normalizeHistoricalTrip, parseTripMoneyRecord } from "../lib/tripNormalizer";
import { formatPublicEarnings } from "../lib/publicProfileEarnings";
import { normalizeCompanyDescription } from "../lib/companyProfileDescription";
import { driverDisplayIdentity } from "../lib/driverDisplayIdentity";
import { useVisibleDriverIdentity } from "../hooks/useVisibleDriverIdentity";

type PublicTrip = {
  id: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl: string;
  companyId: string;
  origin: string;
  destination: string;
  value: number;
  currency?: string;
  currencyStatus?: "known" | "unknown" | "missing" | "conflict";
  currencySource?: string;
  eligible: boolean;
  status: string;
  distanceKm: number;
  dateMs: number;
};

type PublicCompany = {
  id: string;
  companyName: string;
  simulatorName: string;
  logoUrl: string;
  profileDescription?: string;
};

type PublicDriver = {
  driverId: string;
  driverName: string;
  driverPhotoUrl: string;
  trips: number;
  distanceKm: number;
};
type ReadCoverage = "unknown" | "complete" | "partial";

const PUBLIC_TRIP_LIMIT = 100;
function usePublicViewer(): "loading" | "authenticated" | "anonymous" {
  const [viewer, setViewer] = useState<"loading" | "authenticated" | "anonymous">("loading");
  useEffect(() => onAuthStateChanged(auth, (user) => {
    setViewer(user ? "authenticated" : "anonymous");
  }), []);
  return viewer;
}

const asText = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const asNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const cleaned = String(value).replace(/[^0-9,.-]/g, "");
    if (!cleaned) continue;
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else if ((cleaned.match(/\./g) || []).length > 1) {
      const lastDot = cleaned.lastIndexOf(".");
      normalized = cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const asDateMs = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof (value as { toMillis?: unknown })?.toMillis === "function") {
      const millis = (value as { toMillis: () => number }).toMillis();
      if (Number.isFinite(millis)) return millis;
    }
    const parsed = new Date(String(value ?? "")).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const normalizePublicStatus = (value: unknown) => String(value || "").trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const normalizeTrip = (id: string, raw: Record<string, unknown>): PublicTrip => {
  const money = parseTripMoneyRecord(raw);
  const metricTrip = normalizeHistoricalTrip({ ...raw, id } as any);
  return {
    id,
    driverId: asText(raw.motoristaId, raw.driverId, raw.userId),
    driverName: asText(raw.motoristaNome, raw.driverName, raw.nomeMotorista, "Motorista"),
    driverPhotoUrl: driverDisplayIdentity({ profilePhotoURL: asText(raw.motoristaFoto, raw.driverPhotoURL, raw.profilePhotoURL, raw.photoURL) }).profilePhotoURL,
    companyId: asText(raw.empresaId, raw.companyId),
    origin: asText(raw.origem, raw.origin, "Origem não informada"),
    destination: asText(raw.destino, raw.destination, "Destino não informado"),
    value: money.amount,
    currency: money.currency,
    currencyStatus: money.currencyStatus,
    currencySource: money.currencySource,
    eligible: metricTrip.isValid,
    status: normalizePublicStatus(raw.recordStatus || raw.status),
    distanceKm: asNumber(raw.km, raw.distanceKm, raw.distanciaKm),
    dateMs: asDateMs(raw.completedAt, raw.dataFechamento, raw.date, raw.dataLancamento, raw.dataViagem, raw.createdAt, raw.updatedAt, raw.timestamp),
  };
};

const mergeTrips = (
  snapshots: Awaited<ReturnType<typeof getDocs>>[],
  companyContexts: Map<string, Record<string, unknown>> = new Map(),
) => {
  const byId = new Map<string, PublicTrip>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((item) => {
      const raw = item.data() as Record<string, unknown>;
      const companyId = asText(raw.empresaId, raw.companyId);
      const company = companyContexts.get(companyId);
      const contextualRaw = company ? {
        ...raw,
        simulatorKey: raw.simulatorKey ?? company.simulatorKey,
        simulatorCode: raw.simulatorCode ?? raw.simuladorCodigo ?? company.simulatorCode ?? company.simuladorCodigo,
        simulatorId: raw.simulatorId ?? raw.simuladorId ?? company.simulatorId ?? company.simuladorId,
        simulatorName: raw.simulatorName ?? raw.simuladorNome ?? company.simulatorName ?? company.simuladorNome,
      } : raw;
      byId.set(item.id, normalizeTrip(item.id, contextualRaw));
    });
  });
  return Array.from(byId.values()).sort((left, right) => right.dateMs - left.dateMs);
};

const readTrips = async (field: "empresaId" | "companyId" | "motoristaId" | "driverId", id: string) => {
  const byId = new Map<string, Awaited<ReturnType<typeof getDocs>>["docs"][number]>();
  const errors: unknown[] = [];
  let cursor: Awaited<ReturnType<typeof getDocs>>["docs"][number] | undefined;
  while (true) {
    try {
      const constraints = [where(field, "==", id), limit(PUBLIC_TRIP_LIMIT)];
      const snapshot = await getDocs(cursor
        ? query(collection(db, "historico_viagens"), ...constraints, startAfter(cursor))
        : query(collection(db, "historico_viagens"), ...constraints));
      snapshot.docs.forEach((item) => byId.set(item.id, item));
      if (snapshot.docs.length < PUBLIC_TRIP_LIMIT) break;
      const next = snapshot.docs[snapshot.docs.length - 1];
      if (!next || cursor?.id === next.id) break;
      cursor = next;
    } catch (error) {
      errors.push(error);
      break;
    }
  }
  if (!byId.size && errors.length) {
    const primaryErrors = [...errors];
    errors.length = 0;
    errors.push(...primaryErrors);
    for (const legacyField of ["completedAt", "dataFechamento", "date", "dataLancamento", "dataViagem", "createdAt", "updatedAt", "timestamp"]) {
      let legacyCursor: Awaited<ReturnType<typeof getDocs>>["docs"][number] | undefined;
      while (true) {
        try {
          const constraints = [where(field, "==", id), orderBy(legacyField, "desc"), limit(PUBLIC_TRIP_LIMIT)];
          const snapshot = await getDocs(legacyCursor
            ? query(collection(db, "historico_viagens"), ...constraints, startAfter(legacyCursor))
            : query(collection(db, "historico_viagens"), ...constraints));
          snapshot.docs.forEach((item) => byId.set(item.id, item));
          if (snapshot.docs.length < PUBLIC_TRIP_LIMIT) break;
          const next = snapshot.docs[snapshot.docs.length - 1];
          if (!next || legacyCursor?.id === next.id) break;
          legacyCursor = next;
        } catch (error) {
          errors.push(error);
          break;
        }
      }
    }
  }
  // Keep one bounded legacy-field probe for diagnostics. The identity query
  // above is the complete source; this probe must never filter its result.
  try {
    await getDocs(query(collection(db, "historico_viagens"), where(field, "==", id), orderBy("timestamp", "desc"), limit(1)));
  } catch (error) { errors.push(error); }
  if (!byId.size && errors.length) throw errors[0];
  return { docs: Array.from(byId.values()), coverage: errors.length ? "partial" : "complete" } as Awaited<ReturnType<typeof getDocs>> & { coverage: "complete" | "partial" };
};
type PublicTripRead = Awaited<ReturnType<typeof readTrips>>;

const formatTripValue = (trip: PublicTrip) => {
  if (trip.currencyStatus === "conflict") return `${trip.value} (moedas conflitantes; valor não comparável)`;
  if (trip.currencyStatus === "missing" || !trip.currency) return `${trip.value} (moeda não informada)`;
  if (trip.currencyStatus === "unknown") return `${trip.value} (${trip.currency}: moeda desconhecida)`;
  try { return trip.value.toLocaleString("pt-BR", { style: "currency", currency: trip.currency }); }
  catch { return `${trip.value} (moeda desconhecida)`; }
};

const formatDate = (dateMs: number) =>
  dateMs > 0
    ? new Date(dateMs).toLocaleDateString("pt-BR")
    : "Data não informada";

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 dark:bg-nvu-page dark:text-white sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex items-center justify-between">
          <Link to="/" className="text-lg font-black tracking-[0.2em] text-slate-900 dark:text-white">NVU</Link>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-nvu-page dark:text-nvu-text-soft">Perfil público</span>
        </header>
        {children}
      </div>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <section className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/50 dark:bg-nvu-page">
      <p className="font-semibold text-red-700 dark:text-red-300">{message}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-nvu-muted">Nenhuma ação administrativa é disponibilizada nesta área.</p>
    </section>
  );
}

function CompanyPublicProfile({ companyId }: { companyId: string }) {
  const viewer = usePublicViewer();
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [trips, setTrips] = useState<PublicTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState<ReadCoverage>("unknown");
  const identities = useVisibleDriverIdentity([...new Set(trips.map(trip => trip.driverId))].slice(0, 20), viewer === "authenticated");

  useEffect(() => {
    if (viewer === "loading") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      getDoc(doc(db, "public_companies", companyId)),
      viewer === "authenticated" ? Promise.allSettled([
        readTrips("empresaId", companyId),
        readTrips("companyId", companyId),
      ]) : Promise.resolve([]),
    ])
      .then(([companySnapshot, tripResults]) => {
        if (cancelled) return;
        if (!companySnapshot.exists()) {
          setError("Empresa não encontrada.");
          return;
        }
        const raw = companySnapshot.data() as Record<string, unknown>;
        setCompany({
          id: companySnapshot.id,
          companyName: asText(raw.companyName, raw.fleetName, "Empresa"),
          profileDescription: normalizeCompanyDescription(raw.profileDescription),
          simulatorName: asText(raw.simulatorName, raw.simuladorNome, "Simulador não informado"),
          logoUrl: asText(raw.logoUrl, raw.logoURL, raw.companyLogoURL),
        });
        const successfulTrips = tripResults
          .filter((result): result is PromiseFulfilledResult<PublicTripRead> => result.status === "fulfilled")
          .map((result) => result.value);
        setCoverage(tripResults.some((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.coverage === "partial")) ? "partial" : "complete");
        if (viewer === "authenticated" && successfulTrips.length === 0) {
          setError("Não foi possível carregar as viagens. Tente novamente mais tarde.");
          return;
        }
        setTrips(mergeTrips(successfulTrips, new Map([[companyId, raw]])).filter((trip) => !trip.companyId || trip.companyId === companyId));
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível abrir o perfil público agora.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, viewer]);

  const drivers = useMemo<PublicDriver[]>(() => {
    const byDriver = new Map<string, PublicDriver>();
    trips.forEach((trip) => {
      if (!trip.driverId || !trip.eligible) return;
      const current = byDriver.get(trip.driverId) || {
        driverId: trip.driverId,
        driverName: trip.driverName,
        driverPhotoUrl: trip.driverPhotoUrl,
        trips: 0,
        distanceKm: 0,
      };
      current.trips += 1;
      current.distanceKm += trip.distanceKm;
      if (current.driverName === "Motorista" && trip.driverName !== "Motorista") current.driverName = trip.driverName;
      if (!current.driverPhotoUrl) current.driverPhotoUrl = trip.driverPhotoUrl;
      byDriver.set(trip.driverId, current);
    });
    return Array.from(byDriver.values()).map(driver => identities[driver.driverId]
      ? { ...driver, driverName: identities[driver.driverId].name, driverPhotoUrl: identities[driver.driverId].profilePhotoURL }
      : driver).sort((left, right) => right.trips - left.trips || right.distanceKm - left.distanceKm || left.driverName.localeCompare(right.driverName, "pt-BR"));
  }, [trips, identities]);

  if (loading) return <PublicShell><div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:bg-nvu-page">Abrindo perfil público…</div></PublicShell>;
  if (error || !company) return <PublicShell><ErrorCard message={error || "Empresa não encontrada."} /></PublicShell>;

  const eligibleTrips = trips.filter((trip) => trip.eligible);
  const totalDistance = eligibleTrips.reduce((total, trip) => total + trip.distanceKm, 0);

  return (
    <PublicShell>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-nvu-page sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-white/10">
            {company.logoUrl ? <CachedImage src={company.logoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Building2 className="text-slate-400" size={28} />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Empresa</p>
            <h1 className="truncate text-2xl font-black tracking-tight">{company.companyName}</h1>
            {company.profileDescription && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-nvu-muted break-words">{company.profileDescription}</p>}
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-nvu-muted"><Truck size={14} /> {company.simulatorName}</p>
          </div>
        </div>
        {viewer === "authenticated" ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={<Users size={15} />} label="Motoristas" value={String(drivers.length)} />
          <Metric icon={<Navigation size={15} />} label="Viagens" value={String(eligibleTrips.length)} />
          <Metric icon={<MapPin size={15} />} label="Distância" value={`${Math.round(totalDistance)} km`} />
          <Metric icon={<Trophy size={15} />} label="Ganhos" value={formatPublicEarnings(trips, coverage)} />
        </div> : <p className="mt-6 text-sm text-slate-500">As viagens exigem uma sessão NVU. <Link to="/login" className="font-semibold underline">Entrar</Link></p>}
        {viewer === "authenticated" && coverage === "partial" && <p className="mt-3 text-xs text-amber-600">Cobertura parcial: uma fonte histórica não respondeu; os totais exibidos não são completos.</p>}
      </section>
      {viewer === "authenticated" &&
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-nvu-page sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Motoristas e operação pública</h2><p className="text-xs text-slate-400">Ordem por viagens elegíveis, sem comparar ganhos entre moedas.</p></div><span className="text-xs text-slate-400">Somente leitura</span></div>
        {drivers.length === 0 ? <p className="text-sm text-slate-500 dark:text-nvu-muted">Ainda não há viagens públicas para compor a lista.</p> : <div className="space-y-2">{drivers.slice(0, 20).map((driver) => <Link key={driver.driverId} to={`/public/driver/${encodeURIComponent(driver.driverId)}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xs font-bold dark:bg-white/10">{driver.driverPhotoUrl ? <CachedImage src={driver.driverPhotoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : driver.driverName.slice(0, 2).toUpperCase()}</div><span className="truncate text-sm font-semibold">{driver.driverName}</span></div><span className="shrink-0 text-xs font-semibold text-slate-500">{driver.trips} viagens</span></Link>)}</div>}
      </section>}
    </PublicShell>
  );
}

function DriverPublicProfile({ driverId }: { driverId: string }) {
  const viewer = usePublicViewer();
  const identities = useVisibleDriverIdentity([driverId], viewer === "authenticated");
  const [trips, setTrips] = useState<PublicTrip[]>([]);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState<ReadCoverage>("unknown");

  useEffect(() => {
    if (viewer === "loading") return;
    if (viewer === "anonymous") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.allSettled([
      readTrips("motoristaId", driverId),
      readTrips("driverId", driverId),
    ])
      .then(async (results) => {
        if (cancelled) return;
        const successfulTrips = results
          .filter((result): result is PromiseFulfilledResult<PublicTripRead> => result.status === "fulfilled")
          .map((result) => result.value);
        setCoverage(results.some((result) => result.status === "rejected" || (result.status === "fulfilled" && result.value.coverage === "partial")) ? "partial" : "complete");
        if (successfulTrips.length === 0) {
          setError("Não foi possível carregar as viagens. Tente novamente mais tarde.");
          return;
        }
        const companyIds = Array.from(new Set(successfulTrips.flatMap((source) =>
          source.docs.map((item) => {
            const raw = item.data() as Record<string, unknown>;
            return asText(raw.empresaId, raw.companyId);
          }).filter(Boolean),
        )));
        const companyContexts = new Map<string, Record<string, unknown>>();
        await Promise.all(companyIds.map(async (id) => {
          try {
            const snapshot = await getDoc(doc(db, "public_companies", id));
            if (snapshot.exists()) companyContexts.set(id, snapshot.data() as Record<string, unknown>);
          } catch { /* Keep explicit trip metadata when a company catalog read is unavailable. */ }
        }));
        if (cancelled) return;
        const normalizedTrips = mergeTrips(successfulTrips, companyContexts).filter((trip) => !trip.driverId || trip.driverId === driverId);
        setTrips(normalizedTrips);
        const companyId = normalizedTrips.find((trip) => trip.companyId)?.companyId;
        if (!companyId) return;
        const raw = companyContexts.get(companyId);
        if (cancelled || !raw) return;
        setCompany({
          id: companyId,
          companyName: asText(raw.companyName, raw.fleetName, "Empresa"),
          simulatorName: asText(raw.simulatorName, raw.simuladorNome, "Simulador não informado"),
          logoUrl: asText(raw.logoUrl, raw.logoURL, raw.companyLogoURL),
        });
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível abrir o perfil público agora.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [driverId, viewer]);

  if (loading) return <PublicShell><div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:bg-nvu-page">Abrindo perfil público…</div></PublicShell>;
  if (viewer === "anonymous") return <PublicShell><div className="rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-nvu-page">O histórico de viagens exige uma sessão NVU. <Link to="/login" className="font-semibold underline">Entrar</Link></div></PublicShell>;
  if (error || trips.length === 0) return <PublicShell><ErrorCard message={error || "Motorista não encontrado ou ainda sem viagens públicas."} /></PublicShell>;

  const identity = identities[driverId];
  const firstTrip = identity ? { ...trips[0], driverName: identity.name, driverPhotoUrl: identity.profilePhotoURL } : trips[0];
  const eligibleTrips = trips.filter((trip) => trip.eligible);
  const totalDistance = eligibleTrips.reduce((total, trip) => total + trip.distanceKm, 0);

  return (
    <PublicShell>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-nvu-page sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-lg font-black dark:bg-white/10">{firstTrip.driverPhotoUrl ? <CachedImage src={firstTrip.driverPhotoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : firstTrip.driverName.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Motorista</p><h1 className="truncate text-2xl font-black tracking-tight">{firstTrip.driverName}</h1><p className="mt-1 text-sm text-slate-500 dark:text-nvu-muted">{company?.companyName || "Empresa pública"} · {company?.simulatorName || "Operação"}</p></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric icon={<Navigation size={15} />} label="Viagens" value={String(eligibleTrips.length)} /><Metric icon={<MapPin size={15} />} label="Distância" value={`${Math.round(totalDistance)} km`} /><Metric icon={<Trophy size={15} />} label="Ganhos" value={formatPublicEarnings(trips, coverage)} /></div>
        {coverage === "partial" && <p className="mt-3 text-xs text-amber-600">Cobertura parcial: uma fonte histórica não respondeu; os totais exibidos não são completos.</p>}
      </section>
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-nvu-page sm:p-7"><h2 className="mb-4 text-lg font-bold">Histórico público de viagens</h2><div className="space-y-2">{trips.map((trip) => <article key={trip.id} className="rounded-2xl border border-slate-100 p-3 dark:border-white/5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-sm font-semibold"><MapPin size={14} className="shrink-0 text-teal-500" /> {trip.origin} → {trip.destination}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays size={13} /> {formatDate(trip.dateMs)}</p></div><span className="shrink-0 text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatTripValue(trip)}</span></div></article>)}</div></section>
    </PublicShell>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-nvu-muted">{icon}{label}</div><p className="mt-1 text-base font-black text-slate-900 dark:text-white">{value}</p></div>;
}

export default function PublicProfile() {
  const { companyId, driverId } = useParams<{ companyId?: string; driverId?: string }>();
  if (companyId) return <CompanyPublicProfile companyId={companyId} />;
  if (driverId) return <DriverPublicProfile driverId={driverId} />;
  return <PublicShell><ErrorCard message="Perfil público não identificado." /></PublicShell>;
}
