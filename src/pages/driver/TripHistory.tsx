import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { handleSafeRouteBack } from "../../lib/safeBackNavigation";
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import {
  ArrowLeft,
  Filter,
  Settings2,
  Eye,
  Truck,
  Package,
  FileText,
  File,
  X,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  MoreVertical,
  Building2,
  User,
  Gamepad2,
  MapPin,
  ArrowRight,
  DollarSign,
  Route,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronsDownUp,
  ShieldAlert,
  Check,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { StableImage } from "../../components/common/StableImage";
import { doc } from "firebase/firestore";
import { toast } from "sonner";
import { db } from "../../lib/firebase";
import {
  removeTripHistoryOptimistically,
  updateTripHistoryOptimistically,
  useTripHistory,
} from "../../hooks/useTripHistory";
import { TripsRepository } from "../../repositories/TripsRepository";
import {
  applyDriverSuspension,
  deleteTripWithModeration,
} from "../../services/tripModerationService";
import {
  DRIVER_SUSPENSION_DURATION_OPTIONS,
  DRIVER_SUSPENSION_REASON_OPTIONS,
  TRIP_DELETION_REASON_OPTIONS,
  type DriverSuspensionDurationHours,
} from "../../lib/driverSuspension";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { onAuthTeardown } from "../../lib/authLifecycle";
import { normalizeTrip, parseTripValue } from "../../lib/tripNormalizer";
import {
  getCanonicalTripCompanyId,
  getCanonicalTripDriverId,
  getCanonicalTripDriverName,
} from "../../lib/tripIdentity";
import { buildTripNumberMap, buildTripOperationCounterMap } from "../../lib/tripSequence";
import {
  formatTripDistance,
  parseTripDistance,
  readTripDistance,
  requiresTripDistance,
  resolveTripSimulatorCode,
} from "../../lib/tripDistance";
import {
  filterAndSortTripHistory,
  getTripDisplayDate,
  summarizeTripHistory,
} from "../../lib/tripHistoryEngine";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { resolveTripTrailerName } from "../../lib/tripTrailer";
import { resolveProSimulatorCode } from "../../services/pro-universal/proUniversalContracts";
function displayTripSimulatorName(trip: Record<string, any>): string {
  const canonicalCode = resolveProSimulatorCode(
    trip.simulatorCode
      || trip.simuladorCodigo
      || trip.simulatorKey
      || trip.simulatorId
      || trip.simuladorNome
      || trip.simulatorName,
  );
  return canonicalCode || String(trip.simuladorNome || trip.simulatorName || "-");
}


import {
  isTripReceiptExpired,
  shouldLoadTripReceipt,
  TRIP_RECEIPT_RETENTION_DAYS,
} from "../../lib/tripReceiptRetention";

export interface TripRecord {
  id: string;
  empresaId: string;
  empresaNome: string;
  motoristaId: string;
  motoristaNome: string;

  contratoId: string;
  contratoNumero: string;
  contratoDescricao?: string;

  veiculoId: string;
  veiculoNome: string;
  veiculoPlaca?: string;

  reboqueId: string;
  reboqueNome: string;

  simuladorNome?: string;
  simulatorId?: string;
  simulatorName?: string;
  distanciaPercorrida?: number;

  origem: string;
  destino: string;
  [key: string]: any;
  valor: number;
  comprovanteUrl: string;
  comprovanteTituloOriginal?: string;
  comprovanteNomeOriginal?: string;
  receiptOriginalName?: string;
  status: string;
  criadoPor: string;
  dataLancamento: any;
  createdAt: any;
  completedAt?: any;
  dataFechamento?: any;
  date?: any;
}

const getTripReceiptOriginalTitle = (trip: TripRecord | null | undefined) => {
  if (!trip) return "";

  const candidates = [
    trip.comprovanteTituloOriginal,
    trip.comprovanteNomeOriginal,
    trip.receiptOriginalName,
    (trip as any).comprovanteOriginalName,
    (trip as any).receiptFileName,
    (trip as any).receiptTitle,
    (trip as any).imageOriginalName,
    (trip as any).imageTitle,
    (trip as any).originalFileName,
    (trip as any).originalImageTitle,
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }

  return "";
};


// --- Trip receipt image cache & progressive preloading ---
//
// A separate, bounded cache is used for trip receipts instead of sharing the
// avatar cache. This keeps a large history from evicting ranking/profile
// images, while keeping decoded receipts alive for back/next navigation.
const MAX_COMPROVANTE_CACHE = 180;
const TRIP_IMAGE_BATCH_SIZE = 15;
const TRIP_IMAGE_CONCURRENCY = 3;
const imageCacheMap = new Map<
  string,
  { image: HTMLImageElement; promise: Promise<string>; ready: boolean }
>();

// A WebView can keep the module alive across logout/login. Clear receipt
// bitmaps at the auth boundary so one account can never reuse another
// account's historical evidence.
let tripImageTeardownAttached = false;
if (typeof window !== "undefined" && !tripImageTeardownAttached) {
  tripImageTeardownAttached = true;
  onAuthTeardown(() => {
    imageCacheMap.clear();
  });
}

const touchComprovante = (
  url: string,
  entry: { image: HTMLImageElement; promise: Promise<string>; ready: boolean },
) => {
  imageCacheMap.delete(url);
  imageCacheMap.set(url, entry);
};

const getCachedComprovante = (url: string) => {
  const entry = imageCacheMap.get(url);
  if (!entry) return undefined;

  if (
    !entry.ready &&
    entry.image.complete &&
    entry.image.naturalWidth > 0
  ) {
    entry.ready = true;
  }

  touchComprovante(url, entry);
  return entry.ready ? url : undefined;
};

const evictComprovantes = () => {
  if (imageCacheMap.size <= MAX_COMPROVANTE_CACHE) return;
  for (const [url, entry] of imageCacheMap) {
    // Never evict an in-flight receipt: a later navigation can reuse it.
    if (!entry.ready) continue;
    imageCacheMap.delete(url);
    if (imageCacheMap.size <= MAX_COMPROVANTE_CACHE) break;
  }
};

const decodeComprovante = (image: HTMLImageElement) =>
  new Promise<void>((resolve) => {
    if (typeof image.decode !== "function") {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 350);

    try {
      Promise.resolve(image.decode()).then(finish).catch(finish);
    } catch {
      finish();
    }
  });

export const preloadComprovante = (url: string): Promise<string> => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || typeof window === "undefined") {
    return Promise.resolve(normalizedUrl);
  }

  const cachedUrl = getCachedComprovante(normalizedUrl);
  if (cachedUrl) return Promise.resolve(cachedUrl);

  const existingEntry = imageCacheMap.get(normalizedUrl);
  if (existingEntry) return existingEntry.promise;

  const image = new Image();
  image.decoding = "async";
  image.loading = "eager";
  (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority =
    "high";

  const entry = {
    image,
    ready: false,
    promise: Promise.resolve(normalizedUrl),
  };

  entry.promise = new Promise<string>((resolve) => {
    let settled = false;
    const finish = async (loaded: boolean) => {
      if (settled) return;
      settled = true;

      if (loaded) {
        await decodeComprovante(image);
        entry.ready = true;
        touchComprovante(normalizedUrl, entry);
        evictComprovantes();
      } else if (imageCacheMap.get(normalizedUrl) === entry) {
        // A transient failure must remain retryable on a later visit.
        imageCacheMap.delete(normalizedUrl);
      }

      resolve(normalizedUrl);
    };

    image.onload = () => void finish(true);
    image.onerror = () => void finish(false);
    image.src = normalizedUrl;
  });

  imageCacheMap.set(normalizedUrl, entry);
  evictComprovantes();
  return entry.promise;
};

const preloadComprovanteBatch = async (urls: string[]) => {
  const uniqueUrls = Array.from(
    new Set(urls.map((url) => String(url || "").trim()).filter(Boolean)),
  );
  if (uniqueUrls.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      const url = uniqueUrls[cursor++];
      await preloadComprovante(url);
    }
  };

  const workerCount = Math.min(TRIP_IMAGE_CONCURRENCY, uniqueUrls.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
};

const CachedImageViewer = React.memo(
  ({ url, alt, className }: { url: string; alt?: string; className?: string }) => {
    const normalizedUrl = String(url || "").trim();
    const cachedInitialUrl = getCachedComprovante(normalizedUrl);
    const [displayUrl, setDisplayUrl] = useState<string>(
      cachedInitialUrl || "",
    );

    useEffect(() => {
      let active = true;
      const cachedUrl = getCachedComprovante(normalizedUrl);

      // Clear the previous receipt immediately. Keeping the old src while the
      // next trip is loading was the source of the visible image flash.
      setDisplayUrl(cachedUrl || "");

      if (!normalizedUrl) return () => {
        active = false;
      };

      void preloadComprovante(normalizedUrl).then((readyUrl) => {
        if (active && readyUrl) setDisplayUrl(readyUrl);
      });

      return () => {
        active = false;
      };
    }, [normalizedUrl]);

    if (!displayUrl) {
      return (
        <div
          aria-busy="true"
          className={cn(
            "w-full min-h-[180px] bg-gray-100/70 dark:bg-gray-800/50 animate-pulse",
            className,
          )}
        />
      );
    }

    return (
      <PhotoProvider>
        <PhotoView src={displayUrl}>
          <img
            src={displayUrl}
            alt={alt || "Comprovante"}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className={className}
          />
        </PhotoView>
      </PhotoProvider>
    );
  },
);
// -----------------------------------------


const DateRangeCalendar = ({
  startDate,
  endDate,
  onChange,
}: {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (start: Date | null, end: Date | null) => void;
}) => {
  const [currentMonth, setCurrentMonth] = useState(startDate || new Date());

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  ).getDate();
  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
  ).getDay();

  const handleDateClick = (day: number) => {
    const clickedDate = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day,
    );
    clickedDate.setHours(12, 0, 0, 0); // avoid timezone bugs

    if (!startDate || (startDate && endDate) || clickedDate < startDate) {
      onChange(clickedDate, null);
    } else {
      onChange(startDate, clickedDate);
    }
  };

  const prevMonth = (e: any) => {
    e.preventDefault();
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
    );
  };
  const nextMonth = (e: any) => {
    e.preventDefault();
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
    );
  };

  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(<div key={`empty-${i}`} className="w-8 h-8 md:w-9 md:h-9" />);
  }

  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      i,
    );
    date.setHours(12, 0, 0, 0);
    const dateMs = date.getTime();

    let startMs = null;
    if (startDate) {
      const startClone = new Date(startDate);
      startClone.setHours(12, 0, 0, 0);
      startMs = startClone.getTime();
    }

    let endMs = null;
    if (endDate) {
      const endClone = new Date(endDate);
      endClone.setHours(12, 0, 0, 0);
      endMs = endClone.getTime();
    }

    const isSelected = startMs === dateMs || endMs === dateMs;
    const isInRange = startMs && endMs && dateMs > startMs && dateMs < endMs;

    let roundedClass = "";
    if (isSelected && !endDate) roundedClass = "rounded-full";
    else if (startMs === dateMs && endMs) roundedClass = "rounded-l-full";
    else if (endMs === dateMs) roundedClass = "rounded-r-full";

    days.push(
      <button
        type="button"
        key={`day-${i}`}
        onClick={() => handleDateClick(i)}
        className={cn(
          "w-8 h-8 md:w-9 md:h-9 text-sm flex items-center justify-center transition-colors relative",
          isInRange ? "bg-blue-50 dark:bg-blue-900/30" : "",
          roundedClass,
          isSelected
            ? "bg-blue-600 text-white font-semibold shadow-sm z-10"
            : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full",
        )}
      >
        {i}
      </button>,
    );
  }

  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  return (
    <div className="bg-white dark:bg-[#121213] border border-gray-200 dark:border-gray-800 rounded-xl p-3 shadow-sm w-full select-none">
      <div className="flex justify-between items-center mb-4">
        <button
          type="button"
          onClick={prevMonth}
          className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors hidden sm:block"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={prevMonth}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors sm:hidden"
        >
          <ChevronLeft size={22} />
        </button>
        <span className="font-semibold text-sm text-gray-900 dark:text-white capitalize">
          {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors hidden sm:block"
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          onClick={nextMonth}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors sm:hidden"
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 mb-2 place-items-center">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div
            key={`dow-${i}`}
            className="text-center font-medium text-[11px] text-gray-400 w-8 md:w-9"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 place-items-center">{days}</div>
    </div>
  );
};

const TripListItem = React.memo(({
  trip,
  comp,
  isExpanded,
  toggleExpand,
  setSelectedTrip,
  setEditingTrip,
  setDeletingTrip,
  setSuspendingTrip,
  canEdit,
  canDelete,
  canSuspend,
  formatCurrency,
  formatDate,
  formatTime,
  tripNumber,
  operationCounterLabel,
  distanceKm,
  showTrailer,
  trailerName,
}: {
  trip: TripRecord;
  comp: any;
  isExpanded: boolean;
  toggleExpand: (id: string) => void;
  setSelectedTrip: (t: TripRecord) => void;
  setEditingTrip: (t: TripRecord) => void;
  setDeletingTrip: (t: TripRecord) => void;
  setSuspendingTrip: (t: TripRecord) => void;
  canEdit: boolean;
  canDelete: boolean;
  canSuspend: boolean;
  formatCurrency: (v: number) => string;
  formatDate: (d: any) => string;
  formatTime: (d: any) => string;
  tripNumber?: number;
  operationCounterLabel?: string;
  distanceKm?: number;
  showTrailer: boolean;
  trailerName: string;
}) => {
  const getCompanyColor = (name: string) => {
    const colors = [
      "bg-green-500",
      "bg-blue-500",
      "bg-purple-500",
      "bg-orange-500",
      "bg-pink-500",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    if (!name) return "E";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div
      onClick={() => toggleExpand(trip.id)}
      className={cn(
        "nvu-content-auto group relative bg-white dark:bg-[#121213] p-2 sm:p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 shadow-[0_1px_8px_-4px_rgba(0,0,0,0.05)] flex flex-col cursor-pointer transition-[border-color,box-shadow,background-color] hover:border-gray-200 dark:hover:border-gray-700 w-full"
      )}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between pb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {comp?.logoUrl ? (
            <StableImage
              src={comp.logoUrl}
              alt={trip.empresaNome || "Empresa"}
              loading="lazy"
              decoding="async"
              wrapperClassName="w-7 h-7 rounded-lg shrink-0"
              className="object-cover"
              fallback={
                <span
                  className={cn(
                    "h-full w-full flex items-center justify-center text-white text-[11px] font-bold tracking-wide",
                    getCompanyColor(trip.empresaNome || "Empresa"),
                  )}
                >
                  {getInitials(trip.empresaNome || "Empresa")}
                </span>
              }
            />
          ) : (
            <div
              className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 text-[11px] font-bold tracking-wide",
                getCompanyColor(trip.empresaNome || "Empresa"),
              )}
            >
              {getInitials(trip.empresaNome || "Empresa")}
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-bold text-gray-900 dark:text-white leading-tight break-words whitespace-normal line-clamp-2">
              {trip.empresaNome}
            </span>
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              Contrato #
              {trip.contratoNumero ||
                trip.contratoId?.substring(0, 4) ||
                "-"}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-end shrink-0 ml-2">
          <CalendarIcon
            size={10}
            className="text-gray-400 shrink-0"
          />
          <span className="text-[10px] font-normal text-gray-500 dark:text-gray-400 ml-1 whitespace-nowrap">
            {formatDate(trip.metricDate)} &bull;{" "}
            {formatTime(trip.metricDate)}
          </span>
        </div>
      </div>

      <div className="w-full h-px bg-gray-50 dark:bg-gray-800/60" />

      {/* Middle Grid Row 1 */}
      <div className="grid grid-cols-2 py-1 sm:py-1.5 relative">
        <div className="flex items-center gap-2 pr-2 min-w-0">
          <User
            size={12}
            className="text-gray-500 dark:text-gray-400 shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
              Motorista
            </span>
            <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
              {trip.motoristaNome}
            </span>
          </div>
        </div>

        {/* Vertical Divider */}
        <div className="absolute left-[50%] top-1.5 bottom-1.5 w-px bg-gray-50 dark:bg-gray-800/60" />

        <div className="flex items-center justify-between pl-3 min-w-0 w-full">
          <div className="flex items-center gap-2 min-w-0">
          <Gamepad2
            size={12}
            className="text-gray-500 dark:text-gray-400 shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
              Simulador
            </span>
            <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
              {displayTripSimulatorName(trip as Record<string, any>)}
            </span>
          </div>
        </div>
          {tripNumber !== undefined && (
            <div className="flex flex-col items-center justify-center shrink-0 ml-1">
              <div className="flex items-center justify-center w-6 h-6 rounded bg-gray-100 dark:bg-gray-800/80 text-[11px] font-bold text-gray-700 dark:text-gray-300">
                {tripNumber.toString().padStart(2, '0')}
              </div>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="w-full h-px bg-gray-50 dark:bg-gray-800/60" />

          {/* Middle Grid Row 2 */}
          <div className="grid grid-cols-2 py-1 sm:py-1.5 relative">
            <div className="flex items-center gap-2 pr-2 min-w-0">
              <Truck
                size={12}
                className="text-gray-500 dark:text-gray-400 shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
                  Veículo
                </span>
                <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
                  {trip.veiculoNome || "-"}
                </span>
              </div>
            </div>

            {showTrailer && (
              <>
                {/* Vertical Divider */}
                <div className="absolute left-[50%] top-1.5 bottom-1.5 w-px bg-gray-50 dark:bg-gray-800/60" />

                <div className="flex items-center gap-2 pl-3 min-w-0">
                  <Package
                    size={12}
                    className="text-gray-500 dark:text-gray-400 shrink-0"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
                      Reboque
                    </span>
                    <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
                      {trailerName || "-"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="w-full h-px bg-gray-50 dark:bg-gray-800/60" />

          {/* Origin -> Destination */}
          <div className="flex items-center gap-2 py-1 sm:py-1.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <MapPin
                size={12}
                className="text-green-500 fill-green-500 shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
                  Origem
                </span>
                <span className="text-[11px] font-medium text-gray-900 dark:text-gray-100 truncate">
                  {trip.origem || trip.gtoOriginCompany || "-"}
                </span>
              </div>
            </div>
            <ArrowRight
              size={10}
              className="text-gray-800 dark:text-gray-400 shrink-0 mx-1"
            />
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <MapPin
                size={12}
                className="text-blue-500 fill-blue-500 shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] text-gray-400 font-medium leading-tight mb-[1px]">
                  Destino
                </span>
                <span className="text-[11px] font-medium text-gray-900 dark:text-gray-100 truncate">
                  {trip.destino}
                </span>
              </div>
            </div>
          </div>

          {distanceKm !== undefined && distanceKm > 0 && (
            <>
              <div className="w-full h-px bg-gray-50 dark:bg-gray-800/60" />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  Distância percorrida
                </span>
                <span className="text-[11px] font-bold text-gray-900 dark:text-gray-100">
                  {formatTripDistance(distanceKm)} km
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bottom Row (Badges & Actions) */}
      <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100 dark:border-gray-800/60">
        <div className="flex items-center gap-1 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-full border border-green-100/50 dark:border-transparent">
          <div className="w-3 h-3 rounded-full border-[1px] border-green-500 flex items-center justify-center shrink-0">
            <DollarSign
              size={8}
              className="stroke-[3] text-green-500"
            />
          </div>
          <span className="text-[12px] font-bold text-gray-900 dark:text-green-400 tracking-tight">
            {formatCurrency(trip.valor)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {operationCounterLabel && (
            <div
              className="min-w-[42px] h-6 px-2 rounded-md bg-gray-100 dark:bg-gray-800/80 text-[11px] font-bold text-gray-700 dark:text-gray-300 flex items-center justify-center"
              aria-label={`Posição na operação ${operationCounterLabel}`}
              title={`Viagem ${operationCounterLabel} da operação`}
            >
              {operationCounterLabel}
            </div>
          )}
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-800 mx-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (shouldLoadTripReceipt(trip)) void preloadComprovante(trip.comprovanteUrl);
              setSelectedTrip(trip);
            }}
            onMouseEnter={() => {
              if (shouldLoadTripReceipt(trip)) void preloadComprovante(trip.comprovanteUrl);
            }}
            title="Visualizar Detalhes"
            className="w-7 h-6 rounded-lg border border-blue-100/60 dark:border-gray-800 bg-blue-50/50 dark:bg-[#121213] flex items-center justify-center text-blue-500 hover:bg-blue-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Eye size={12} className="stroke-[2]" />
          </button>
          {canEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingTrip(trip);
              }}
              title="Editar origem e destino"
              className="w-7 h-6 rounded-lg border border-orange-100/60 dark:border-orange-900/30 bg-orange-50/50 dark:bg-orange-500/5 flex items-center justify-center text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-500/10 transition-colors"
            >
              <Pencil size={11} className="stroke-[2]" />
            </button>
          )}
          {canSuspend && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSuspendingTrip(trip);
              }}
              title="Suspender motorista"
              className="w-7 h-6 rounded-lg border border-amber-100/60 dark:border-amber-900/30 bg-amber-50/60 dark:bg-amber-500/5 flex items-center justify-center text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors"
            >
              <ShieldAlert size={11} className="stroke-[2]" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeletingTrip(trip);
              }}
              title="Excluir Viagem"
              className="w-7 h-6 rounded-lg border border-red-100/60 dark:border-red-900/30 bg-red-50/50 dark:bg-red-500/5 flex items-center justify-center text-red-500 hover:bg-red-100 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={11} className="stroke-[2]" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(trip.id);
            }}
            className="w-7 h-6 ml-0.5 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
          >
            {isExpanded ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

const CompactMultiSelect = ({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (option: string) => void;
}) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
    {options.map((option) => {
      const isSelected = selected.includes(option);
      return (
        <button
          key={option}
          type="button"
          onClick={() => onToggle(option)}
          className={cn(
            "min-h-10 rounded-xl border px-3 py-2 text-left text-[12px] font-semibold flex items-center gap-2 transition-colors",
            isSelected
              ? "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#18181b] dark:text-gray-300 dark:hover:bg-gray-800",
          )}
          aria-pressed={isSelected}
        >
          <span
            className={cn(
              "w-4 h-4 rounded border flex items-center justify-center shrink-0",
              isSelected
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 dark:border-gray-600",
            )}
          >
            {isSelected && <Check size={11} strokeWidth={3} />}
          </span>
          <span>{option}</span>
        </button>
      );
    })}
  </div>
);

const SuspensionFields = ({
  duration,
  setDuration,
  reasons,
  toggleReason,
  message,
  setMessage,
}: {
  duration: DriverSuspensionDurationHours;
  setDuration: (duration: DriverSuspensionDurationHours) => void;
  reasons: string[];
  toggleReason: (reason: string) => void;
  message: string;
  setMessage: (message: string) => void;
}) => (
  <div className="space-y-4">
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Duração da suspensão
      </p>
      <div className="grid grid-cols-3 gap-2">
        {DRIVER_SUSPENSION_DURATION_OPTIONS.map((hours) => (
          <button
            key={hours}
            type="button"
            onClick={() => setDuration(hours)}
            className={cn(
              "h-10 rounded-xl border text-[12px] font-bold transition-colors",
              duration === hours
                ? "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-400 dark:bg-amber-500/10 dark:text-amber-200"
                : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-[#18181b] dark:text-gray-300",
            )}
          >
            {hours} horas
          </button>
        ))}
      </div>
    </div>

    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Motivo da suspensão
      </p>
      <CompactMultiSelect
        options={DRIVER_SUSPENSION_REASON_OPTIONS}
        selected={reasons}
        onToggle={toggleReason}
      />
    </div>

    <div>
      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Mensagem opcional
      </label>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value.slice(0, 500))}
        rows={3}
        placeholder="Orientação que ficará visível no painel operacional do motorista."
        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 outline-none focus:border-amber-500 dark:border-gray-700 dark:bg-[#18181b] dark:text-white"
      />
      <p className="mt-1 text-right text-[10px] text-gray-400">{message.length}/500</p>
    </div>
  </div>
);

const TripHistorySkeleton = () => (
  <div className="flex flex-col gap-3" role="status" aria-live="polite">
    {[0, 1, 2].map((item) => (
      <div
        key={item}
        className="h-[112px] rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#121213] p-3 animate-pulse"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-800" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3 w-36 rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-2.5 w-20 rounded bg-gray-100 dark:bg-gray-800/70" />
          </div>
          <div className="h-2.5 w-24 rounded bg-gray-100 dark:bg-gray-800/70" />
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-gray-100 dark:border-gray-800 pt-3">
          <div className="h-8 rounded bg-gray-100 dark:bg-gray-800/70" />
          <div className="h-8 rounded bg-gray-100 dark:bg-gray-800/70" />
        </div>
      </div>
    ))}
    <span className="sr-only">Carregando histórico de viagens</span>
  </div>
);

export default function TripHistory({
  embeddedJob,
  hideHeader = false,
  hideHeaderActions = false,
  isInsideAdminTab = false,
  externalExpandAllState,
  onTripDetailsOpen,
  defaultDriverName,
  defaultDriverId,
  hideDriverFilter = false,
  mode,
  companyId,
  historicoTripsOverride,
  historyLoadingOverride,
  historyErrorOverride,
}: {
  embeddedJob?: any;
  hideHeader?: boolean;
  hideHeaderActions?: boolean;
  isInsideAdminTab?: boolean;
  externalExpandAllState?: boolean;
  onTripDetailsOpen?: (isOpen: boolean) => void;
  defaultDriverName?: string;
  defaultDriverId?: string;
  hideDriverFilter?: boolean;
  mode?: "driver" | "company";
  companyId?: string;
  historicoTripsOverride?: TripRecord[];
  historyLoadingOverride?: boolean;
  historyErrorOverride?: unknown;
} = {}) {
  const navigate = useNavigate();
  const { currentUser, activeRole, isSeniorAuthenticated } = useSessionStore();
  const {
    activeCompanyId: contextActiveCompanyId,
    companies,
    allCompanyMembers,
  } = useCompanyStore();
  const { contracts, jobs, users, simulators, trailers } = useOperationalStore();
  const activeCompanyId = companyId || contextActiveCompanyId;
  const hasHistoryOverride = Array.isArray(historicoTripsOverride);
  const {
    historicoTrips: companyHistoryTripsFromHook = [],
    loading: historyLoadingFromHook,
    error: historyErrorFromHook,
  } = useTripHistory(activeCompanyId, {
    enabled: !hasHistoryOverride,
    userId: currentUser?.id,
  });
  const companyHistoryTrips = hasHistoryOverride
    ? historicoTripsOverride
    : companyHistoryTripsFromHook;
  const historyLoading = hasHistoryOverride
    ? Boolean(historyLoadingOverride)
    : historyLoadingFromHook;
  const historyError = hasHistoryOverride
    ? historyErrorOverride
    : historyErrorFromHook;
  const [selectedTrip, setSelectedTrip] = useState<TripRecord | null>(null);
  const [editingTrip, setEditingTrip] = useState<TripRecord | null>(null);
  const [deletingTrip, setDeletingTrip] = useState<TripRecord | null>(null);
  const [suspendingTrip, setSuspendingTrip] = useState<TripRecord | null>(null);
  const [deletionReasons, setDeletionReasons] = useState<string[]>([]);
  const [suspendWithDeletion, setSuspendWithDeletion] = useState(false);
  const [suspensionDuration, setSuspensionDuration] =
    useState<DriverSuspensionDurationHours>(24);
  const [suspensionReasons, setSuspensionReasons] = useState<string[]>([]);
  const [suspensionMessage, setSuspensionMessage] = useState("");
  const [moderationBusy, setModerationBusy] = useState(false);
  const [deletedTripIds, setDeletedTripIds] = useState<Set<string>>(new Set());
  const [selectedTripOptionsOpen, setSelectedTripOptionsOpen] = useState(false);
  const [selectedTripTransition, setSelectedTripTransition] = useState<{
    direction: -1 | 1;
    token: number;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(new Set());
  const [visibleTripCount, setVisibleTripCount] = useState(30);
  const selectedTripOptionsRef = React.useRef<HTMLDivElement | null>(null);
  const selectedTripSwipeRef = React.useRef<{
    active: boolean;
    startX: number;
    startY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
  });
  const observerTarget = React.useRef<HTMLDivElement>(null);
  const imagePrefetchBatchesRef = React.useRef<Set<string>>(new Set());
  const imagePrefetchScopeRef = React.useRef("");

  const canonicalDriverNames = React.useMemo(() => {
    const names = new Map<string, string>();
    (users || []).forEach((user: any) => {
      const id = String(user?.id || "").trim();
      const name = String(user?.name || "").trim();
      if (id && name) names.set(id, name);
    });
    const ownId = String(currentUser?.id || "").trim();
    const ownName = String(currentUser?.name || "").trim();
    if (ownId && ownName) names.set(ownId, ownName);
    return names;
  }, [currentUser?.id, currentUser?.name, users]);

  // Trip documents keep the name captured at completion for audit history,
  // while the active approved user profile is the canonical display identity.
  // Normalize the display field before filtering so an old Google name cannot
  // hide or relabel the current user's trips.
  const identityNormalizedHistoryTrips = React.useMemo(
    () =>
      companyHistoryTrips
        .filter((trip: any) => !deletedTripIds.has(trip.id))
        .map((trip: any) => {
        const driverId = getCanonicalTripDriverId(trip);
        const canonicalName = driverId
          ? canonicalDriverNames.get(driverId)
          : undefined;
        return canonicalName
          ? { ...trip, motoristaNome: canonicalName, driverName: canonicalName }
          : trip;
      }),
    [canonicalDriverNames, companyHistoryTrips, deletedTripIds],
  );

  const toggleExpand = React.useCallback((tripId: string) => {
    setExpandedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  }, []);

  const currentCompany = companies.find((c: any) => c.id === activeCompanyId);
  // Firebase-validated Senior session is the authorization source of truth.
  // Keep the legacy flag only as a compatibility hint for the company-preview
  // flow; Firestore rules remain the final authority for every write.
  const legacySeniorAccess = sessionStorage.getItem("seniorAccess") === "true";
  const isSeniorAccess = isSeniorAuthenticated || legacySeniorAccess;
  const isAdminOrSenior = activeRole === "admin" || isSeniorAccess;

  const initialFilters = {
    simulador: currentCompany?.simulatorName || "",
    empresa: currentCompany?.companyName || "",
    motoristaId: mode === "company" ? "" : (defaultDriverId !== undefined 
      ? defaultDriverId 
      : (isAdminOrSenior ? "" : (currentUser?.id || ""))),
    motorista: mode === "company" ? "" : (defaultDriverName !== undefined 
      ? defaultDriverName 
      : (isAdminOrSenior ? "" : (currentUser?.name || ""))),
    periodoPreset: "mes", // 'todos', 'hoje', 'semana', 'mes', 'data'
    periodoInicio: "",
    periodoFim: "",
  };

  const [pendingFilters, setPendingFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);

  const needsLegacyEnrichment = React.useMemo(
    () =>
      companyHistoryTrips.some((trip: any) => {
        const vehicleName = String(trip?.veiculoNome || "").trim();
        const contractNumber = String(trip?.contratoNumero || "").trim();
        return (
          !vehicleName ||
          vehicleName === "-" ||
          !contractNumber ||
          contractNumber === "-"
        );
      }),
    [companyHistoryTrips],
  );

  // Legacy enrichment is a migration-only path. Do not scan the company's
  // legacy trips again on every fresh session when the already-confirmed
  // history shows that the enrichment fields are complete. When old records
  // still need migration, preserve the existing idle/background behavior.
  useEffect(() => {
    if (!activeCompanyId || historyLoading || !needsLegacyEnrichment) return;

    let cancelled = false;
    const runBackfill = () => {
      if (!cancelled) void TripsRepository.runBackfill(activeCompanyId);
    };
    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleApi.requestIdleCallback) {
      const idleId = idleApi.requestIdleCallback(runBackfill, { timeout: 5000 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(idleId);
      };
    }

    const timer = window.setTimeout(runBackfill, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCompanyId, historyLoading, needsLegacyEnrichment]);

  const canonicalHistoryTrips = React.useMemo(
    () =>
      filterAndSortTripHistory(identityNormalizedHistoryTrips, {
        periodPreset: embeddedJob ? "todos" : appliedFilters.periodoPreset,
        customStartDate: appliedFilters.periodoInicio,
        customEndDate: appliedFilters.periodoFim,
        driverId: embeddedJob ? undefined : appliedFilters.motoristaId,
        driverName: embeddedJob ? undefined : appliedFilters.motorista,
        embeddedJob,
      }),
    [
      appliedFilters.motorista,
      appliedFilters.motoristaId,
      appliedFilters.periodoFim,
      appliedFilters.periodoInicio,
      appliedFilters.periodoPreset,
      embeddedJob,
      identityNormalizedHistoryTrips,
      deletedTripIds,
    ],
  );

  useEffect(() => {
    setVisibleTripCount(30);
    setExpandedTrips(new Set());
  }, [
    activeCompanyId,
    appliedFilters.motorista,
    appliedFilters.motoristaId,
    appliedFilters.periodoFim,
    appliedFilters.periodoInicio,
    appliedFilters.periodoPreset,
    embeddedJob?.id,
  ]);

  const finalTrips = React.useMemo(
    () => canonicalHistoryTrips.slice(0, visibleTripCount),
    [canonicalHistoryTrips, visibleTripCount],
  );

  const historyImageScopeKey = React.useMemo(
    () =>
      [
        activeCompanyId || "",
        embeddedJob?.id || "",
        appliedFilters.motoristaId || "",
        appliedFilters.motorista || "",
        appliedFilters.periodoPreset || "",
        appliedFilters.periodoInicio || "",
        appliedFilters.periodoFim || "",
        canonicalHistoryTrips.map((trip) => String(trip.id || "")).join(","),
      ].join("|"),
    [
      activeCompanyId,
      appliedFilters.motorista,
      appliedFilters.motoristaId,
      appliedFilters.periodoFim,
      appliedFilters.periodoInicio,
      appliedFilters.periodoPreset,
      canonicalHistoryTrips,
      embeddedJob?.id,
    ],
  );

  const prefetchTripImageWindow = React.useCallback(
    (tripIndex: number) => {
      const startIndex =
        Math.max(0, Math.floor(Math.max(0, tripIndex) / TRIP_IMAGE_BATCH_SIZE)) *
        TRIP_IMAGE_BATCH_SIZE;
      const scopeKey = historyImageScopeKey;
      imagePrefetchScopeRef.current = scopeKey;

      // Warm the current batch immediately and queue one complete lookahead
      // batch shortly afterwards. This keeps the first 15 images ready without
      // opening dozens of concurrent requests during the first frame.
      [startIndex, startIndex + TRIP_IMAGE_BATCH_SIZE].forEach(
        (batchStart, batchOffset) => {
          const batch = canonicalHistoryTrips.slice(
            batchStart,
            batchStart + TRIP_IMAGE_BATCH_SIZE,
          );
          const urls = batch
            .filter((trip) => shouldLoadTripReceipt(trip))
            .map((trip) => String((trip as any).comprovanteUrl || "").trim())
            .filter(Boolean);
          if (urls.length === 0) return;

          const batchKey = `${scopeKey}:${batchStart}:${urls.join("|")}`;
          if (imagePrefetchBatchesRef.current.has(batchKey)) return;
          imagePrefetchBatchesRef.current.add(batchKey);

          const warm = () => {
            if (imagePrefetchScopeRef.current !== scopeKey) return;
            void preloadComprovanteBatch(urls);
          };

          if (batchOffset === 0 || typeof window === "undefined") {
            warm();
          } else {
            window.setTimeout(warm, 150);
          }
        },
      );
    },
    [canonicalHistoryTrips, historyImageScopeKey],
  );

  // A filter/company change starts a fresh progressive image window. The
  // first 15 receipts begin warming as soon as the filtered history exists.
  const previousImageScopeRef = React.useRef("");
  useEffect(() => {
    if (previousImageScopeRef.current === historyImageScopeKey) return;
    previousImageScopeRef.current = historyImageScopeKey;
    imagePrefetchBatchesRef.current.clear();
    prefetchTripImageWindow(0);
  }, [historyImageScopeKey, prefetchTripImageWindow]);

  useEffect(() => {
    if (typeof externalExpandAllState !== "boolean") return;
    if (externalExpandAllState) {
      setExpandedTrips(new Set(finalTrips.map((trip) => trip.id)));
    } else {
      setExpandedTrips(new Set());
    }
  }, [externalExpandAllState, finalTrips]);

  const tripNumberById = React.useMemo(
    () => buildTripNumberMap(canonicalHistoryTrips, { singleSequence: true }),
    [canonicalHistoryTrips],
  );

  const contractsById = React.useMemo(
    () => new Map((contracts || []).map((contract: any) => [String(contract.id), contract])),
    [contracts],
  );

  const plannedTotalsByJobId = React.useMemo(() => {
    const totals = new Map<string, number>();
    (jobs || []).forEach((job: any) => {
      const contract = contractsById.get(String(job.contractId));
      const configuredTotal = Number(
        job.totalDeliveries || contract?.totalDeliveries || 0,
      );
      if (job.id && configuredTotal > 0) {
        totals.set(String(job.id), configuredTotal);
      }
    });
    return totals;
  }, [contractsById, jobs]);

  const embeddedOperationTotal = React.useMemo(() => {
    if (!embeddedJob) return 0;
    const contract = contractsById.get(String(embeddedJob.contractId || ""));
    return Number(
      embeddedJob.totalDeliveries || contract?.totalDeliveries || 0,
    );
  }, [contractsById, embeddedJob]);

  const operationCounterById = React.useMemo(
    () =>
      buildTripOperationCounterMap(
        embeddedJob ? canonicalHistoryTrips : companyHistoryTrips,
        {
          singleSequence: Boolean(embeddedJob),
          plannedTotal: embeddedOperationTotal,
          plannedTotalsByJobId,
        },
      ),
    [
      canonicalHistoryTrips,
      companyHistoryTrips,
      embeddedJob,
      embeddedOperationTotal,
      plannedTotalsByJobId,
    ],
  );

  const hasMore = visibleTripCount < canonicalHistoryTrips.length;
  const loading = historyLoading;
  const { totalViagens, faturamentoTotal } = React.useMemo(
    () => summarizeTripHistory(canonicalHistoryTrips),
    [canonicalHistoryTrips],
  );

  useEffect(() => {
    const target = observerTarget.current;
    if (!target || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        setVisibleTripCount((current) =>
          Math.min(current + 30, canonicalHistoryTrips.length),
        );
      },
      { threshold: 0.1 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canonicalHistoryTrips.length, hasMore, loading]);

  // Motoristas disponíveis = membros atuais + qualquer motorista que tenha
  // viagem válida no histórico. Assim ex-membros continuam selecionáveis.
  const uniqueMotoristas = React.useMemo(() => {
    const uniqueMap = new Map<string, string>();

    const activeDriverIds = new Set(
      (allCompanyMembers || [])
        .filter((member) => {
          const hasDriverRole =
            member?.roles?.includes?.("driver");
          return (
            member?.companyId === activeCompanyId &&
            member?.status === "active" &&
            hasDriverRole &&
            member?.userId
          );
        })
        .map((member) => member.userId),
    );

    users.forEach((user) => {
      if (activeDriverIds.has(user.id) && user.name) {
        uniqueMap.set(user.id, user.name);
      }
    });

    companyHistoryTrips
      .map((trip) => normalizeTrip(trip as any))
      .filter((trip) => trip.isValid)
      .forEach((trip) => {
        const historyDriverId = getCanonicalTripDriverId(trip) || "";
        const historyDriverName = getCanonicalTripDriverName(trip) || "";

        if (
          historyDriverId &&
          historyDriverName &&
          historyDriverName !== "-" &&
          !uniqueMap.has(historyDriverId)
        ) {
          uniqueMap.set(historyDriverId, historyDriverName);
        }
      });

    return Array.from(uniqueMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeCompanyId, allCompanyMembers, companyHistoryTrips, users]);

  const companiesMap = React.useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );

  const getTripCompany = React.useCallback(
    (trip: TripRecord) =>
      companiesMap.get(getCanonicalTripCompanyId(trip) || ""),
    [companiesMap],
  );

  const getVisibleTripDistance = React.useCallback(
    (trip: TripRecord): number | undefined => {
      const tripCode = resolveTripSimulatorCode(trip as any, simulators as any[]);
      const simulatorSource = tripCode ? trip : getTripCompany(trip);

      if (!requiresTripDistance(simulatorSource as any, simulators as any[])) {
        return undefined;
      }

      const distance = readTripDistance(trip as any);
      return distance > 0 ? distance : undefined;
    },
    [getTripCompany, simulators],
  );

  const distanciaTotal = React.useMemo(() => {
    return canonicalHistoryTrips.reduce((total, trip) => {
      const distance = getVisibleTripDistance(trip as unknown as TripRecord);
      return total + (distance || 0);
    }, 0);
  }, [canonicalHistoryTrips, getVisibleTripDistance]);

  const selectedTripDistance = selectedTrip
    ? getVisibleTripDistance(selectedTrip)
    : undefined;
  const selectedTripTrailerlessSimulator = selectedTrip
    ? isTrailerlessSimulator(selectedTrip, simulators as unknown[]) ||
      isTrailerlessSimulator(getTripCompany(selectedTrip), simulators as unknown[])
    : false;
  const selectedTripTrailerName = resolveTripTrailerName({
    trip: selectedTrip,
    trailers: trailers as unknown[],
    jobs: jobs as unknown[],
    contracts: contracts as unknown[],
  });
  const selectedTripReceiptTitle = React.useMemo(
    () => getTripReceiptOriginalTitle(selectedTrip),
    [selectedTrip],
  );
  const selectedTripReceiptExpired = selectedTrip
    ? isTripReceiptExpired(selectedTrip)
    : false;
  const selectedTripIndex = React.useMemo(
    () =>
      selectedTrip
        ? canonicalHistoryTrips.findIndex((trip) => trip.id === selectedTrip.id)
        : -1,
    [canonicalHistoryTrips, selectedTrip],
  );
  const selectedTripProgress =
    canonicalHistoryTrips.length > 0 && selectedTripIndex >= 0
      ? Math.min(
          100,
          Math.max(0, ((selectedTripIndex + 1) / canonicalHistoryTrips.length) * 100),
        )
      : 0;
  // --- Image Preloading Logic ---
  useEffect(() => {
    // Notify parent when trip details are opened/closed
    if (onTripDetailsOpen) {
      onTripDetailsOpen(!!selectedTrip);
    }
    // Keep the current 15-trip window and the following 15-trip window warm.
    // This makes rapid next/previous navigation reuse decoded images rather
    // than waiting for a new request at the moment of the click.
    if (selectedTrip) {
      const idx = canonicalHistoryTrips.findIndex(t => t.id === selectedTrip.id);
      if (idx !== -1) prefetchTripImageWindow(idx);
    }
  }, [
    selectedTrip,
    canonicalHistoryTrips,
    onTripDetailsOpen,
    prefetchTripImageWindow,
  ]);

  useEffect(() => {
    setSelectedTripOptionsOpen(false);
  }, [selectedTrip?.id]);

  useEffect(() => {
    if (!selectedTripTransition || typeof window === "undefined") return;

    const timer = window.setTimeout(() => {
      setSelectedTripTransition(null);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [selectedTripTransition]);

  useEffect(() => {
    if (!selectedTripOptionsOpen) return;

    const isInsideOptions = (event: Event) => {
      const optionsElement = selectedTripOptionsRef.current;
      if (!optionsElement) return false;

      const eventPath = event.composedPath?.();
      if (eventPath?.includes(optionsElement)) return true;

      return event.target instanceof Node && optionsElement.contains(event.target);
    };

    const handleOutsidePress = (event: Event) => {
      if (!isInsideOptions(event)) {
        setSelectedTripOptionsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTripOptionsOpen(false);
      }
    };

    const pressEvents = ["pointerdown", "mousedown", "touchstart", "click"] as const;
    pressEvents.forEach((eventName) => {
      document.addEventListener(eventName, handleOutsidePress, true);
    });
    document.addEventListener("keydown", handleEscape);

    return () => {
      pressEvents.forEach((eventName) => {
        document.removeEventListener(eventName, handleOutsidePress, true);
      });
      document.removeEventListener("keydown", handleEscape);
    };
  }, [selectedTripOptionsOpen]);
  // ------------------------------

  const formatCurrency = React.useCallback((value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }, []);

  const formatDate = React.useCallback((timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date
      .toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(". de ", " ")
      .replace(" de ", " ");
  }, []);

  const formatTime = React.useCallback((timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  // Route editing is available to every authenticated user for trips they
  // are allowed to operate: the driver owns their own trip, company admins
  // manage trips in the active company, and Senior retains global access.
  // The edit flow below sends only origem/destino; valor is never exposed.
  const canEditTrip = React.useCallback((trip: TripRecord) => {
    if (!currentUser || !trip.id) return false;
    if (isSeniorAccess) return true;
    if (getCanonicalTripDriverId(trip) === currentUser.id) return true;
    return (
      activeRole === "admin" &&
      getCanonicalTripCompanyId(trip) === activeCompanyId
    );
  }, [currentUser, isSeniorAccess, activeRole, activeCompanyId]);

  const canDeleteTrip = React.useCallback((trip: TripRecord) => {
    if (!currentUser) return false;
    if (isSeniorAccess) return true;
    if (activeRole === "admin") {
      return getCanonicalTripCompanyId(trip) === activeCompanyId;
    }
    if (activeRole === "driver") {
      return getCanonicalTripDriverId(trip) === currentUser.id;
    }
    return false;
  }, [currentUser, activeRole, activeCompanyId, isSeniorAccess]);

  const canModerateTrip = React.useCallback((trip: TripRecord) => {
    if (!currentUser || !getCanonicalTripDriverId(trip)) return false;
    if (isSeniorAccess) return true;
    return (
      activeRole === "admin" &&
      getCanonicalTripCompanyId(trip) === activeCompanyId
    );
  }, [currentUser, activeRole, activeCompanyId, isSeniorAccess]);

  const canSuspendTripDriver = canModerateTrip;

  const resetModerationForm = React.useCallback(() => {
    setDeletionReasons([]);
    setSuspendWithDeletion(false);
    setSuspensionDuration(24);
    setSuspensionReasons([]);
    setSuspensionMessage("");
  }, []);

  const toggleOption = React.useCallback((
    option: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
  }, []);

  const handleEditSelectedTrip = React.useCallback(() => {
    if (!selectedTrip || !canEditTrip(selectedTrip)) return;
    setSelectedTripOptionsOpen(false);
    setEditingTrip(selectedTrip);
  }, [canEditTrip, selectedTrip]);

  const handleDeleteSelectedTrip = React.useCallback(() => {
    if (!selectedTrip || !canDeleteTrip(selectedTrip)) return;
    resetModerationForm();
    setSelectedTripOptionsOpen(false);
    setDeletingTrip(selectedTrip);
  }, [canDeleteTrip, resetModerationForm, selectedTrip]);

  const handleSuspendSelectedTripDriver = React.useCallback(() => {
    if (!selectedTrip || !canSuspendTripDriver(selectedTrip)) return;
    resetModerationForm();
    setSelectedTripOptionsOpen(false);
    setSuspendingTrip(selectedTrip);
  }, [canSuspendTripDriver, resetModerationForm, selectedTrip]);

  const handleSelectedTripStep = React.useCallback(
    (direction: -1 | 1) => {
      if (selectedTripIndex === -1) return;

      const nextIndex = selectedTripIndex + direction;
      if (nextIndex < 0 || nextIndex >= canonicalHistoryTrips.length) return;

      setSelectedTripOptionsOpen(false);
      setSelectedTripTransition((current) => ({
        direction,
        token: (current?.token || 0) + 1,
      }));
      setSelectedTrip(canonicalHistoryTrips[nextIndex] as any);
    },
    [canonicalHistoryTrips, selectedTripIndex],
  );

  const isTripSwipeIgnoredTarget = React.useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;

    return Boolean(
      target.closest(
        "button, [role='button'], a, input, textarea, select, [contenteditable='true'], [data-no-swipe='true']",
      ),
    );
  }, []);

  const confirmDeleteTrip = async () => {
    if (!deletingTrip || moderationBusy) return;

    const tripToDelete = deletingTrip;
    const isModeratedDeletion = canModerateTrip(tripToDelete);
    if (isModeratedDeletion && deletionReasons.length === 0) {
      toast.error("Selecione ao menos um motivo para excluir a viagem.");
      return;
    }
    if (
      isModeratedDeletion &&
      suspendWithDeletion &&
      suspensionReasons.length === 0
    ) {
      toast.error("Selecione ao menos um motivo para a suspensão.");
      return;
    }

    const driverId = getCanonicalTripDriverId(tripToDelete);
    const companyId = getCanonicalTripCompanyId(tripToDelete) || activeCompanyId || "";
    const tripNumber =
      tripNumberById.get(String(tripToDelete.id)) ??
      (tripToDelete as any).tripNumber ??
      (tripToDelete as any).numeroViagem;

    if (!driverId) {
      toast.error("Não foi possível identificar o motorista desta viagem.");
      return;
    }

    setModerationBusy(true);
    setDeletedTripIds((prev) => new Set(prev).add(tripToDelete.id));
    setDeletingTrip(null);
    setSelectedTrip(null);
    setSelectedTripTransition(null);

    try {
      if (isModeratedDeletion) {
        await deleteTripWithModeration({
          tripId: tripToDelete.id,
          driverId,
          companyId,
          tripNumber: String(tripNumber ?? tripToDelete.id.slice(0, 8)),
          tripDateLabel: formatDate(
            (tripToDelete as any).metricDate || getTripDisplayDate(tripToDelete as any),
          ),
          tripValue: parseTripValue(tripToDelete.valor),
          reasons: deletionReasons,
          suspension: suspendWithDeletion
            ? {
                driverId,
                companyId,
                tripId: tripToDelete.id,
                durationHours: suspensionDuration,
                reasons: suspensionReasons,
                message: suspensionMessage,
              }
            : null,
        });
      } else {
        await TripsRepository.deleteTrip(tripToDelete.id);
      }

      TripsRepository.markTripDeleted(tripToDelete.id);
      removeTripHistoryOptimistically(
        { userId: driverId, companyId },
        tripToDelete.id,
      );

      if (tripToDelete.jobId) {
        try {
          await TripsRepository.syncJobProgress(tripToDelete.jobId);
        } catch (progressError) {
          console.warn(
            "A exclusão foi concluída, mas o progresso da operação não pôde ser reconciliado imediatamente.",
            progressError,
          );
        }
      }

      toast.success(
        isModeratedDeletion
          ? suspendWithDeletion
            ? "Viagem excluída, motorista notificado e suspensão aplicada."
            : "Viagem excluída e motorista notificado."
          : "Viagem excluída com sucesso.",
      );
      resetModerationForm();
    } catch (error: any) {
      console.error("Erro ao moderar exclusão de viagem:", error);
      setDeletedTripIds((prev) => {
        const next = new Set(prev);
        next.delete(tripToDelete.id);
        return next;
      });
      toast.error(
        error?.message ||
          (isModeratedDeletion
            ? "Não foi possível excluir a viagem e concluir a notificação."
            : "Não foi possível excluir a viagem."),
      );
    } finally {
      setModerationBusy(false);
    }
  };

  const confirmDriverSuspension = async () => {
    if (!suspendingTrip || moderationBusy) return;
    if (suspensionReasons.length === 0) {
      toast.error("Selecione ao menos um motivo para a suspensão.");
      return;
    }

    const driverId = getCanonicalTripDriverId(suspendingTrip);
    const companyId =
      getCanonicalTripCompanyId(suspendingTrip) || activeCompanyId || "";
    if (!driverId) {
      toast.error("Não foi possível identificar o motorista desta viagem.");
      return;
    }

    setModerationBusy(true);
    try {
      await applyDriverSuspension({
        driverId,
        companyId,
        tripId: suspendingTrip.id,
        durationHours: suspensionDuration,
        reasons: suspensionReasons,
        message: suspensionMessage,
      });
      toast.success("Suspensão aplicada e motorista notificado.");
      setSuspendingTrip(null);
      resetModerationForm();
    } catch (error: any) {
      console.error("Erro ao suspender motorista:", error);
      toast.error(error?.message || "Não foi possível aplicar a suspensão.");
    } finally {
      setModerationBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col w-full relative",
        !embeddedJob && !isInsideAdminTab
          ? "w-full max-w-7xl mx-auto min-h-[calc(100vh-64px)] bg-gray-50/50 dark:bg-[#09090b] pb-6"
          : "pb-24" // Extra padding for the fixed footer in tab view
      )}
    >
      {/* Header Section */}
      {(!hideHeader || !hideHeaderActions) && (
      <div className={cn("flex items-start mb-4 pt-2", hideHeader ? "justify-end" : "justify-between")}>
        {!hideHeader && (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              {!isInsideAdminTab && (
                <button
                  onClick={() =>
                    handleSafeRouteBack(navigate, "/driver/profile", {
                      profileTab: "operations",
                    })
                  }
                  className="p-1 -ml-1 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <ArrowLeft size={20} className="stroke-[2.5]" />
                </button>
              )}
              <h1 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                Histórico
              </h1>
            </div>
            {!hideDriverFilter && (
              <div className="flex items-center pl-8 mt-1.5">
                <div className="flex items-center bg-transparent border border-gray-200 dark:border-gray-800 rounded-lg px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-[#1A1F26] transition-colors max-w-[160px] sm:max-w-[200px]">
                  <select
                    value={pendingFilters.motoristaId}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const selectedMotorista = uniqueMotoristas.find(m => m.id === selectedId);
                      const selectedName = selectedMotorista ? selectedMotorista.name : "";
                      setPendingFilters({ ...pendingFilters, motoristaId: selectedId, motorista: selectedName });
                      setAppliedFilters({ ...appliedFilters, motoristaId: selectedId, motorista: selectedName });
                    }}
                    className="bg-transparent text-[11px] sm:text-[12px] font-semibold text-gray-700 dark:text-gray-300 outline-none cursor-pointer pr-4 appearance-none truncate w-full"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg stroke='currentColor' fill='none' stroke-width='2' viewBox='0 0 24 24' stroke-linecap='round' stroke-linejoin='round' height='1em' width='1em' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right center",
                      backgroundSize: "12px",
                    }}
                  >
                    <option value="" className="bg-white dark:bg-[#121213]">
                      Todos os Motoristas
                    </option>
                    {uniqueMotoristas.map((m) => (
                      <option
                        key={m.id}
                        value={m.id}
                        className="bg-white dark:bg-[#121213]"
                      >
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}
        {!hideHeaderActions && (
        <div className="flex items-center gap-4 mt-1 mr-2">
          <button
            onClick={() => {
              if (expandedTrips.size > 0) {
                setExpandedTrips(new Set());
              } else {
                setExpandedTrips(new Set(finalTrips.map((t) => t.id)));
              }
            }}
            title={expandedTrips.size > 0 ? "Recolher Todos" : "Expandir Todos"}
            className="flex justify-center items-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            {expandedTrips.size > 0 ? (
              <ChevronsDownUp size={18} className="stroke-[2.5]" />
            ) : (
              <ChevronsUpDown size={18} className="stroke-[2.5]" />
            )}
          </button>
          {!embeddedJob && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex justify-center items-center transition-colors",
                showFilters
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300",
              )}
            >
              <Settings2 size={18} className="stroke-[2.5]" />
            </button>
          )}
        </div>
        )}
      </div>
      )}

      {/* Filter Card inline */}
      {showFilters && !embeddedJob && (
        <div className="bg-white dark:bg-[#121213] border border-gray-200 dark:border-gray-800 rounded-xl p-3 mb-5 shadow-sm flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">
              Período
            </label>
            <div className="flex bg-gray-100/80 dark:bg-gray-800/80 p-0.5 rounded-lg overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {[
                { id: "todos", label: "Tudo" },
                { id: "hoje", label: "Hoje" },
                { id: "semana", label: "Esta Semana" },
                { id: "mes", label: "Esse mês" },
                { id: "data", label: "Data" },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() =>
                    setPendingFilters({ ...pendingFilters, periodoPreset: preset.id })
                  }
                  className={cn(
                    "flex-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-all whitespace-nowrap",
                    pendingFilters.periodoPreset === preset.id
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {pendingFilters.periodoPreset === "data" && (
            <div className="pt-2 animate-in fade-in duration-200 flex justify-center">
              <DateRangeCalendar
                startDate={
                  pendingFilters.periodoInicio
                    ? new Date(pendingFilters.periodoInicio + "T12:00:00")
                    : null
                }
                endDate={
                  pendingFilters.periodoFim
                    ? new Date(pendingFilters.periodoFim + "T12:00:00")
                    : null
                }
                onChange={(start, end) =>
                  setPendingFilters({
                    ...pendingFilters,
                    periodoInicio: start
                      ? start.toISOString().split("T")[0]
                      : "",
                    periodoFim: end ? end.toISOString().split("T")[0] : "",
                  })
                }
              />
            </div>
          )}
          <button
            onClick={() => {
              setAppliedFilters(pendingFilters);
              setShowFilters(false);
            }}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            Aplicar Filtros
          </button>
        </div>
      )}

      {/* List Section */}
      <div
        className={cn(
          "flex flex-col gap-3 w-full",
          !embeddedJob ? "pb-12 px-0" : "pb-4 px-0"
        )}
      >
        {historyError && !loading && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-2 text-[13px] text-red-700 dark:text-red-300">
            Não foi possível sincronizar o histórico completo. Tente atualizar a página.
          </div>
        )}

        {loading && finalTrips.length === 0 ? (
          <TripHistorySkeleton />
        ) : finalTrips.length === 0 ? (
          <div className="text-center p-8 text-gray-500 bg-white dark:bg-[#121213] rounded-2xl border border-gray-100 dark:border-gray-800">
            Nenhum histórico de viagens encontrado.
          </div>
        ) : (
          <>
            {finalTrips.map((trip, index) => {
              const tripCompanyId =
                trip.empresaId ||
                (trip as any).companyId ||
                (trip as any).company_id;
              const comp = companiesMap.get(tripCompanyId);
              const tripTrailerlessSimulator =
                isTrailerlessSimulator(trip, simulators as unknown[]) ||
                isTrailerlessSimulator(comp, simulators as unknown[]);
              const isExpanded = expandedTrips.has(trip.id);

              return (
                <TripListItem
                  key={trip.id}
                  trip={trip as any}
                  comp={comp}
                  isExpanded={isExpanded}
                  toggleExpand={toggleExpand}
                  setSelectedTrip={setSelectedTrip}
                  setEditingTrip={setEditingTrip}
                  setDeletingTrip={(targetTrip) => {
                    resetModerationForm();
                    setDeletingTrip(targetTrip);
                  }}
                  setSuspendingTrip={(targetTrip) => {
                    resetModerationForm();
                    setSuspendingTrip(targetTrip);
                  }}
                  canEdit={canEditTrip(trip as any)}
                  canDelete={canDeleteTrip(trip as any)}
                  canSuspend={canSuspendTripDriver(trip as any)}
                  formatCurrency={formatCurrency}
                  formatDate={formatDate}
                  formatTime={formatTime}
                  tripNumber={tripNumberById.get(String(trip.id))}
                  operationCounterLabel={operationCounterById.get(String(trip.id))?.label}
                  distanceKm={getVisibleTripDistance(trip as any)}
                  showTrailer={!tripTrailerlessSimulator}
                  trailerName={resolveTripTrailerName({
                    trip: trip as any,
                    trailers: trailers as unknown[],
                    jobs: jobs as unknown[],
                    contracts: contracts as unknown[],
                  })}
                />
              );
            })}
          </>
        )}
        <div ref={observerTarget} className="h-10 w-full shrink-0" />
      </div>

      {/* Fixed Bottom Summary Bar */}
      {(!hideHeader || embeddedJob || isInsideAdminTab) && (
        <div className="fixed bottom-6 md:bottom-8 z-30 flex flex-col items-end pointer-events-none right-4 md:right-8 pb-[env(safe-area-inset-bottom,0px)]">
          {/* Expanded Summary Card */}
          <div
            className={cn(
              "bg-white dark:bg-[#20252D] rounded-xl border border-gray-100 dark:border-gray-700 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.15)] transition-all duration-300 overflow-hidden pointer-events-auto origin-bottom-right mb-3",
              isSummaryExpanded
                ? "max-w-sm max-h-[500px] opacity-100 scale-100"
                : "max-w-0 max-h-0 opacity-0 scale-95",
            )}
          >
            <div className="grid grid-cols-2 gap-px bg-gray-100 dark:bg-gray-800/80">
              <div className="bg-gray-50/50 dark:bg-[#20252D] p-3 sm:p-3.5 flex flex-col min-w-[120px] sm:min-w-[140px]">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                  Viagens
                </span>
                <span className="text-[16px] font-bold text-gray-900 dark:text-white leading-tight">
                  {totalViagens}
                </span>
              </div>
              <div className="bg-gray-50/50 dark:bg-[#20252D] p-3 sm:p-3.5 flex flex-col min-w-[120px] sm:min-w-[140px]">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-0.5">
                  Ganhos
                </span>
                <span className="text-[16px] font-bold text-green-600 dark:text-green-400 leading-tight">
                  {formatCurrency(faturamentoTotal)}
                </span>
              </div>
              {distanciaTotal > 0 && (
                <div className="col-span-2 bg-gray-50/50 dark:bg-[#20252D] px-3 py-2.5 flex flex-row items-center gap-3 border-t border-gray-100 dark:border-gray-800">
                  <Route size={18} className="text-gray-500" />
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
                      Distância percorrida
                    </span>
                    <span className="text-[15px] font-bold text-gray-900 dark:text-white">
                      {distanciaTotal.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Toggle Button */}
          <button
            onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
            className="w-10 h-10 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.12)] flex items-center justify-center transition-all pointer-events-auto bg-white dark:bg-[#2A313C] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#323945] border border-gray-200/60 dark:border-gray-700"
          >
            <ChevronUp
              size={20}
              className={cn(
                "transition-transform duration-300",
                isSummaryExpanded && "rotate-180",
              )}
            />
          </button>
        </div>
      )}

      {/* Modal Detailed View */}
      {selectedTrip &&
        (() => {
          const selectedTripNumber = tripNumberById.get(String(selectedTrip.id));
          const selectedOperationCounter = operationCounterById.get(String(selectedTrip.id));
          const canEditSelectedTrip = canEditTrip(selectedTrip);
          const canDeleteSelectedTrip = canDeleteTrip(selectedTrip);
          const canSuspendSelectedTrip = canSuspendTripDriver(selectedTrip);
          const canManageSelectedTrip =
            canEditSelectedTrip || canDeleteSelectedTrip || canSuspendSelectedTrip;

          const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
            if (event.touches.length !== 1) return;
            if (isTripSwipeIgnoredTarget(event.target)) return;

            const touch = event.touches[0];
            selectedTripSwipeRef.current = {
              active: true,
              startX: touch.clientX,
              startY: touch.clientY,
            };
          };

          const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
            if (!selectedTripSwipeRef.current.active || event.touches.length !== 1) return;

            const touch = event.touches[0];
            const deltaX = touch.clientX - selectedTripSwipeRef.current.startX;
            const deltaY = touch.clientY - selectedTripSwipeRef.current.startY;

            if (Math.abs(deltaY) > Math.abs(deltaX) * 1.25) {
              selectedTripSwipeRef.current.active = false;
            }
          };

          const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
            if (!selectedTripSwipeRef.current.active) return;

            const touch = event.changedTouches[0];
            selectedTripSwipeRef.current.active = false;
            if (!touch) return;

            const deltaX = touch.clientX - selectedTripSwipeRef.current.startX;
            const deltaY = touch.clientY - selectedTripSwipeRef.current.startY;

            if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
            handleSelectedTripStep(deltaX < 0 ? 1 : -1);
          };

          const handleTouchCancel = () => {
            selectedTripSwipeRef.current.active = false;
          };

          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 md:p-4 bg-gray-900/40 backdrop-blur-sm sm:pb-8">
              <div
                className="bg-white dark:bg-[#121213] w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
                style={{ touchAction: "pan-y" }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
              >
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-[#121213] z-10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                    <h3 className="font-bold text-gray-900 dark:text-white text-[14px] sm:text-[15px] shrink-0">
                      Detalhes da Viagem
                    </h3>
                    {selectedTripNumber !== undefined && (
                      <div
                        className="flex items-center justify-center min-w-8 h-8 px-2 rounded-lg bg-gray-100 dark:bg-gray-800/80 text-[12px] font-bold text-gray-700 dark:text-gray-300 border border-gray-200/70 dark:border-gray-700 shrink-0"
                        aria-label={`Viagem número ${selectedTripNumber}`}
                        title={`Viagem ${selectedTripNumber}`}
                      >
                        {selectedTripNumber.toString().padStart(2, "0")}
                      </div>
                    )}
                    {canManageSelectedTrip && (
                      <div ref={selectedTripOptionsRef} className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedTripOptionsOpen((isOpen) => !isOpen);
                          }}
                          aria-haspopup="menu"
                          aria-expanded={selectedTripOptionsOpen}
                          title="Opções da viagem"
                          className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#121213] text-gray-600 dark:text-gray-300 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {selectedTripOptionsOpen && (
                          <div
                            role="menu"
                            className="absolute left-0 top-10 z-20 w-48 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#18181b] shadow-lg"
                          >
                            {canEditSelectedTrip && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={handleEditSelectedTrip}
                                className="w-full px-3 py-2.5 text-left text-[13px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
                              >
                                <Pencil size={13} />
                                Editar rota
                              </button>
                            )}
                            {canSuspendSelectedTrip && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={handleSuspendSelectedTripDriver}
                                className="w-full px-3 py-2.5 text-left text-[13px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
                              >
                                <ShieldAlert size={13} />
                                Suspender motorista
                              </button>
                            )}
                            {canDeleteSelectedTrip && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={handleDeleteSelectedTrip}
                                className="w-full px-3 py-2.5 text-left text-[13px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                              >
                                <Trash2 size={13} />
                                Excluir
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleSelectedTripStep(-1)}
                      disabled={selectedTripIndex <= 0}
                      className={cn(
                        "p-1.5 rounded-lg border transition-colors",
                        selectedTripIndex <= 0
                          ? "text-gray-300 border-gray-100 bg-gray-50/50 dark:border-gray-800/50 dark:text-gray-700" 
                          : "text-gray-600 border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      )}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => handleSelectedTripStep(1)}
                      disabled={selectedTripIndex === -1 || selectedTripIndex >= canonicalHistoryTrips.length - 1}
                      className={cn(
                        "p-1.5 rounded-lg border transition-colors",
                        selectedTripIndex === -1 || selectedTripIndex >= canonicalHistoryTrips.length - 1
                          ? "text-gray-300 border-gray-100 bg-gray-50/50 dark:border-gray-800/50 dark:text-gray-700" 
                          : "text-gray-600 border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      )}
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setSelectedTripOptionsOpen(false);
                        setSelectedTripTransition(null);
                        setSelectedTrip(null);
                      }}
                      className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-full transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  </div>
                  {canonicalHistoryTrips.length > 1 && selectedTripIndex >= 0 && (
                    <div className="mt-3" aria-live="polite">
                      <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 transition-colors duration-200",
                            selectedTripTransition
                              ? "text-gray-700 dark:text-gray-200"
                              : "text-gray-400 dark:text-gray-500",
                          )}
                        >
                          {selectedTripTransition?.direction === -1 && <ChevronLeft size={12} />}
                          {selectedTripTransition
                            ? selectedTripTransition.direction === 1
                              ? "Avançou"
                              : "Voltou"
                            : "Navegação"}
                          {selectedTripTransition?.direction === 1 && <ChevronRight size={12} />}
                        </span>
                        <span>
                          Viagem {selectedTripIndex + 1} de {canonicalHistoryTrips.length}
                        </span>
                      </div>
                      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                            selectedTripTransition
                              ? "bg-gray-900 dark:bg-gray-100"
                              : "bg-gray-400/70 dark:bg-gray-600",
                          )}
                          style={{ width: `${selectedTripProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 sm:p-4 overflow-y-auto w-full">
                  {/* Trip General Information Compact */}
                  <div className="mb-4">
                    {/* Header Row (Company, Driver, Date) */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Building2 size={12} className="text-blue-500" />
                          <span className="text-[12px] font-bold text-gray-900 dark:text-white leading-none">
                            {selectedTrip.empresaNome}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <User size={12} className="text-gray-400" />
                          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                            {selectedTrip.motoristaNome}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                        <div className="flex items-center justify-center gap-1 bg-gray-100/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded text-[10px] font-semibold mb-1 border border-gray-200 dark:border-gray-700">
                          <CalendarIcon size={11} className="shrink-0" />
                          <span className="whitespace-nowrap">
                            {formatDate(getTripDisplayDate(selectedTrip))}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                          {formatTime(getTripDisplayDate(selectedTrip))}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col rounded-lg border border-gray-200 dark:border-gray-800/80 bg-white dark:bg-[#1A1F26] overflow-hidden shadow-sm">
                      {/* Grid details */}
                      <div className="grid grid-cols-2 relative">
                        {/* Contract */}
                        <div className="flex items-center gap-2.5 p-2 sm:p-2.5 min-w-0 bg-slate-50/50 dark:bg-[#1A1F26]">
                          <div className="w-7 h-7 rounded-md bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-500/20">
                            <FileText size={12} className="text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">
                              Contrato
                            </span>
                            <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate">
                              {selectedTrip.contratoNumero || "-"}
                            </span>
                          </div>
                        </div>

                        <div className="absolute left-[50%] top-2 bottom-2 w-px bg-gray-100 dark:bg-gray-800/60" />

                        {/* Simulator */}
                        <div className="flex items-center justify-between gap-2.5 p-2 sm:p-2.5 min-w-0 bg-slate-50/50 dark:bg-[#1A1F26]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-md bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0 border border-orange-100 dark:border-orange-500/20">
                              <Gamepad2 size={12} className="text-orange-600 dark:text-orange-400" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">
                                Simulador
                              </span>
                              <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate">
                                {displayTripSimulatorName(selectedTrip as Record<string, any>)}
                              </span>
                            </div>
                          </div>
                          {selectedOperationCounter?.label && (
                            <div className="min-w-[44px] h-7 px-2 rounded-md bg-gray-100 dark:bg-gray-800/80 text-[11px] font-bold text-gray-700 dark:text-gray-300 flex items-center justify-center shrink-0">
                              {selectedOperationCounter.label}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="w-full h-px bg-gray-100 dark:bg-gray-800/60" />

                      <div className={cn(
                        "grid relative",
                        selectedTripTrailerlessSimulator ? "grid-cols-1" : "grid-cols-2",
                      )}>
                        {/* Vehicle */}
                        <div className="flex items-center gap-2.5 p-2 sm:p-2.5 min-w-0 bg-slate-50/50 dark:bg-[#1A1F26]">
                          <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-500/20">
                            <Truck size={12} className="text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">
                              Veículo
                            </span>
                            <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate">
                              {selectedTrip.veiculoNome || "-"}
                            </span>
                          </div>
                        </div>

                        {!selectedTripTrailerlessSimulator && (
                          <>
                            <div className="absolute left-[50%] top-2 bottom-2 w-px bg-gray-100 dark:bg-gray-800/60" />

                            {/* Trailer */}
                            <div className="flex items-center gap-2.5 p-2 sm:p-2.5 min-w-0 bg-slate-50/50 dark:bg-[#1A1F26]">
                              <div className="w-7 h-7 rounded-md bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-100 dark:border-purple-500/20">
                                <Package size={12} className="text-purple-600 dark:text-purple-400" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">
                                  Reboque
                                </span>
                                <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate">
                                  {selectedTripTrailerName || "-"}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="w-full h-px bg-gray-100 dark:bg-gray-800/60" />

                      {/* Route */}
                      <div className="flex items-center justify-between p-2 sm:p-2.5 bg-slate-50/50 dark:bg-[#1A1F26]">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <MapPin size={14} className="text-green-500 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">
                              Origem
                            </span>
                            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedTrip.origem || selectedTrip.gtoOriginCompany || "-"}</span>
                          </div>
                        </div>
                        <ArrowRight size={12} className="text-gray-400 shrink-0 mx-1.5" />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <MapPin size={14} className="text-blue-500 shrink-0" />
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium leading-tight mb-[2px]">Destino</span>
                            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedTrip.destino}</span>
                          </div>
                        </div>
                      </div>

                      {selectedTripDistance !== undefined && (
                        <>
                          <div className="w-full h-px bg-gray-100 dark:bg-gray-800/60" />
                          <div className="flex items-center justify-between p-2.5 sm:p-3 bg-slate-50/50 dark:bg-[#1A1F26]">
                            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                              Distância percorrida
                            </span>
                            <span className="text-[12px] font-bold text-gray-900 dark:text-gray-100">
                              {formatTripDistance(selectedTripDistance)} km
                            </span>
                          </div>
                        </>
                      )}

                      <div className="w-full h-px bg-gray-100 dark:bg-gray-800/60" />

                      {/* Earnings */}
                      <div className="flex items-center justify-between p-2.5 sm:p-3 bg-white dark:bg-[#1A1F26]">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Valor Recebido</span>
                        <div className="flex items-center gap-1 bg-green-50 dark:bg-green-500/10 px-2 py-1.5 rounded-md border border-green-100 dark:border-transparent">
                          <DollarSign size={12} className="stroke-[3] text-green-500" />
                          <span className="text-[13px] font-bold text-gray-900 dark:text-green-400 tracking-tight">
                            {formatCurrency(selectedTrip.valor)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Receipt Image / retention notice */}
                  {selectedTrip.comprovanteUrl && (
                    <div className="mt-4 mb-2">
                      {selectedTripReceiptExpired ? (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-4 dark:border-emerald-900/40 dark:bg-emerald-500/5">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-600 dark:border-emerald-800 dark:bg-[#121213] dark:text-emerald-400">
                              <Check size={15} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-bold text-gray-900 dark:text-white">
                                Viagem verificada
                              </p>
                              <p className="mt-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                A validação desta viagem foi concluída. Após {TRIP_RECEIPT_RETENTION_DAYS} dias, o print deixa de ser necessário e é removido da consulta, enquanto os dados da viagem permanecem preservados no histórico.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
                            <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">
                              Comprovante da Viagem
                            </span>
                            {selectedTripReceiptTitle && (
                              <span className="text-[10px] sm:text-[11px] font-medium text-gray-500 dark:text-gray-400 leading-tight break-all">
                                {selectedTripReceiptTitle}
                              </span>
                            )}
                          </div>
                          <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 z-0 relative flex justify-center items-center min-h-[180px]">
                            <CachedImageViewer
                              url={selectedTrip.comprovanteUrl}
                              alt={selectedTripReceiptTitle || "Comprovante da Viagem"}
                              className="w-full h-auto object-contain max-h-[180px] cursor-pointer"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#09090b]">
                  <button
                    onClick={() => setSelectedTrip(null)}
                    className="w-full bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white font-semibold py-3 rounded-xl transition-colors"
                  >
                    Fechar Detalhes
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Driver Suspension Modal */}
      {suspendingTrip && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-gray-900/45 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#121213] w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <ShieldAlert size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-[15px]">
                    Suspender atividades
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {suspendingTrip.motoristaNome || "Motorista"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={moderationBusy}
                onClick={() => {
                  setSuspendingTrip(null);
                  resetModerationForm();
                }}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              <p className="mb-4 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                O motorista ficará impedido de solicitar trabalhos e lançar viagens até o término automático da suspensão.
              </p>
              <SuspensionFields
                duration={suspensionDuration}
                setDuration={setSuspensionDuration}
                reasons={suspensionReasons}
                toggleReason={(reason) => toggleOption(reason, setSuspensionReasons)}
                message={suspensionMessage}
                setMessage={setSuspensionMessage}
              />
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex gap-3 bg-gray-50 dark:bg-[#09090b]">
              <button
                type="button"
                disabled={moderationBusy}
                onClick={() => {
                  setSuspendingTrip(null);
                  resetModerationForm();
                }}
                className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white font-semibold py-2.5 px-3 text-[14px] rounded-xl disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={moderationBusy || suspensionReasons.length === 0}
                onClick={confirmDriverSuspension}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 px-3 text-[14px] rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {moderationBusy ? "Aplicando..." : "Aplicar suspensão"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingTrip && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-gray-900/45 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#121213] w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300 flex items-center justify-center shrink-0">
                  <Trash2 size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-[15px]">
                    Excluir viagem
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {deletingTrip.motoristaNome || "Motorista"} • {formatCurrency(parseTripValue(deletingTrip.valor))}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={moderationBusy}
                onClick={() => {
                  setDeletingTrip(null);
                  resetModerationForm();
                }}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              {canModerateTrip(deletingTrip) ? (
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Motivo da exclusão
                  </p>
                  <p className="mb-3 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                    Selecione uma ou mais opções. Os motivos serão enviados ao motorista na Central de Notificações.
                  </p>
                  <CompactMultiSelect
                    options={TRIP_DELETION_REASON_OPTIONS}
                    selected={deletionReasons}
                    onToggle={(reason) => toggleOption(reason, setDeletionReasons)}
                  />
                </div>
              ) : (
                <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                  Confirme a exclusão permanente desta viagem do seu histórico.
                </p>
              )}

              {canSuspendTripDriver(deletingTrip) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
                  <button
                    type="button"
                    onClick={() => setSuspendWithDeletion((current) => !current)}
                    className="w-full flex items-start gap-3 text-left"
                    aria-pressed={suspendWithDeletion}
                  >
                    <span
                      className={cn(
                        "mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0",
                        suspendWithDeletion
                          ? "border-amber-600 bg-amber-600 text-white"
                          : "border-amber-300 bg-white dark:border-amber-500/40 dark:bg-[#18181b]",
                      )}
                    >
                      {suspendWithDeletion && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span>
                      <span className="block text-[13px] font-bold text-amber-900 dark:text-amber-200">
                        Suspender também as atividades do motorista
                      </span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-300/80">
                        A exclusão, a notificação e a suspensão serão confirmadas na mesma operação.
                      </span>
                    </span>
                  </button>

                  {suspendWithDeletion && (
                    <div className="mt-4 border-t border-amber-200/80 pt-4 dark:border-amber-500/20">
                      <SuspensionFields
                        duration={suspensionDuration}
                        setDuration={setSuspensionDuration}
                        reasons={suspensionReasons}
                        toggleReason={(reason) => toggleOption(reason, setSuspensionReasons)}
                        message={suspensionMessage}
                        setMessage={setSuspensionMessage}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-700 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-300">
                {canModerateTrip(deletingTrip)
                  ? "A viagem será removida permanentemente. A exclusão só será concluída se o registro de auditoria e a notificação do motorista também forem gravados."
                  : "A viagem será removida permanentemente do histórico."}
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex gap-3 bg-gray-50 dark:bg-[#09090b]">
              <button
                type="button"
                disabled={moderationBusy}
                onClick={() => {
                  setDeletingTrip(null);
                  resetModerationForm();
                }}
                className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white font-semibold py-2.5 px-3 text-[14px] rounded-xl disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  moderationBusy ||
                  (canModerateTrip(deletingTrip) && deletionReasons.length === 0) ||
                  (canModerateTrip(deletingTrip) &&
                    suspendWithDeletion &&
                    suspensionReasons.length === 0)
                }
                onClick={confirmDeleteTrip}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 px-3 text-[14px] rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {moderationBusy ? "Processando..." : "Excluir viagem"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingTrip && canEditTrip(editingTrip) && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 md:p-4 bg-gray-900/40 backdrop-blur-sm sm:pb-8">
          <div className="bg-white dark:bg-[#121213] w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white text-[15px]">
                Editar Viagem
              </h3>
              <button
                onClick={() => setEditingTrip(null)}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={async (e: any) => {
                e.preventDefault();
                if (!editingTrip || !canEditTrip(editingTrip)) {
                  alert("Você não pode editar a rota desta viagem.");
                  setEditingTrip(null);
                  return;
                }
                try {
                  const form = e.target;
                                    const origem = String(form.origem.value || "").trim();
                  const destino = String(form.destino.value || "").trim();
                  if (!origem || !destino) {
                    alert("Informe origem e destino válidos.");
                    return;
                  }

                  const updateData: Record<string, unknown> = { origem, destino };
                  let optimisticUpdate: Record<string, unknown> = { origem, destino };
                  if (isSeniorAccess) {
                    const valor = parseTripValue(form.valor?.value);
                    const valorCents = Math.round(valor * 100);
                    if (!Number.isFinite(valor) || valor <= 0 || valorCents <= 0) {
                      alert("Informe um valor recebido válido.");
                      return;
                    }
                    updateData.valor = valorCents / 100;
                    updateData.valorCents = valorCents;
                    updateData.valorEditadoNoPainelSenior = true;
                    updateData.valorEditadoPor = currentUser?.id || "";
                    updateData.valorEditadoEm = new Date();
                    optimisticUpdate = {
                      ...optimisticUpdate,
                      valor: valorCents / 100,
                      valorCents,
                      valorEditadoNoPainelSenior: true,
                      valorEditadoPor: currentUser?.id || "",
                    };
                  }

                  await TripsRepository.updateTrip(editingTrip.id, updateData);
                  const driverId = getCanonicalTripDriverId(editingTrip);
                  const companyId =
                    getCanonicalTripCompanyId(editingTrip) || activeCompanyId || "";
                  if (driverId && companyId) {
                    updateTripHistoryOptimistically(
                      { userId: driverId, companyId },
                      editingTrip.id,
                      optimisticUpdate,
                    );
                  }
                  toast.success(isSeniorAccess ? "Viagem atualizada pelo painel Senior." : "Rota atualizada.");

                  setEditingTrip(null);
                } catch (error) {
                  console.error("Erro ao editar viagem:", error);
                  alert("Erro ao editar viagem. Verifique suas permissões.");
                }
              }}
            >
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                    Origem
                  </label>
                  <input
                    name="origem"
                    defaultValue={editingTrip.origem}
                    required
                    className="w-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 text-gray-900 dark:text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                    Destino
                  </label>
                  <input
                    name="destino"
                    defaultValue={editingTrip.destino}
                    required
                    className="w-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 text-gray-900 dark:text-white outline-none"
                  />
                </div>
                {isSeniorAccess && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                      Valor recebido
                    </label>
                    <input
                      name="valor"
                      type="text"
                      inputMode="decimal"
                      defaultValue={parseTripValue(editingTrip.valor).toFixed(2).replace(".", ",")}
                      required
                      className="w-full border border-amber-300 dark:border-amber-500/50 bg-amber-50/60 dark:bg-amber-500/10 rounded-xl px-3 py-2 text-gray-900 dark:text-white outline-none"
                    />
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      Edição exclusiva do painel Senior. O sistema salvará valor e centavos de forma consistente.
                    </p>
                  </div>
                )}
                <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-[12px] leading-relaxed text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                  {isSeniorAccess
                    ? "Senior pode corrigir origem, destino e valor recebido. Os demais perfis não podem alterar o valor."
                    : "Apenas origem e destino podem ser alterados. O valor recebido permanece protegido."}
                </p>
              </div>

              <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex gap-3 bg-gray-50 dark:bg-[#09090b]">
                <button
                  type="button"
                  onClick={() => setEditingTrip(null)}
                  className="flex-1 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white font-semibold py-2.5 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
