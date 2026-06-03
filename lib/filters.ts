/**
 * Parse dashboard URL search params into typed filter values.
 * Dates are parsed as local-midnight; `to` is pushed to end-of-day so the
 * range is inclusive of the selected day.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s : undefined;
}

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

export interface ParsedFilters {
  from?: Date;
  to?: Date;
  accountId?: string;
  category?: string;
  search?: string;
}

export function parseFilters(params: RawSearchParams): ParsedFilters {
  return {
    from: parseDate(str(params.from)),
    to: parseDate(str(params.to), true),
    accountId: str(params.account),
    category: str(params.category),
    search: str(params.search),
  };
}
