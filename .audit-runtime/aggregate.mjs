// src/hooks/useRankingAggregate.ts
import { useEffect, useMemo, useState } from "react";

// functions/src/rankingCalendar.ts
var RANKING_TIME_ZONE = "America/Sao_Paulo";
var PUBLICATION_DELAY_MINUTES = 0;
var RANKING_RECENT_WINDOW_DAYS = 70;
var RANKING_HISTORY_WINDOW_DAYS = 240;
var DAY_MS = 24 * 60 * 60 * 1e3;
var calendarPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var dateTimePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});
function readPart(parts, type) {
  return Number(parts.find((part) => part.type === type)?.value || 0);
}
function getCalendarDateParts(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoDate) {
      return {
        year: Number(isoDate[1]),
        month: Number(isoDate[2]),
        day: Number(isoDate[3])
      };
    }
    const brazilianDate = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(trimmed);
    if (brazilianDate) {
      const rawYear = Number(brazilianDate[3]);
      return {
        year: rawYear < 100 ? 2e3 + rawYear : rawYear,
        month: Number(brazilianDate[2]),
        day: Number(brazilianDate[1])
      };
    }
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { year: 1970, month: 1, day: 1 };
  }
  const parts = calendarPartsFormatter.formatToParts(parsed);
  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day")
  };
}
function timeZoneOffsetMs(date) {
  const parts = dateTimePartsFormatter.formatToParts(date);
  const asUtc = Date.UTC(
    readPart(parts, "year"),
    readPart(parts, "month") - 1,
    readPart(parts, "day"),
    readPart(parts, "hour"),
    readPart(parts, "minute"),
    readPart(parts, "second")
  );
  return asUtc - date.getTime();
}
function zonedDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const first = new Date(guess.getTime() - timeZoneOffsetMs(guess));
  return new Date(guess.getTime() - timeZoneOffsetMs(first));
}
function dateKey(date) {
  const parts = getCalendarDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
function formatDatePt(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: RANKING_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}
function formatMonthPt(date) {
  const label = new Intl.DateTimeFormat("pt-BR", {
    timeZone: RANKING_TIME_ZONE,
    month: "long",
    year: "numeric"
  }).format(date);
  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}
function civilDateFromParts(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}
function partsFromCivilDate(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}
function periodBoundsForDate(date, type) {
  const parts = getCalendarDateParts(date);
  let start;
  let end;
  if (type === "semana") {
    const weekday = civilDateFromParts(parts).getUTCDay();
    const startCivil = civilDateFromParts(parts);
    startCivil.setUTCDate(startCivil.getUTCDate() - weekday);
    const startParts = partsFromCivilDate(startCivil);
    const nextCivil = new Date(startCivil.getTime() + 7 * DAY_MS);
    const nextParts = partsFromCivilDate(nextCivil);
    start = zonedDate(startParts.year, startParts.month, startParts.day);
    end = new Date(
      zonedDate(nextParts.year, nextParts.month, nextParts.day).getTime() - 1
    );
  } else {
    start = zonedDate(parts.year, parts.month, 1);
    const nextMonth = new Date(Date.UTC(parts.year, parts.month, 1));
    const nextParts = partsFromCivilDate(nextMonth);
    end = new Date(
      zonedDate(nextParts.year, nextParts.month, nextParts.day).getTime() - 1
    );
  }
  const publicationAt = new Date(
    end.getTime() + 1 + PUBLICATION_DELAY_MINUTES * 60 * 1e3
  );
  const key = type === "mes" ? `mes_${String(parts.year)}-${String(parts.month).padStart(2, "0")}` : `semana_${dateKey(start)}`;
  return {
    key,
    type,
    start,
    end,
    publicationAt,
    label: type === "mes" ? formatMonthPt(start) : `${formatDatePt(start)} a ${formatDatePt(end)}`
  };
}
function periodFromKey(type, periodKey) {
  if (type === "mes") {
    const match2 = /^mes_(\d{4})-(\d{2})$/.exec(periodKey);
    if (!match2) return null;
    const year2 = Number(match2[1]);
    const month2 = Number(match2[2]);
    if (month2 < 1 || month2 > 12) return null;
    const start = zonedDate(year2, month2, 1);
    return periodBoundsForDate(start, type);
  }
  const match = /^semana_(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const civil = new Date(Date.UTC(year, month - 1, day));
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() + 1 !== month || civil.getUTCDate() !== day || civil.getUTCDay() !== 0) {
    return null;
  }
  return periodBoundsForDate(zonedDate(year, month, day), type);
}

// src/lib/rankingPeriods.ts
var RANKING_TIME_ZONE2 = "America/Sao_Paulo";
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var RANKING_UTC_OFFSET_MS = 3 * 60 * 60 * 1e3;
var calendarPartsFormatter2 = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANKING_TIME_ZONE2,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var monthLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long"
});

// functions/src/simulatorCurrencyRegistry.ts
var SIMULATOR_CURRENCY_REGISTRY = [
  { simulator: "GTO", currency: "BRL", aliases: ["GTO", "GLOBAL TRUCK", "GLOBAL TRUCK ONLINE", "COM.STARGAMESAPPS.GTO"] },
  { simulator: "WTDS", currency: "BRL", aliases: ["WTDS", "WORLD TRUCK DRIVING SIMULATOR"] },
  { simulator: "WBDS", currency: "BRL", aliases: ["WBDS", "WORLD BUS DRIVING SIMULATOR"] },
  { simulator: "TOE3", currency: "EUR", aliases: ["TOE3", "TOE 3", "TRUCKERS OF EUROPE 3"] }
];
function normalizeSimulatorAlias(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}
var aliasIndex = /* @__PURE__ */ new Map();
for (const entry of SIMULATOR_CURRENCY_REGISTRY) {
  for (const alias of entry.aliases) aliasIndex.set(normalizeSimulatorAlias(alias), entry);
}

// src/lib/rankingAggregates.ts
var RANKING_AGGREGATE_SCHEMA_VERSION = 5;
var RANKING_AGGREGATE_RECONCILE_AFTER_MS = 60 * 60 * 1e3;
function buildRankingAggregateDocumentId(simulatorId, periodKey, schemaVersion = RANKING_AGGREGATE_SCHEMA_VERSION) {
  return `v${schemaVersion}__${encodeURIComponent(
    simulatorId.trim()
  )}__${periodKey}`.replace(/[^a-zA-Z0-9%_.~-]/g, "_").slice(0, 1400);
}
function rankingAggregateTimestampMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const timestamp = value;
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().getTime();
  }
  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1e3;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// stub:repo
var readCachedRankingAggregate = () => globalThis.__repo.cached;
var invalidateRankingAggregateCaches = () => {
};
var ensureRankingAggregate = () => {
  globalThis.__repo.calls++;
  return globalThis.__repo.ensure();
};
var readRankingAggregateFromServer = () => Promise.resolve(globalThis.__repo.cached);
var listenRankingAggregate = (s, t, k, next) => {
  globalThis.__repo.next = next;
  next(globalThis.__repo.cached);
  return () => {
  };
};

// stub:events
var onCanonicalTripUpdated = () => () => {
};

// src/hooks/useRankingAggregate.ts
var LOAD_TIMEOUT_MS = 12e3;
var IDLE_STATE = { key: "", aggregate: null, status: "idle", error: null, stale: false, refreshing: false };
function useRankingAggregate(options) {
  const simulatorId = String(options.simulatorId || "").trim(), periodKey = String(options.periodKey || "").trim();
  const periodType = options.periodType, refreshOnRead = options.refreshOnRead === true;
  const requestKey = useMemo(() => options.enabled === true && simulatorId && periodType && periodKey ? buildRankingAggregateDocumentId(simulatorId, periodKey) : "", [options.enabled, simulatorId, periodType, periodKey]);
  const initial = () => {
    if (!requestKey) return IDLE_STATE;
    const aggregate = readCachedRankingAggregate(simulatorId, periodKey);
    return { key: requestKey, aggregate, status: aggregate ? "ready" : "loading", error: null, stale: Boolean(aggregate), refreshing: true };
  };
  const [state, setState] = useState(initial);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => onCanonicalTripUpdated(() => {
    invalidateRankingAggregateCaches();
    setEpoch((value) => value + 1);
  }), []);
  useEffect(() => {
    if (!requestKey || !periodType) {
      setState(IDLE_STATE);
      return;
    }
    let active = true, stopped = false, inFlight = false, pollAttempt = 0;
    let last = state.key === requestKey ? state.aggregate : null;
    last ||= readCachedRankingAggregate(simulatorId, periodKey);
    let poll = null;
    const startedAt = Date.now();
    const period = periodFromKey(periodType, periodKey);
    const outsideRepairWindow = Boolean(period && period.start.getTime() < startedAt - RANKING_HISTORY_WINDOW_DAYS * 864e5);
    const olderThanRecent = Boolean(period && period.start.getTime() < startedAt - RANKING_RECENT_WINDOW_DAYS * 864e5);
    const publish = (aggregate, stale) => {
      if (!active) return;
      last = aggregate;
      setState({ key: requestKey, aggregate, status: "ready", error: null, stale, refreshing: stale && !stopped });
    };
    const fail = (error) => {
      if (!active) return;
      stopped = true;
      if (poll) clearTimeout(poll);
      setState({
        key: requestKey,
        aggregate: last,
        status: last ? "ready" : "unavailable",
        error: last ? null : error,
        stale: Boolean(last),
        refreshing: false,
        refreshError: error
      });
    };
    const deadline = setTimeout(() => fail(new Error("Tempo limite ao carregar a classifica\xE7\xE3o.")), LOAD_TIMEOUT_MS);
    const requestEnsure = async () => {
      if (!active || stopped || inFlight) return;
      if (outsideRepairWindow) {
        stopped = true;
        clearTimeout(deadline);
        if (last) publish(last, true);
        else setState({ key: requestKey, aggregate: null, status: "missing", error: null, stale: false, refreshing: false });
        return;
      }
      inFlight = true;
      try {
        const result = await ensureRankingAggregate(simulatorId, periodType, periodKey);
        if (!active) return;
        if (result.status === "ready" || result.status === "rebuilt") {
          const confirmed = await readRankingAggregateFromServer(simulatorId, periodKey);
          if (confirmed) {
            stopped = true;
            clearTimeout(deadline);
            if (poll) clearTimeout(poll);
            publish(confirmed, false);
            return;
          }
        }
        if (!stopped) poll = setTimeout(() => {
          void requestEnsure();
        }, Math.min(4e3, 1e3 * 2 ** pollAttempt++));
      } catch (error) {
        if (olderThanRecent && String(error?.code || "").replace(/^functions\//, "") === "failed-precondition") {
          stopped = true;
          clearTimeout(deadline);
          if (last) publish(last, true);
          else setState({ key: requestKey, aggregate: null, status: "missing", error: null, stale: false, refreshing: false });
          return;
        }
        fail(error);
      } finally {
        inFlight = false;
      }
    };
    setState({ key: requestKey, aggregate: last, status: last ? "ready" : "loading", error: null, stale: Boolean(last), refreshing: true });
    const unsubscribe = listenRankingAggregate(simulatorId, periodType, periodKey, (aggregate) => {
      if (!active) return;
      if (!aggregate) {
        void requestEnsure();
        return;
      }
      const reconciled = rankingAggregateTimestampMs(aggregate.lastReconciledAt);
      const settledHistory = Boolean(period && aggregate.complete && olderThanRecent && period.end.getTime() <= startedAt && reconciled >= period.end.getTime());
      const stale = !settledHistory && (refreshOnRead && reconciled <= startedAt || !reconciled || Date.now() - reconciled > RANKING_AGGREGATE_RECONCILE_AFTER_MS);
      publish(aggregate, stale);
      if (stale) void requestEnsure();
      else {
        stopped = true;
        clearTimeout(deadline);
        if (poll) clearTimeout(poll);
      }
    }, fail);
    if (last && refreshOnRead) void requestEnsure();
    return () => {
      active = false;
      stopped = true;
      clearTimeout(deadline);
      if (poll) clearTimeout(poll);
      unsubscribe();
    };
  }, [requestKey, simulatorId, periodType, periodKey, refreshOnRead, epoch]);
  if (!requestKey) return IDLE_STATE;
  return state.key === requestKey ? state : initial();
}
export {
  useRankingAggregate
};
