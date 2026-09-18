export interface OperationalPerformanceStats {
  viagens: number;
  ganhos: number;
}

export interface OperationalPerformanceScores {
  ritmoOperacionalScore: number;
  viagensScore: number;
  ganhosScore: number;
}

const clampScore = (value: number) =>
  Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));

const numericValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/**
 * Cálculo tradicional usado no perfil corporativo (sempre global).
 * Mantido sem mudança para não alterar a regra empresarial já validada.
 */
export function calculateOperationalScores(
  current: OperationalPerformanceStats,
  competitors: OperationalPerformanceStats[],
): OperationalPerformanceScores {
  const pool = competitors.length > 0 ? competitors : [current];
  const maxViagens = Math.max(0, ...pool.map((item) => numericValue(item.viagens)));
  const maxGanhos = Math.max(0, ...pool.map((item) => numericValue(item.ganhos)));

  const scoreFor = (item: OperationalPerformanceStats) => {
    const viagensScore = maxViagens > 0
      ? clampScore((numericValue(item.viagens) / maxViagens) * 100)
      : 0;
    const ganhosScore = maxGanhos > 0
      ? clampScore((numericValue(item.ganhos) / maxGanhos) * 100)
      : 0;

    return {
      viagensScore,
      ganhosScore,
      composite: (viagensScore + ganhosScore) / 2,
    };
  };

  const currentScores = scoreFor(current);
  const bestComposite = Math.max(0, ...pool.map((item) => scoreFor(item).composite));
  const hasActivity = numericValue(current.viagens) > 0 || numericValue(current.ganhos) > 0;

  return {
    ritmoOperacionalScore:
      hasActivity && bestComposite > 0
        ? clampScore((currentScores.composite / bestComposite) * 100)
        : 0,
    viagensScore: currentScores.viagensScore,
    ganhosScore: currentScores.ganhosScore,
  };
}

/**
 * Score de posição dentro do universo selecionado pelo motorista.
 * O líder do escopo recebe 100 e o último recebe 0 quando há concorrência.
 */
function positionScore(currentValue: number, values: number[]) {
  const normalizedValues = values.map(numericValue);
  const current = numericValue(currentValue);
  if (current <= 0 || normalizedValues.length === 0) return 0;

  const maxValue = Math.max(...normalizedValues);
  if (current >= maxValue) return 100;
  if (normalizedValues.length === 1) return 100;

  const greater = normalizedValues.filter((value) => value > current).length;
  const equal = normalizedValues.filter((value) => value === current).length;
  const averageRank = greater + (equal + 1) / 2;
  return clampScore(
    ((normalizedValues.length - averageRank) / (normalizedValues.length - 1)) * 100,
  );
}

function leaderRatio(currentValue: number, values: number[]) {
  const current = numericValue(currentValue);
  const maxValue = Math.max(0, ...values.map(numericValue));
  return maxValue > 0 ? clampScore((current / maxValue) * 100) : 0;
}

/**
 * Cálculo específico do motorista para o seletor Interno/Global.
 *
 * A população recebida já está filtrada pelo período e pelo escopo. Cada
 * indicador combina a distância para o líder (60%) com a posição relativa
 * no universo selecionado (40%). Isso faz Ritmo, Viagens, Ganhos e Índice
 * reagirem à troca entre equipe e simulador, sem alterar os valores brutos.
 */
export function calculateScopeAwareOperationalScores(
  current: OperationalPerformanceStats,
  competitors: OperationalPerformanceStats[],
): OperationalPerformanceScores {
  const pool = competitors.length > 0 ? competitors : [current];
  const currentTrips = numericValue(current.viagens);
  const currentEarnings = numericValue(current.ganhos);
  const tripsValues = pool.map((item) => numericValue(item.viagens));
  const earningsValues = pool.map((item) => numericValue(item.ganhos));
  const hasActivity = currentTrips > 0 || currentEarnings > 0;

  if (!hasActivity) {
    return {
      ritmoOperacionalScore: 0,
      viagensScore: 0,
      ganhosScore: 0,
    };
  }

  const viagensScore = clampScore(
    leaderRatio(currentTrips, tripsValues) * 0.6 +
      positionScore(currentTrips, tripsValues) * 0.4,
  );
  const ganhosScore = clampScore(
    leaderRatio(currentEarnings, earningsValues) * 0.6 +
      positionScore(currentEarnings, earningsValues) * 0.4,
  );

  const maxTrips = Math.max(0, ...tripsValues);
  const maxEarnings = Math.max(0, ...earningsValues);
  const compositeValues = pool.map((item) => {
    const tripsRatio = maxTrips > 0 ? numericValue(item.viagens) / maxTrips : 0;
    const earningsRatio = maxEarnings > 0 ? numericValue(item.ganhos) / maxEarnings : 0;
    return ((tripsRatio + earningsRatio) / 2) * 100;
  });
  const currentComposite =
    (((maxTrips > 0 ? currentTrips / maxTrips : 0) +
      (maxEarnings > 0 ? currentEarnings / maxEarnings : 0)) /
      2) *
    100;

  const ritmoOperacionalScore = clampScore(
    leaderRatio(currentComposite, compositeValues) * 0.6 +
      positionScore(currentComposite, compositeValues) * 0.4,
  );

  return {
    ritmoOperacionalScore,
    viagensScore,
    ganhosScore,
  };
}
