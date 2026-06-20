import type {
  AssetClassDriftRow,
  ModelHolding,
  ResolvedHolding,
  SwitchMemo,
  WhyRow,
} from "./types";

const UNCLASSIFIED = "Unclassified";
const WEIGHT_NOISE_THRESHOLD = 0.5;

function weightedAvg<T>(
  items: T[],
  weight: (t: T) => number,
  value: (t: T) => number | null | undefined,
): number | null {
  let totalW = 0;
  let sum = 0;
  for (const i of items) {
    const w = weight(i);
    const v = value(i);
    if (w > 0 && v != null && Number.isFinite(v)) {
      totalW += w;
      sum += w * v;
    }
  }
  return totalW > 0 ? sum / totalW : null;
}

function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const i of items) {
    const k = key(i);
    const arr = m.get(k) ?? [];
    arr.push(i);
    m.set(k, arr);
  }
  return m;
}

type CurrentWeighted = ResolvedHolding & { weightPct: number };
type CurrentAggregated = CurrentWeighted & { rowCount: number };

function fundKey(h: ResolvedHolding): string {
  return h.fundId != null
    ? `id:${h.fundId}`
    : `name:${(h.matchedName ?? h.inputName).trim().toLowerCase()}`;
}

function aggregateCurrent(weighted: CurrentWeighted[]): CurrentAggregated[] {
  const byKey = new Map<string, CurrentAggregated>();
  for (const h of weighted) {
    const key = fundKey(h);
    const existing = byKey.get(key);
    if (existing) {
      existing.weightPct += h.weightPct;
      existing.currentValue += h.currentValue;
      if (h.units != null) {
        existing.units = (existing.units ?? 0) + h.units;
      }
      existing.rowCount += 1;
    } else {
      byKey.set(key, { ...h, rowCount: 1 });
    }
  }
  return Array.from(byKey.values());
}

export function computeMemo(args: {
  resolved: ResolvedHolding[];
  modelHoldings: ModelHolding[];
  modelName: string;
  modelCategory: string;
  platformLabel: string;
  proposedDate: string;
  proposedXray: SwitchMemo["proposedXray"];
}): SwitchMemo {
  const { resolved, modelHoldings, modelName, modelCategory, platformLabel, proposedDate, proposedXray } = args;

  const totalValue = resolved.reduce((s, h) => s + h.currentValue, 0);

  const currentPerRow: CurrentWeighted[] = resolved.map((h) => ({
    ...h,
    weightPct: totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0,
  }));

  // Same fund held across multiple accounts → one position for drift / why-row math.
  const currentWeighted = aggregateCurrent(currentPerRow);
  const mergedRowCount = resolved.length - currentWeighted.length;

  const currentExpReturn = weightedAvg(currentWeighted, (h) => h.weightPct, (h) => h.ann3y);
  const currentExpRisk = weightedAvg(currentWeighted, (h) => h.weightPct, (h) => h.risk);
  const currentOcf = weightedAvg(currentWeighted, (h) => h.weightPct, (h) => h.expenseRatio);

  const targetExpReturn = weightedAvg(modelHoldings, (h) => h.weightPct, (h) => h.ann3y);
  const targetExpRisk = weightedAvg(modelHoldings, (h) => h.weightPct, (h) => h.risk);
  const targetOcf = weightedAvg(modelHoldings, (h) => h.weightPct, (h) => h.expenseRatio);

  const currentByClass = groupBy(currentWeighted, (h) => h.assetClass ?? UNCLASSIFIED);
  const targetByClass = groupBy(modelHoldings, (h) => h.assetClass ?? UNCLASSIFIED);
  const allClasses = new Set<string>([...currentByClass.keys(), ...targetByClass.keys()]);

  const assetClassDrift: AssetClassDriftRow[] = [];
  for (const cls of allClasses) {
    const cur = (currentByClass.get(cls) ?? []).reduce((s, h) => s + h.weightPct, 0);
    const tgt = (targetByClass.get(cls) ?? []).reduce((s, h) => s + h.weightPct, 0);
    assetClassDrift.push({ assetClass: cls, currentPct: cur, targetPct: tgt, delta: tgt - cur });
  }
  assetClassDrift.sort(
    (a, b) => Math.max(b.currentPct, b.targetPct) - Math.max(a.currentPct, a.targetPct),
  );

  const targetByFundId = new Map<number, ModelHolding>();
  for (const h of modelHoldings) targetByFundId.set(h.fundId, h);

  const whyRows: WhyRow[] = [];
  const usedCurrent = new Set<string>();
  const usedTarget = new Set<number>();

  for (const cur of currentWeighted) {
    if (cur.fundId != null && targetByFundId.has(cur.fundId)) {
      const tgt = targetByFundId.get(cur.fundId)!;
      const delta = tgt.weightPct - cur.weightPct;
      usedCurrent.add(fundKey(cur));
      usedTarget.add(cur.fundId);
      if (Math.abs(delta) < WEIGHT_NOISE_THRESHOLD) continue;
      whyRows.push({
        kind: delta < 0 ? "reduce" : "add",
        fromFund: cur.matchedName ?? cur.inputName,
        toFund: cur.matchedName ?? cur.inputName,
        fromPct: cur.weightPct,
        toPct: tgt.weightPct,
        delta,
        assetClass: cur.assetClass,
        rationale: "",
      });
    }
  }

  const unpairedCurrent = currentWeighted.filter((h) => !usedCurrent.has(fundKey(h)));
  for (const cur of unpairedCurrent) {
    const candidates = modelHoldings.filter(
      (t) => !usedTarget.has(t.fundId) && t.assetClass === cur.assetClass && cur.assetClass != null,
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.weightPct - a.weightPct);
    const tgt = candidates[0];
    whyRows.push({
      kind: "switch",
      fromFund: cur.matchedName ?? cur.inputName,
      toFund: tgt.name,
      fromPct: cur.weightPct,
      toPct: tgt.weightPct,
      delta: tgt.weightPct - cur.weightPct,
      assetClass: cur.assetClass,
      rationale: "",
    });
    usedCurrent.add(fundKey(cur));
    usedTarget.add(tgt.fundId);
  }

  for (const cur of currentWeighted) {
    if (usedCurrent.has(fundKey(cur))) continue;
    whyRows.push({
      kind: "reduce",
      fromFund: cur.matchedName ?? cur.inputName,
      toFund: null,
      fromPct: cur.weightPct,
      toPct: 0,
      delta: -cur.weightPct,
      assetClass: cur.assetClass,
      rationale: "",
    });
  }

  for (const tgt of modelHoldings) {
    if (usedTarget.has(tgt.fundId)) continue;
    whyRows.push({
      kind: "add",
      fromFund: null,
      toFund: tgt.name,
      fromPct: 0,
      toPct: tgt.weightPct,
      delta: tgt.weightPct,
      assetClass: tgt.assetClass,
      rationale: "",
    });
  }

  const order = { switch: 0, reduce: 1, add: 2 } as const;
  whyRows.sort((a, b) => {
    const o = order[a.kind] - order[b.kind];
    if (o !== 0) return o;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  const unmatched = resolved.filter((h) => h.fundId == null).map((h) => h.inputName);

  return {
    platformLabel,
    modelName,
    modelCategory,
    proposedDate,
    delta: {
      expReturn:
        currentExpReturn != null && targetExpReturn != null
          ? targetExpReturn - currentExpReturn
          : null,
      expRisk:
        currentExpRisk != null && targetExpRisk != null ? targetExpRisk - currentExpRisk : null,
      ocf: currentOcf != null && targetOcf != null ? targetOcf - currentOcf : null,
    },
    current: {
      expReturn: currentExpReturn,
      expRisk: currentExpRisk,
      ocf: currentOcf,
      holdingsCount: currentWeighted.length,
      totalValue,
      mergedRowCount,
    },
    target: {
      expReturn: targetExpReturn,
      expRisk: targetExpRisk,
      ocf: targetOcf,
      holdingsCount: modelHoldings.length,
    },
    assetClassDrift,
    whyRows,
    unmatched,
    proposedXray,
  };
}
