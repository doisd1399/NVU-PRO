const LOCAL_TESSDATA_PATH = "/tessdata";
const REFERENCE_ASPECT_RATIO = 16 / 9;

export interface ScsTripOcrResult {
  origin: string | null;
  destination: string | null;
  distanceKm: number | null;
  value: string | null;
  sourceDistanceUnit: "km" | "mi" | null;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  minScale: number;
  maxScale: number;
}

interface ReferenceViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ATS and ETS2 share the SCS delivery-summary layout. These crops are based on
// the centered 16:9 game viewport instead of the raw screenshot width, so the
// same regions also remain usable when a wider monitor adds side space.
const ROUTE_CROP: CropRegion = {
  x: 0.19,
  y: 0.19,
  width: 0.62,
  height: 0.075,
  targetWidth: 2200,
  minScale: 2,
  maxScale: 3.2,
};

// Desktop SCS installations can use a different UI scale from screenshots
// transferred to a phone. The reward table is bottom-anchored (which is why
// value OCR kept working), while the route/status block can move vertically.
// Keep the proven mobile crop above and add a wider desktop-safe candidate.
const ROUTE_DESKTOP_CROP: CropRegion = {
  x: 0.14,
  y: 0.15,
  width: 0.72,
  height: 0.16,
  targetWidth: 2300,
  minScale: 1.8,
  maxScale: 3.2,
};

// Only the value side of the distance row is read. Keeping the label and the
// time row out of this crop materially reduces 1/7 OCR confusion in SCS fonts.
const DISTANCE_CROP: CropRegion = {
  x: 0.599,
  y: 0.249,
  width: 0.117,
  height: 0.049,
  targetWidth: 1080,
  minScale: 4,
  maxScale: 6,
};

// Wider fallback that includes the distance label and value. This is used only
// when the narrow crop misses because the desktop UI scale shifted the row.
const DISTANCE_DESKTOP_CROP: CropRegion = {
  x: 0.30,
  y: 0.20,
  width: 0.46,
  height: 0.16,
  targetWidth: 1900,
  minScale: 2,
  maxScale: 4,
};

// ATS/ETS2 repeat the driven distance in the first row of the reward table.
// Keep a dedicated confirmation crop for that row. Distance is never accepted
// from a broad summary block: the number must be read from a real distance
// field, which prevents unrelated strokes/text from becoming a leading digit.
const DISTANCE_REWARD_CROP: CropRegion = {
  x: 0.39,
  y: 0.45,
  width: 0.16,
  height: 0.045,
  targetWidth: 1100,
  minScale: 3,
  maxScale: 5.5,
};

// Last-resort read of the upper summary area. It is intentionally excluded
// from the normal path so mobile performance remains unchanged.
const SUMMARY_FALLBACK_CROP: CropRegion = {
  x: 0.10,
  y: 0.12,
  width: 0.80,
  height: 0.30,
  targetWidth: 2400,
  minScale: 1.6,
  maxScale: 3,
};

// Only the monetary column of the final Total row is read. The XP column is
// intentionally excluded so it cannot be mistaken for the trip earnings.
const VALUE_CROP: CropRegion = {
  x: 0.535,
  y: 0.715,
  width: 0.13,
  height: 0.07,
  targetWidth: 1100,
  minScale: 3,
  maxScale: 5.5,
};

const replaceLikelyDigitConfusions = (value: string): string =>
  value
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8");

const cleanOcrLine = (value: string): string =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|:;,_-]+|[\s|:;,_-]+$/g, "")
    .trim();

const cleanCityName = (value: string): string | null => {
  const cleaned = value
    .replace(/^[\s:;,.|_\-–—]+|[\s:;,.|_\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(cleaned)) return null;

  return cleaned;
};

const extractRouteFromText = (
  rawText: string,
): { origin: string | null; destination: string | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { origin: null, destination: null };

  const routePatterns = [
    /transportad[ao]\s+de\s+(.+?)\s+para\s+(.+?)(?=\s+(?:dist[âa]ncia|tempo|combust[ií]vel|recompensa|$)|[.!?])/i,
    /(?:entrega|carga|frete).*?\bde\s+(.+?)\s+para\s+(.+?)(?=\s+(?:dist[âa]ncia|tempo|combust[ií]vel|recompensa|$)|[.!?])/i,
    /(?:transported|delivered|hauled)\s+from\s+(.+?)\s+to\s+(.+?)(?=\s+(?:driven\s+distance|distance|time|fuel|reward|$)|[.!?])/i,
    /(?:delivery|cargo|job).*?\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:driven\s+distance|distance|time|fuel|reward|$)|[.!?])/i,
  ];

  for (const pattern of routePatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const origin = cleanCityName(match[1] || "");
    const destination = cleanCityName(match[2] || "");

    if (origin && destination) {
      return { origin, destination };
    }
  }

  return { origin: null, destination: null };
};

const parseIntegerLikeGameNumber = (value: string): number | null => {
  const corrected = replaceLikelyDigitConfusions(value);
  const digits = corrected.replace(/\D/g, "");
  if (!digits) return null;

  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
};

const DISTANCE_NUMBER_TOKEN =
  "[0-9OoQIl|!SsBb]+(?:[.,][0-9OoQIl|!SsBb]+)*";
const DISTANCE_UNIT_TOKEN = "km|kms|kilometers?|kilometres?|mi|miles?";

const extractDistanceFromText = (
  rawText: string,
): { distanceKm: number | null; sourceDistanceUnit: "km" | "mi" | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { distanceKm: null, sourceDistanceUnit: null };

  // Important: do not allow arbitrary whitespace inside the numeric token.
  // The previous expression accepted strings such as "4 117 km" and then
  // parseIntegerLikeGameNumber removed the space, silently turning 117 into
  // 4117. A stray glyph generated by OCR must remain a separate token.
  const directPattern = new RegExp(
    `(${DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const directMatch = text.match(directPattern);

  // A wider desktop crop may preserve the distance label but lose unrelated
  // surrounding text. The unit remains mandatory: ATS and ETS2 can both be
  // configured with different measurement systems, so the simulator name is
  // not a safe source for deciding whether an OCR number is km or miles.
  const labelledPattern = new RegExp(
    `(?:dist[âa]ncia\\s+(?:percorrida|dirigida)|driven\\s+distance|distance\\s+driven)\\s*[:\\-]?\\s*(${DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const labelledMatch = text.match(labelledPattern);

  const match = labelledMatch || directMatch;
  if (!match) return { distanceKm: null, sourceDistanceUnit: null };

  const amount = parseIntegerLikeGameNumber(match[1]);
  if (!amount || amount > 100000) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const unit = match[2].toLowerCase();
  if (unit === "mi" || unit.startsWith("mile")) {
    const converted = Math.round(amount * 1.609344 * 100) / 100;
    return { distanceKm: converted, sourceDistanceUnit: "mi" };
  }

  return { distanceKm: amount, sourceDistanceUnit: "km" };
};

const STRICT_DISTANCE_NUMBER_TOKEN = "[0-9]+(?:[.,][0-9]+)*";

/**
 * Distance autofill uses a deliberately stricter parser than the generic OCR
 * helpers. It accepts only digits that Tesseract actually returned. Letter-to-
 * digit substitutions (I->1, S->5, etc.) are not allowed here because those
 * substitutions can manufacture a number that is not visible in the image.
 */
const extractStrictDistanceFromText = (
  rawText: string,
): { distanceKm: number | null; sourceDistanceUnit: "km" | "mi" | null } => {
  const text = cleanOcrLine(rawText);
  if (!text) return { distanceKm: null, sourceDistanceUnit: null };

  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])(${STRICT_DISTANCE_NUMBER_TOKEN})\\s*(${DISTANCE_UNIT_TOKEN})\\b`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return { distanceKm: null, sourceDistanceUnit: null };

  // Do not silently drop a separate digit immediately before the token.
  // Example: if OCR returns "4 117 km", treating only the trailing "117" as
  // authoritative would also be a guess. The multi-read resolver will use a
  // clean independent read instead, or leave the field empty.
  const matchIndex = match.index ?? 0;
  const prefix = text.slice(0, matchIndex + (match[0].length - match[0].trimStart().length));
  if (/\d\s*$/.test(prefix)) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const rawAmount = match[1];
  const digits = rawAmount.replace(/[.,]/g, "");
  if (!digits || !/^\d+$/.test(digits)) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return { distanceKm: null, sourceDistanceUnit: null };
  }

  const unit = match[2].toLowerCase();
  if (unit === "mi" || unit.startsWith("mile")) {
    return {
      distanceKm: Math.round(amount * 1.609344 * 100) / 100,
      sourceDistanceUnit: "mi",
    };
  }

  return { distanceKm: amount, sourceDistanceUnit: "km" };
};

type StrictDistanceReading = {
  distanceKm: number | null;
  sourceDistanceUnit: "km" | "mi" | null;
};

const strictDistanceKey = (reading: StrictDistanceReading): string | null => {
  if (!reading.distanceKm || !reading.sourceDistanceUnit) return null;
  return `${reading.sourceDistanceUnit}:${reading.distanceKm.toFixed(2)}`;
};

/**
 * Resolve distance only from dedicated distance fields. We run two segmentation
 * modes on the upper row and two on the duplicated reward row. A value is used
 * only when independent reads agree. If OCR disagrees, autofill is skipped
 * instead of guessing or adding/removing digits.
 */
const resolveStrictDistanceReadings = (
  primarySingleText: string,
  primarySparseText: string,
  rewardSingleText: string,
  rewardSparseText: string,
): StrictDistanceReading => {
  const primary = [primarySingleText, primarySparseText]
    .map(extractStrictDistanceFromText)
    .filter((item) => Boolean(strictDistanceKey(item)));
  const reward = [rewardSingleText, rewardSparseText]
    .map(extractStrictDistanceFromText)
    .filter((item) => Boolean(strictDistanceKey(item)));

  const countByKey = (items: StrictDistanceReading[]) => {
    const counts = new Map<string, { count: number; reading: StrictDistanceReading }>();
    for (const item of items) {
      const key = strictDistanceKey(item);
      if (!key) continue;
      const current = counts.get(key);
      counts.set(key, { count: (current?.count || 0) + 1, reading: item });
    }
    return counts;
  };

  const primaryCounts = countByKey(primary);
  const rewardCounts = countByKey(reward);
  const allKeys = new Set([...primaryCounts.keys(), ...rewardCounts.keys()]);

  // When both real distance locations are readable, a candidate must appear in
  // both. Among those candidates, use only a unique best-supported value. If
  // two different numbers have equal support, there is no safe automatic fill.
  if (primary.length > 0 && reward.length > 0) {
    const candidates = [...allKeys]
      .filter((key) => primaryCounts.has(key) && rewardCounts.has(key))
      .map((key) => ({
        key,
        count: (primaryCounts.get(key)?.count || 0) + (rewardCounts.get(key)?.count || 0),
        reading: primaryCounts.get(key)!.reading,
      }))
      .sort((left, right) => right.count - left.count);

    if (candidates.length > 0) {
      const top = candidates[0];
      const tied = candidates.length > 1 && candidates[1].count === top.count;
      if (!tied) return top.reading;
    }
  }

  // If one screen location cannot be read at all, two identical segmentation
  // reads from the other location are required and that location itself must
  // not contain a competing numeric candidate.
  if (reward.length === 0 && primaryCounts.size === 1) {
    const only = [...primaryCounts.values()][0];
    if (only.count >= 2) return only.reading;
  }
  if (primary.length === 0 && rewardCounts.size === 1) {
    const only = [...rewardCounts.values()][0];
    if (only.count >= 2) return only.reading;
  }

  console.warn("[NVU SCS OCR] distance OCR disagreement; autofill skipped", {
    primarySingle: cleanOcrLine(primarySingleText),
    primarySparse: cleanOcrLine(primarySparseText),
    rewardSingle: cleanOcrLine(rewardSingleText),
    rewardSparse: cleanOcrLine(rewardSparseText),
  });
  return { distanceKm: null, sourceDistanceUnit: null };
};

const formatCurrencyInput = (integerAmount: number): string =>
  integerAmount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const extractValueFromText = (rawText: string): string | null => {
  const text = cleanOcrLine(rawText);
  if (!text) return null;

  const corrected = replaceLikelyDigitConfusions(text);
  // The SCS payout is an integer amount. Read only the first contiguous
  // numeric token so a nearby XP value can never be appended to the earnings.
  const currencyAwareMatch = corrected.match(
    /(?:[$€£]\s*)?([0-9][0-9.,]{0,18})/,
  );

  if (!currencyAwareMatch?.[1]) return null;

  const amount = parseIntegerLikeGameNumber(currencyAwareMatch[1]);
  if (!amount || amount > 1_000_000_000) return null;

  return formatCurrencyInput(amount);
};

/** Palavra lida pelo OCR, com posição no print original (px) e confiança (0–100). */
export interface ScsOcrWord {
  text: string;
  conf: number;
  x: number;
  y: number;
  /** Largura e altura da palavra no print original (px); usadas para reler só aquele número. */
  w?: number;
  h?: number;
}

export interface ScsKmRead {
  location: "header" | "reward";
  km: number;
  unit: "km" | "mi";
  conf: number;
  box: { x: number; y: number; w: number; h: number } | null;
}

export interface ScsSummaryReading {
  origin: string | null;
  destination: string | null;
  distanceKm: number | null;
  sourceDistanceUnit: "km" | "mi" | null;
  value: string | null;
  /** Leituras de km desta passada (as duas posições), para a votação com releituras. */
  kmReads?: ScsKmRead[];
}

const MONEY_WORD = /^[+\-]?[€$£]?\d[\d.,]*$/;
const CURRENCY_ONLY = /^[+\-]?[€$£]$/;
const XP_WORD = /^(?:exp|xp)$/i;

/** Agrupa palavras na mesma linha visual (mesma altura, com folga de meia linha). */
const groupWordsIntoLines = (words: ScsOcrWord[]): ScsOcrWord[][] => {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: ScsOcrWord[][] = [];
  for (const word of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - word.y) <= 6);
    if (line) line.push(word);
    else lines.push([word]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a[0].y - b[0].y);
};

const wordsToText = (line: ScsOcrWord[]): string => line.map((word) => word.text).join(" ");

const digitsOnly = (value: string): number | null => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Dinheiro de uma linha da tabela: o primeiro valor perto da coluna do Total. */
const moneyInColumn = (line: ScsOcrWord[], columnX: number, tolerance: number): number | null => {
  for (let index = 0; index < line.length; index += 1) {
    const word = line[index];
    if (Math.abs(word.x - columnX) > tolerance) continue;
    if (CURRENCY_ONLY.test(word.text)) {
      const next = line[index + 1];
      if (next && MONEY_WORD.test(next.text)) return digitsOnly(next.text);
      continue;
    }
    if (MONEY_WORD.test(word.text) && !XP_WORD.test(line[index + 1]?.text || "")) return digitsOnly(word.text);
  }
  return null;
};

/**
 * Decide o km por votação entre leituras independentes (as duas posições do print, em
 * passadas e releituras diferentes). Aceita só com 3+ votos iguais, vencedor único e, quando
 * as duas posições foram lidas, presente em ambas. Divergência sem maioria deixa o campo vazio.
 */
export const resolveKmVotes = (reads: ScsKmRead[]): { km: number; unit: "km" | "mi" } | null => {
  const groups = new Map<string, { km: number; unit: "km" | "mi"; votes: number; locations: Set<string> }>();
  for (const read of reads) {
    const key = `${read.unit}:${read.km}`;
    const group = groups.get(key) || { km: read.km, unit: read.unit, votes: 0, locations: new Set<string>() };
    group.votes += 1;
    group.locations.add(read.location);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort((a, b) => b.votes - a.votes);
  if (!ranked.length) return null;
  const [winner, runner] = ranked;
  const locations = new Set(reads.map((read) => read.location));
  if (winner.votes < 3 || (runner && runner.votes === winner.votes)) return null;
  if (locations.size > 1 && winner.locations.size < locations.size) return null;
  return { km: winner.km, unit: winner.unit };
};

/**
 * Leitura do resumo "Trabalho concluído" por PALAVRAS e posições, para telas que a leitura
 * por recortes fixos não alcança (ônibus, cores verde/laranja, outra escala de interface).
 * Segue a mesma regra rígida de antes: km só com duas leituras que concordam (ou uma bem
 * confiável) e valor só se a soma das linhas da coluna Dinheiro bater com o Total.
 */
export const parseScsSummaryWords = (words: ScsOcrWord[], frameWidth: number): ScsSummaryReading => {
  const empty: ScsSummaryReading = { origin: null, destination: null, distanceKm: null, sourceDistanceUnit: null, value: null };
  if (!words.length) return empty;
  const lines = groupWordsIntoLines(words.filter((word) => word.text.trim()));
  const result = { ...empty };

  // Rota: "66 passageiros transportados na rota de Porto para Gijón." ou o texto do caminhão.
  for (const line of lines) {
    const text = cleanOcrLine(wordsToText(line));
    const bus = text.match(/transportad[ao]s?\s+na\s+rota\s+de\s+(.+?)\s+para\s+(.+?)\.?$/i);
    const found = bus
      ? { origin: cleanCityName(bus[1]), destination: cleanCityName(bus[2]) }
      : extractRouteFromText(text);
    if (found.origin && found.destination) {
      result.origin = found.origin;
      result.destination = found.destination;
      break;
    }
  }

  // Distância: linha "618 km percorridos" e primeira linha da tabela "Recompensa base ... 618 km".
  const readKm = (line: ScsOcrWord[]) => {
    for (let index = 0; index < line.length - 1; index += 1) {
      const number = line[index];
      const unit = line[index + 1];
      if (!/^\d[\d.,]*$/.test(number.text) || !/^(?:km|kms|mi|miles?)$/i.test(unit.text)) continue;
      const amount = digitsOnly(number.text);
      if (!amount || amount > 100000) continue;
      const isMiles = /^(?:mi|miles?)$/i.test(unit.text);
      const right = Math.max(number.x + (number.w ?? 0), unit.x + (unit.w ?? 0));
      const bottom = Math.max(number.y + (number.h ?? 0), unit.y + (unit.h ?? 0));
      return {
        km: isMiles ? Math.round(amount * 1.609344 * 100) / 100 : amount,
        unit: (isMiles ? "mi" : "km") as "km" | "mi",
        conf: Math.min(number.conf, unit.conf),
        box: number.w && number.h ? { x: number.x, y: number.y, w: right - number.x, h: bottom - number.y } : null,
      };
    }
    return null;
  };
  const headerKm = lines
    .filter((line) => /percorrid|driven|dist[âa]ncia|distance/i.test(wordsToText(line)))
    .map(readKm).find(Boolean) || null;
  const rewardKm = lines
    .filter((line) => /recompensa\s+base|base\s+reward/i.test(wordsToText(line)))
    .map(readKm).find(Boolean) || null;
  result.kmReads = [
    ...(headerKm ? [{ location: "header" as const, km: headerKm.km, unit: headerKm.unit, conf: headerKm.conf, box: headerKm.box }] : []),
    ...(rewardKm ? [{ location: "reward" as const, km: rewardKm.km, unit: rewardKm.unit, conf: rewardKm.conf, box: rewardKm.box }] : []),
  ];
  if (headerKm && rewardKm) {
    if (headerKm.km === rewardKm.km && headerKm.unit === rewardKm.unit) {
      result.distanceKm = headerKm.km;
      result.sourceDistanceUnit = headerKm.unit;
    }
  } else {
    const single = headerKm || rewardKm;
    if (single && single.conf >= 90) {
      result.distanceKm = single.km;
      result.sourceDistanceUnit = single.unit;
    }
  }

  // Valor: linha "Total  € 10.595  1.026 EXP". A coluna de XP nunca entra, e a soma das
  // linhas de dinheiro acima precisa bater com o Total.
  const totalIndex = lines.findIndex((line) => /^total$/i.test(line[0].text.replace(/[^A-Za-z]/g, "")));
  if (totalIndex >= 0) {
    const totalLine = lines[totalIndex];
    const labelEnd = totalLine[0];
    const tail = totalLine.filter((word) => word !== labelEnd);
    const moneyIndex = tail.findIndex((word) => MONEY_WORD.test(word.text) && !XP_WORD.test(tail[tail.indexOf(word) + 1]?.text || ""));
    const numberWord = moneyIndex >= 0 ? tail[moneyIndex] : null;
    const symbolWord = numberWord && moneyIndex > 0 && CURRENCY_ONLY.test(tail[moneyIndex - 1].text) ? tail[moneyIndex - 1] : null;
    const total = numberWord ? digitsOnly(numberWord.text) : null;
    if (numberWord && total && total <= 1_000_000_000) {
      const columnX = (symbolWord || numberWord).x;
      const tolerance = Math.max(24, frameWidth * 0.045);
      const headerIndex = lines.findIndex((line, index) => index < totalIndex && /recompensa|reward/i.test(wordsToText(line)) && /dinheiro|money|cash/i.test(wordsToText(line)));
      const rowStart = headerIndex >= 0 ? headerIndex + 1 : 0;
      const amounts = lines.slice(rowStart, totalIndex)
        .map((line) => moneyInColumn(line, columnX, tolerance))
        .filter((amount): amount is number => amount !== null);
      const sum = amounts.reduce((acc, amount) => acc + amount, 0);
      const confident = Math.min(numberWord.conf, symbolWord?.conf ?? 100) >= 90;
      if ((amounts.length > 0 && sum === total) || (amounts.length === 0 && confident)) {
        result.value = formatCurrencyInput(total);
      }
    }
  }
  return result;
};

const decodeImage = async (file: File): Promise<DecodedImage> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch (error) {
      console.warn("[NVU SCS OCR] createImageBitmap fallback", error);
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
};

const resolveReferenceViewport = (
  width: number,
  height: number,
): ReferenceViewport => {
  const aspectRatio = width / Math.max(1, height);

  if (aspectRatio > REFERENCE_ASPECT_RATIO) {
    const viewportWidth = height * REFERENCE_ASPECT_RATIO;
    return {
      x: (width - viewportWidth) / 2,
      y: 0,
      width: viewportWidth,
      height,
    };
  }

  // Do not vertically crop 16:10 / 4:3 desktop screenshots. SCS renders its
  // delivery UI across the real game viewport in those aspect ratios; treating
  // the extra height as letterboxing shifts the route/distance rows downward.
  // This was the reason the same image worked on 16:9 mobile captures but the
  // desktop OCR could read the reward while missing or misreading distance.
  return { x: 0, y: 0, width, height };
};

const percentile = (
  histogram: Uint32Array,
  total: number,
  ratio: number,
): number => {
  const target = Math.max(1, Math.floor(total * ratio));
  let accumulated = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    accumulated += histogram[index];
    if (accumulated >= target) return index;
  }

  return 255;
};

const buildPreparedCrop = (
  decoded: DecodedImage,
  region: CropRegion,
): HTMLCanvasElement => {
  const viewport = resolveReferenceViewport(decoded.width, decoded.height);

  const sourceX = Math.round(viewport.x + viewport.width * region.x);
  const sourceY = Math.round(viewport.y + viewport.height * region.y);
  const sourceWidth = Math.max(1, Math.round(viewport.width * region.width));
  const sourceHeight = Math.max(1, Math.round(viewport.height * region.height));

  const requestedScale = region.targetWidth / sourceWidth;
  const scale = Math.min(
    region.maxScale,
    Math.max(region.minScale, requestedScale),
  );
  const border = 28;
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth + border * 2;
  canvas.height = targetHeight + border * 2;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas OCR indisponível.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    decoded.source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    border,
    border,
    targetWidth,
    targetHeight,
  );

  const imageData = context.getImageData(border, border, targetWidth, targetHeight);
  const histogram = new Uint32Array(256);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    histogram[luminance] += 1;
  }

  const totalPixels = targetWidth * targetHeight;
  const brightTextThreshold = Math.min(
    210,
    Math.max(160, percentile(histogram, totalPixels, 0.9)),
  );

  // SCS summary screens use bright text over gray/dark rows. Convert only the
  // bright glyphs to black and everything else to white for a clean OCR line.
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    const output = luminance >= brightTextThreshold ? 0 : 255;

    imageData.data[index] = output;
    imageData.data[index + 1] = output;
    imageData.data[index + 2] = output;
    imageData.data[index + 3] = 255;
  }

  context.putImageData(imageData, border, border);
  return canvas;
};

// Janela do resumo inteiro (rota, km, tabela de recompensas e Total) para a leitura por palavras.
const SUMMARY_WORDS_CROP: CropRegion = {
  x: 0.20,
  y: 0.15,
  width: 0.60,
  height: 0.70,
  targetWidth: 1800,
  minScale: 2,
  maxScale: 3,
};

/**
 * Binariza pelo canal MAIS FORTE da cor (não pelo brilho). O resumo usa texto verde
 * (dinheiro), laranja (km, nível) e branco sobre cinza escuro; o brilho do verde fica
 * abaixo do limite do recorte padrão e o texto sumia, deixando a leitura toda vazia.
 */
const buildWordsCanvas = (
  decoded: DecodedImage,
  region: CropRegion,
  threshold: number,
): { canvas: HTMLCanvasElement; sourceX: number; sourceY: number; scale: number; border: number; frameWidth: number } => {
  const viewport = resolveReferenceViewport(decoded.width, decoded.height);
  const sourceX = Math.round(viewport.x + viewport.width * region.x);
  const sourceY = Math.round(viewport.y + viewport.height * region.y);
  const sourceWidth = Math.max(1, Math.round(viewport.width * region.width));
  const sourceHeight = Math.max(1, Math.round(viewport.height * region.height));
  const scale = Math.min(region.maxScale, Math.max(region.minScale, region.targetWidth / sourceWidth));
  const border = 28;
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth + border * 2;
  canvas.height = targetHeight + border * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas OCR indisponível.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(decoded.source, sourceX, sourceY, sourceWidth, sourceHeight, border, border, targetWidth, targetHeight);

  const imageData = context.getImageData(border, border, targetWidth, targetHeight);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const strongest = Math.max(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]);
    const output = strongest >= threshold ? 0 : 255;
    imageData.data[index] = output;
    imageData.data[index + 1] = output;
    imageData.data[index + 2] = output;
    imageData.data[index + 3] = 255;
  }
  context.putImageData(imageData, border, border);
  return { canvas, sourceX, sourceY, scale, border, frameWidth: viewport.width };
};

/** Lê o resumo por palavras (com posição) e devolve só o que passou nas regras rígidas. */
const readSummaryByWords = async (
  worker: any,
  decoded: DecodedImage,
  need: { route: boolean; distance: boolean; value: boolean },
): Promise<ScsSummaryReading> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};
  const merged: ScsSummaryReading = { origin: null, destination: null, distanceKm: null, sourceDistanceUnit: null, value: null };
  const kmReads: ScsKmRead[] = [];

  for (const threshold of [120, 150]) {
    const { canvas, sourceX, sourceY, scale, border, frameWidth } = buildWordsCanvas(decoded, SUMMARY_WORDS_CROP, threshold);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK ?? "6",
      tessedit_char_whitelist: "",
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const words: ScsOcrWord[] = [];
    for (const block of result?.data?.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const word of line.words || []) {
            words.push({
              text: String(word.text || "").trim(),
              conf: Number(word.confidence) || 0,
              x: Math.round(sourceX + (word.bbox.x0 - border) / scale),
              y: Math.round(sourceY + (word.bbox.y0 - border) / scale),
              w: Math.round((word.bbox.x1 - word.bbox.x0) / scale),
              h: Math.round((word.bbox.y1 - word.bbox.y0) / scale),
            });
          }
        }
      }
    }
    const reading = parseScsSummaryWords(words, frameWidth);
    if ((globalThis as { __NVU_OCR_DEBUG?: boolean }).__NVU_OCR_DEBUG) console.log("[NVU SCS OCR] words dump", JSON.stringify(words.map((w) => [w.text, w.conf, w.x, w.y])));
    if (!merged.origin && reading.origin) { merged.origin = reading.origin; merged.destination = reading.destination; }
    if (!merged.distanceKm && reading.distanceKm) { merged.distanceKm = reading.distanceKm; merged.sourceDistanceUnit = reading.sourceDistanceUnit; }
    if (!merged.value && reading.value) merged.value = reading.value;
    kmReads.push(...(reading.kmReads || []));
    console.log("[NVU SCS OCR] words pass", { threshold, words: words.length, ...reading });
    const done = (!need.route || merged.origin) && (!need.distance || merged.distanceKm) && (!need.value || merged.value);
    if (done) break;
  }

  // Km: se as duas posições divergiram (ex.: 618 no topo e 616 na tabela), relê só aqueles
  // números, bem ampliados, e decide por votação. Nunca inventa dígito: empate = campo vazio.
  if (need.distance && !merged.distanceKm && kmReads.length) {
    const viewport = resolveReferenceViewport(decoded.width, decoded.height);
    const votes: ScsKmRead[] = [...kmReads];
    const seen = new Set<string>();
    for (const read of kmReads) {
      if (!read.box) continue;
      const boxKey = `${read.location}:${read.box.x}:${read.box.y}`;
      if (seen.has(boxKey)) continue;
      seen.add(boxKey);
      const pad = Math.max(3, Math.round(read.box.h * 0.35));
      const region: CropRegion = {
        x: (read.box.x - pad - viewport.x) / viewport.width,
        y: (read.box.y - pad - viewport.y) / viewport.height,
        width: (read.box.w + pad * 2) / viewport.width,
        height: (read.box.h + pad * 2) / viewport.height,
        targetWidth: 900,
        minScale: 4,
        maxScale: 8,
      };
      for (const threshold of [120, 150, 100]) {
        const crop = buildWordsCanvas(decoded, region, threshold);
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE ?? "7",
          tessedit_char_whitelist: "0123456789., kmKMilesILES",
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const text = (await worker.recognize(crop.canvas))?.data?.text || "";
        const strict = extractStrictDistanceFromText(text);
        if (strict.distanceKm && strict.sourceDistanceUnit) {
          votes.push({ location: read.location, km: strict.distanceKm, unit: strict.sourceDistanceUnit, conf: 100, box: read.box });
        }
      }
    }
    const decided = resolveKmVotes(votes);
    console.log("[NVU SCS OCR] km votes", votes.map((v) => `${v.location}:${v.km}${v.unit}`), decided);
    if (decided) { merged.distanceKm = decided.km; merged.sourceDistanceUnit = decided.unit; }
  }
  return merged;
};

const ocrLogger = (message: { status: string; progress?: number }) => {
  if (message.status === "recognizing text") {
    console.log(
      "[NVU SCS OCR] progress",
      Math.round((message.progress || 0) * 100),
    );
  }
};

const createLocalWorker = async () => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const createWorker = Tesseract.createWorker || tesseractModule.createWorker;

  if (typeof createWorker !== "function") {
    throw new Error("Worker OCR indisponível.");
  }

  try {
    return await createWorker("eng", 1, {
      langPath: LOCAL_TESSDATA_PATH,
      logger: ocrLogger,
    });
  } catch (localModelError) {
    // Compatibility fallback only. Normal deployments use the bundled model,
    // keeping OCR local and without a paid OCR API.
    console.warn("[NVU SCS OCR] local model fallback", localModelError);
    return createWorker("eng", 1, { logger: ocrLogger });
  }
};

const recognizeSingleLine = async (
  worker: any,
  image: HTMLCanvasElement,
  whitelist = "",
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE ?? "7",
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

const recognizeSparseDistance = async (
  worker: any,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT ?? "11",
    // Do not offer letter aliases for the numeric part. If a digit cannot be
    // recognized as a digit, that read must not be used for automatic fill.
    tessedit_char_whitelist: "0123456789., kmKMilesILES",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

const recognizeTextBlock = async (
  worker: any,
  image: HTMLCanvasElement,
): Promise<string> => {
  const tesseractModule: any = await import("tesseract.js");
  const Tesseract: any = tesseractModule.default || tesseractModule;
  const PSM = Tesseract.PSM || tesseractModule.PSM || {};

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT ?? PSM.AUTO ?? "11",
    tessedit_char_whitelist: "",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(image);
  return result?.data?.text || "";
};

export async function extractScsTripData(
  file: File,
  simulatorCode: string,
): Promise<ScsTripOcrResult | null> {
  if (simulatorCode !== "ATS" && simulatorCode !== "ETS2") {
    return null;
  }

  let decoded: DecodedImage | null = null;
  let worker: any = null;

  try {
    console.log("[NVU SCS OCR] start", simulatorCode, file.name, file.size);
    decoded = await decodeImage(file);

    if (decoded.width < 640 || decoded.height < 360) {
      console.warn("[NVU SCS OCR] image too small", decoded.width, decoded.height);
      return null;
    }

    const routeCanvas = buildPreparedCrop(decoded, ROUTE_CROP);
    const distanceCanvas = buildPreparedCrop(decoded, DISTANCE_CROP);
    const rewardDistanceCanvas = buildPreparedCrop(decoded, DISTANCE_REWARD_CROP);
    const valueCanvas = buildPreparedCrop(decoded, VALUE_CROP);

    worker = await createLocalWorker();

    const routeText = await recognizeSingleLine(worker, routeCanvas);
    const distanceText = await recognizeSingleLine(
      worker,
      distanceCanvas,
      "0123456789., kmKMilesILES",
    );
    const distanceSparseText = await recognizeSparseDistance(worker, distanceCanvas);
    const distanceRewardText = await recognizeSingleLine(
      worker,
      rewardDistanceCanvas,
      "0123456789., kmKMilesILES",
    );
    const distanceRewardSparseText = await recognizeSparseDistance(
      worker,
      rewardDistanceCanvas,
    );
    const valueText = await recognizeSingleLine(
      worker,
      valueCanvas,
      "0123456789OoQIl|!SsBb.,$€£ ",
    );

    let route = extractRouteFromText(routeText);
    // Distance autofill is intentionally strict. Broad text blocks are never
    // allowed to supply a number because they can hallucinate a leading glyph
    // (the reported 117 -> 4117 failure).
    let distance = resolveStrictDistanceReadings(
      distanceText,
      distanceSparseText,
      distanceRewardText,
      distanceRewardSparseText,
    );
    let value = extractValueFromText(valueText);
    let desktopRouteText = "";
    let summaryFallbackText = "";

    // Preserve the route fallback for desktop UI scaling. Distance is never
    // recovered from this broad block because broad OCR is exactly where stray
    // leading digits can be introduced.
    if (!route.origin || !route.destination) {
      const summaryCanvas = buildPreparedCrop(decoded, SUMMARY_FALLBACK_CROP);
      summaryFallbackText = await recognizeTextBlock(worker, summaryCanvas);

      if (!route.origin || !route.destination) {
        const summaryRoute = extractRouteFromText(summaryFallbackText);
        if (summaryRoute.origin && summaryRoute.destination) route = summaryRoute;
      }
    }

    // Route may use broad fallbacks because it is text. Distance may not: if
    // the dedicated upper/reward rows do not agree, the field remains empty so
    // the app never invents or silently modifies a trip number.
    if (!route.origin || !route.destination) {
      const desktopRouteCanvas = buildPreparedCrop(decoded, ROUTE_DESKTOP_CROP);
      desktopRouteText = await recognizeTextBlock(worker, desktopRouteCanvas);
      const desktopRoute = extractRouteFromText(desktopRouteText);
      if (desktopRoute.origin && desktopRoute.destination) route = desktopRoute;
    }

    // Telas que os recortes fixos não alcançam (resumo do ônibus, texto verde/laranja, outra
    // escala de interface): leitura por palavras. Só completa o que ficou vazio, e passa pelas
    // mesmas regras rígidas (km com duas leituras; valor só se a soma das linhas bater).
    const needRoute = !route.origin || !route.destination;
    const needDistance = !distance.distanceKm;
    const needValue = !value;
    if (needRoute || needDistance || needValue) {
      try {
        const byWords = await readSummaryByWords(worker, decoded, { route: needRoute, distance: needDistance, value: needValue });
        if (needRoute && byWords.origin && byWords.destination) route = { origin: byWords.origin, destination: byWords.destination };
        if (needDistance && byWords.distanceKm) distance = { distanceKm: byWords.distanceKm, sourceDistanceUnit: byWords.sourceDistanceUnit };
        if (needValue && byWords.value) value = byWords.value;
      } catch (wordsError) {
        console.warn("[NVU SCS OCR] words fallback failed", wordsError);
      }
    }

    console.log("[NVU SCS OCR] text", {
      simulatorCode,
      route: cleanOcrLine(routeText),
      distanceSingle: cleanOcrLine(distanceText),
      distanceSparse: cleanOcrLine(distanceSparseText),
      rewardDistanceSingle: cleanOcrLine(distanceRewardText),
      rewardDistanceSparse: cleanOcrLine(distanceRewardSparseText),
      value: cleanOcrLine(valueText),
      desktopRoute: cleanOcrLine(desktopRouteText),
      summaryFallback: cleanOcrLine(summaryFallbackText),
    });
    console.log("[NVU SCS OCR] result", {
      ...route,
      ...distance,
      value,
    });

    return {
      origin: route.origin,
      destination: route.destination,
      distanceKm: distance.distanceKm,
      sourceDistanceUnit: distance.sourceDistanceUnit,
      value,
    };
  } catch (error) {
    console.error("[NVU SCS OCR] error", error);
    return null;
  } finally {
    decoded?.cleanup();
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError) {
        console.warn("[NVU SCS OCR] worker terminate", terminateError);
      }
    }
  }
}

export const __scsOcrTestUtils = {
  parseScsSummaryWords,
  resolveKmVotes,
  extractRouteFromText,
  extractDistanceFromText,
  extractStrictDistanceFromText,
  resolveStrictDistanceReadings,
  extractValueFromText,
  replaceLikelyDigitConfusions,
};
