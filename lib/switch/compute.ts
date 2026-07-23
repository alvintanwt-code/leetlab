import type {
  AssetClassDriftRow,
  ChangeKind,
  ModelHolding,
  ResolvedHolding,
  SwitchChangeRow,
  SwitchFundRow,
  SwitchMemo,
  SwitchOrder,
  SwitchOrderInRow,
  SwitchOrderOutRow,
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
        kind: delta < 0 ? "reduce" : "increase",
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
      kind: "remove",
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

  const order: Record<WhyRow["kind"], number> = {
    switch: 0,
    remove: 1,
    reduce: 2,
    add: 3,
    increase: 4,
  };
  whyRows.sort((a, b) => {
    const o = order[a.kind] - order[b.kind];
    if (o !== 0) return o;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  const unmatched = resolved.filter((h) => h.fundId == null).map((h) => h.inputName);

  const switchOrder = computeSwitchOrder({
    currentAggregated: currentWeighted,
    modelHoldings,
    totalValue,
    targetByFundId,
  });

  // Side-by-side raw tables for the SwitchResult view.
  const currentFunds: SwitchFundRow[] = currentWeighted
    .map((h) => ({
      fundId: h.fundId,
      name: h.matchedName ?? h.inputName,
      weightPct: h.weightPct,
      valueSgd: h.currentValue,
      assetClass: h.assetClass,
      isin: h.isin,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const targetFunds: SwitchFundRow[] = modelHoldings
    .map((m) => ({
      fundId: m.fundId,
      name: m.name,
      weightPct: m.weightPct,
      valueSgd: totalValue * (m.weightPct / 100),
      assetClass: m.assetClass,
      isin: m.isin,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);

  // Union changes table — include no-change rows so the advisor can show the
  // client every fund's status, not just the trades.
  const NO_CHANGE_THRESHOLD = 0.5;
  const currentByFundId = new Map<number, (typeof currentFunds)[number]>();
  for (const c of currentFunds) if (c.fundId != null) currentByFundId.set(c.fundId, c);
  const targetByFundId2 = new Map<number, (typeof targetFunds)[number]>();
  for (const t of targetFunds) targetByFundId2.set(t.fundId as number, t);

  const seen = new Set<number>();
  const changes: SwitchChangeRow[] = [];
  for (const c of currentFunds) {
    if (c.fundId == null) continue;
    seen.add(c.fundId);
    const t = targetByFundId2.get(c.fundId);
    const targetPct = t?.weightPct ?? 0;
    const delta = targetPct - c.weightPct;
    let kind: ChangeKind;
    if (Math.abs(delta) < NO_CHANGE_THRESHOLD) kind = "no_change";
    else if (delta > 0) kind = "added";
    else kind = "reduced";
    changes.push({
      fundId: c.fundId,
      name: c.name,
      currentPct: c.weightPct,
      targetPct,
      delta,
      kind,
    });
  }
  for (const t of targetFunds) {
    if (seen.has(t.fundId as number)) continue;
    changes.push({
      fundId: t.fundId,
      name: t.name,
      currentPct: 0,
      targetPct: t.weightPct,
      delta: t.weightPct,
      kind: "new",
    });
  }
  // Sort: new first, then added (largest delta first), reduced (largest drop
  // first), no-change last. Inside no-change, weight-desc so the largest
  // positions sit at the top.
  const changeOrder: Record<ChangeKind, number> = { new: 0, added: 1, reduced: 2, no_change: 3 };
  changes.sort((a, b) => {
    const o = changeOrder[a.kind] - changeOrder[b.kind];
    if (o !== 0) return o;
    if (a.kind === "no_change") return b.targetPct - a.targetPct;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

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
    switchOrder,
    currentFunds,
    targetFunds,
    changes,
  };
}

function computeSwitchOrder(args: {
  currentAggregated: CurrentAggregated[];
  modelHoldings: ModelHolding[];
  totalValue: number;
  targetByFundId: Map<number, ModelHolding>;
}): SwitchOrder {
  const { currentAggregated, modelHoldings, totalValue, targetByFundId } = args;

  const switchOut: SwitchOrderOutRow[] = [];
  for (const cur of currentAggregated) {
    const tgt = cur.fundId != null ? targetByFundId.get(cur.fundId) ?? null : null;
    const targetValue = tgt ? totalValue * (tgt.weightPct / 100) : 0;
    const sgdOut = cur.currentValue - targetValue;
    if (sgdOut <= WEIGHT_NOISE_THRESHOLD) continue;
    const pctOfFund = cur.currentValue > 0 ? (sgdOut / cur.currentValue) * 100 : 0;
    switchOut.push({
      fund: cur.matchedName ?? cur.inputName,
      sgdAmount: sgdOut,
      pctOfFund,
    });
  }
  switchOut.sort((a, b) => b.sgdAmount - a.sgdAmount);

  const totalSwitchOutSgd = switchOut.reduce((s, r) => s + r.sgdAmount, 0);

  // Switch IN = per target fund, the NET INCREASE required after netting
  // against whatever's already held of that fund. Prevents the switch form
  // from double-buying an overlapping holding: if Fund X is at 40% today
  // and target is 55%, switchIn should say "buy 15% of proceeds", not
  // "buy 55% of proceeds".
  //
  // Percentages are of totalSwitchOutSgd so the switch form's "% of
  // proceeds" convention works cleanly — the switch-in amounts sum to
  // 100% because switch-out and switch-in dollars conserve.
  const currentByFundId = new Map<number, CurrentAggregated>();
  for (const c of currentAggregated) if (c.fundId != null) currentByFundId.set(c.fundId, c);

  const netIncreases: { fund: string; sgd: number }[] = [];
  for (const tgt of modelHoldings) {
    const targetValue = totalValue * (tgt.weightPct / 100);
    const currentValue = tgt.fundId != null ? (currentByFundId.get(tgt.fundId)?.currentValue ?? 0) : 0;
    const netBuy = targetValue - currentValue;
    if (netBuy <= WEIGHT_NOISE_THRESHOLD) continue;
    netIncreases.push({ fund: tgt.name, sgd: netBuy });
  }

  const totalNetBuySgd = netIncreases.reduce((s, r) => s + r.sgd, 0) || 1;
  const switchIn: SwitchOrderInRow[] = netIncreases.map((r) => ({
    fund: r.fund,
    pct: Math.round((r.sgd / totalNetBuySgd) * 100),
  })).filter((r) => r.pct > 0);

  if (switchIn.length > 0) {
    const sum = switchIn.reduce((s, r) => s + r.pct, 0);
    if (sum !== 100) {
      let maxIdx = 0;
      for (let i = 1; i < switchIn.length; i++) {
        if (switchIn[i].pct > switchIn[maxIdx].pct) maxIdx = i;
      }
      switchIn[maxIdx].pct += 100 - sum;
    }
  }
  switchIn.sort((a, b) => b.pct - a.pct);

  return { switchOut, switchIn, totalSwitchOutSgd };
}
