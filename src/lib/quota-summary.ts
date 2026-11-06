export type LimitSummary = {
  metric: string;
  quantity: number;
  limitQuantity: number;
  usagePercent: number;
};

export type QuotaSummary = {
  state: "OK" | "WARN" | "THROTTLED";
  usagePercent: number;
  limits: LimitSummary[];
};

export function usagePercentOf(
  quantity: number,
  limitQuantity: number,
): number {
  if (!limitQuantity || limitQuantity <= 0) return 0;
  return Math.floor((quantity / limitQuantity) * 100);
}

export function summarizeLimits(limits: LimitSummary[]): QuotaSummary {
  const usagePercent = limits.length
    ? Math.max(...limits.map((limit) => limit.usagePercent))
    : 0;
  const state: QuotaSummary["state"] =
    usagePercent >= 100 ? "THROTTLED" : usagePercent >= 80 ? "WARN" : "OK";
  return { state, usagePercent, limits };
}
