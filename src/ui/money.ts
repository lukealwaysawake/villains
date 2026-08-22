export interface BbDollarRecord {
  bbDelta: number;
  bigBlindDollars?: number;
}

export function formatSignedDollars(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  const body = Math.abs(rounded) % 1 === 0
    ? Math.abs(rounded).toFixed(0)
    : Math.abs(rounded).toFixed(2).replace(/0$/, "");
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}$${body}`;
}

export function bbToDollars(valueBb: number, bigBlindDollars: number | undefined): number | undefined {
  if (bigBlindDollars === undefined || !Number.isFinite(bigBlindDollars)) return undefined;
  return valueBb * bigBlindDollars;
}

export function sumKnownDollars(records: BbDollarRecord[]): { value: number; tracked: number; complete: boolean } {
  let value = 0;
  let tracked = 0;
  for (const record of records) {
    const dollars = bbToDollars(record.bbDelta, record.bigBlindDollars);
    if (dollars === undefined) continue;
    value += dollars;
    tracked += 1;
  }
  return { value, tracked, complete: tracked === records.length };
}

export function dollarRateStatus(
  dollarDelta: number,
  dollarHands: number,
  totalHands: number,
): { value: number | undefined; complete: boolean; label: string } {
  const tracked = Math.max(0, dollarHands);
  const complete = tracked === Math.max(0, totalHands);
  return {
    value: tracked > 0 ? (dollarDelta / tracked) * 100 : undefined,
    complete,
    label: tracked > 0 && !complete ? `확인된 $/100 · ${tracked}핸드` : "$/100핸드",
  };
}
