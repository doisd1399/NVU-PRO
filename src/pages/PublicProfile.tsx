import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, CalendarDays, MapPin, Navigation, Trophy, Truck, Users } from "lucide-react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";

type PublicTrip = {
  id: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl: string;
  companyId: string;
  origin: string;
  destination: string;
  value: number;
  distanceKm: number;
  dateMs: number;
};

type PublicCompany = {
  id: string;
  companyName: string;
  simulatorName: string;
  logoUrl: string;
};

type PublicDriver = {
  driverId: string;
  driverName: string;
  driverPhotoUrl: string;
  trips: number;
  earnings: number;
  distanceKm: number;
};

const PUBLIC_TRIP_LIMIT = 100;

const asText = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const asNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const normalized = String(value ?? "")
      .replace(/[^0-9,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
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

const normalizeTrip = (id: string, raw: Record<string, unknown>): PublicTrip => ({
  id,
  driverId: asText(raw.motoristaId, raw.driverId, raw.userId),
  driverName: asText(raw.motoristaNome, raw.driverName, raw.nomeMotorista, "Motorista"),
  driverPhotoUrl: asText(raw.motoristaFoto, raw.driverPhotoURL, raw.profilePhotoURL, raw.photoURL),
  companyId: asText(raw.empresaId, raw.companyId),
  origin: asText(raw.origem, raw.origin, "Origem não informada"),
  destination: asText(raw.destino, raw.destination, "Destino não informado"),
  value: asNumber(raw.valor, raw.ganho, raw.recebido),
  distanceKm: asNumber(raw.km, raw.distanceKm, raw.distanciaKm),
  dateMs: asDateMs(raw.dataViagem, raw.createdAt, raw.updatedAt, raw.timestamp),
});

const mergeTrips = (snapshots: Awaited<ReturnType<typeof getDocs>>[]) => {
  const byId = new Map<string, PublicTrip>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((item) => {
      byId.set(item.id, normalizeTrip(item.id, item.data() as Record<string, unknown>));
    });
  });
  return Array.from(byId.values()).sort((left, right) => right.dateMs - left.dateMs);
};

const readTrips = async (field: "empresaId" | "companyId" | "motoristaId" | "driverId", id: string) => {
  const snapshot = await getDocs(
    query(collection(db, "historico_viagens"), where(field, "==", id), limit(PUBLIC_TRIP_LIMIT)),
  );
  return snapshot;
};

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (dateMs: number) =>
  dateMs > 0
    ? new Date(dateMs).toLocaleDateString("pt-BR")
    : "Data não informada";

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 dark:bg-[#09090b] dark:text-white sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex items-center justify-between">
          <Link to="/" className="text-lg font-black tracking-[0.2em] text-slate-900 dark:text-white">NVU</Link>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-[#151921] dark:text-slate-300">Perfil público</span>
        </header>
        {children}
      </div>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <section className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/50 dark:bg-[#151921]">
      <p className="font-semibold text-red-700 dark:text-red-300">{message}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nenhuma ação administrativa é disponibilizada nesta área.</p>
    </section>
  );
}

function CompanyPublicProfile({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [trips, setTrips] = useState<PublicTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      getDoc(doc(db, "frotas", companyId)),
      Promise.allSettled([
        readTrips("empresaId", companyId),
        readTrips("companyId", companyId),
      ]),
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
          simulatorName: asText(raw.simulatorName, raw.simuladorNome, "Simulador não informado"),
          logoUrl: asText(raw.logoUrl, raw.logoURL, raw.companyLogoURL),
        });
        const successfulTrips = tripResults
          .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getDocs>>> => result.status === "fulfilled")
          .map((result) => result.value);
        setTrips(mergeTrips(successfulTrips).filter((trip) => !trip.companyId || trip.companyId === companyId));
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
  }, [companyId]);

  const drivers = useMemo<PublicDriver[]>(() => {
    const byDriver = new Map<string, PublicDriver>();
    trips.forEach((trip) => {
      if (!trip.driverId) return;
      const current = byDriver.get(trip.driverId) || {
        driverId: trip.driverId,
        driverName: trip.driverName,
        driverPhotoUrl: trip.driverPhotoUrl,
        trips: 0,
        earnings: 0,
        distanceKm: 0,
      };
      current.trips += 1;
      current.earnings += trip.value;
      current.distanceKm += trip.distanceKm;
      if (current.driverName === "Motorista" && trip.driverName !== "Motorista") current.driverName = trip.driverName;
      if (!current.driverPhotoUrl) current.driverPhotoUrl = trip.driverPhotoUrl;
      byDriver.set(trip.driverId, current);
    });
    return Array.from(byDriver.values()).sort((left, right) => right.earnings - left.earnings);
  }, [trips]);

  if (loading) return <PublicShell><div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:bg-[#151921]">Abrindo perfil público…</div></PublicShell>;
  if (error || !company) return <PublicShell><ErrorCard message={error || "Empresa não encontrada."} /></PublicShell>;

  const totalEarnings = trips.reduce((total, trip) => total + trip.value, 0);
  const totalDistance = trips.reduce((total, trip) => total + trip.distanceKm, 0);

  return (
    <PublicShell>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151921] sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 dark:bg-white/10">
            {company.logoUrl ? <img src={company.logoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Building2 className="text-slate-400" size={28} />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Empresa</p>
            <h1 className="truncate text-2xl font-black tracking-tight">{company.companyName}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"><Truck size={14} /> {company.simulatorName}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={<Users size={15} />} label="Motoristas" value={String(drivers.length)} />
          <Metric icon={<Navigation size={15} />} label="Viagens" value={String(trips.length)} />
          <Metric icon={<MapPin size={15} />} label="Distância" value={`${Math.round(totalDistance)} km`} />
          <Metric icon={<Trophy size={15} />} label="Ganhos" value={formatCurrency(totalEarnings)} />
        </div>
      </section>
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151921] sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Motoristas e operação pública</h2><span className="text-xs text-slate-400">Somente leitura</span></div>
        {drivers.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Ainda não há viagens públicas para compor a lista.</p> : <div className="space-y-2">{drivers.slice(0, 20).map((driver) => <Link key={driver.driverId} to={`/public/driver/${encodeURIComponent(driver.driverId)}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xs font-bold dark:bg-white/10">{driver.driverPhotoUrl ? <img src={driver.driverPhotoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : driver.driverName.slice(0, 2).toUpperCase()}</div><span className="truncate text-sm font-semibold">{driver.driverName}</span></div><span className="shrink-0 text-xs font-semibold text-slate-500">{driver.trips} viagens</span></Link>)}</div>}
      </section>
    </PublicShell>
  );
}

function DriverPublicProfile({ driverId }: { driverId: string }) {
  const [trips, setTrips] = useState<PublicTrip[]>([]);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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
          .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getDocs>>> => result.status === "fulfilled")
          .map((result) => result.value);
        const normalizedTrips = mergeTrips(successfulTrips).filter((trip) => !trip.driverId || trip.driverId === driverId);
        setTrips(normalizedTrips);
        const companyId = normalizedTrips.find((trip) => trip.companyId)?.companyId;
        if (!companyId) return;
        const companySnapshot = await getDoc(doc(db, "frotas", companyId));
        if (cancelled || !companySnapshot.exists()) return;
        const raw = companySnapshot.data() as Record<string, unknown>;
        setCompany({
          id: companySnapshot.id,
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
  }, [driverId]);

  if (loading) return <PublicShell><div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:bg-[#151921]">Abrindo perfil público…</div></PublicShell>;
  if (error || trips.length === 0) return <PublicShell><ErrorCard message={error || "Motorista não encontrado ou ainda sem viagens públicas."} /></PublicShell>;

  const firstTrip = trips[0];
  const totalEarnings = trips.reduce((total, trip) => total + trip.value, 0);
  const totalDistance = trips.reduce((total, trip) => total + trip.distanceKm, 0);

  return (
    <PublicShell>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151921] sm:p-7">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-lg font-black dark:bg-white/10">{firstTrip.driverPhotoUrl ? <img src={firstTrip.driverPhotoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : firstTrip.driverName.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Motorista</p><h1 className="truncate text-2xl font-black tracking-tight">{firstTrip.driverName}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{company?.companyName || "Empresa pública"} · {company?.simulatorName || "Operação"}</p></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric icon={<Navigation size={15} />} label="Viagens" value={String(trips.length)} /><Metric icon={<MapPin size={15} />} label="Distância" value={`${Math.round(totalDistance)} km`} /><Metric icon={<Trophy size={15} />} label="Ganhos" value={formatCurrency(totalEarnings)} /></div>
      </section>
      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151921] sm:p-7"><h2 className="mb-4 text-lg font-bold">Histórico público de viagens</h2><div className="space-y-2">{trips.slice(0, 50).map((trip) => <article key={trip.id} className="rounded-2xl border border-slate-100 p-3 dark:border-white/5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-sm font-semibold"><MapPin size={14} className="shrink-0 text-teal-500" /> {trip.origin} → {trip.destination}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays size={13} /> {formatDate(trip.dateMs)}</p></div><span className="shrink-0 text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(trip.value)}</span></div></article>)}</div></section>
    </PublicShell>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{icon}{label}</div><p className="mt-1 text-base font-black text-slate-900 dark:text-white">{value}</p></div>;
}

export default function PublicProfile() {
  const { companyId, driverId } = useParams<{ companyId?: string; driverId?: string }>();
  if (companyId) return <CompanyPublicProfile companyId={companyId} />;
  if (driverId) return <DriverPublicProfile driverId={driverId} />;
  return <PublicShell><ErrorCard message="Perfil público não identificado." /></PublicShell>;
}
