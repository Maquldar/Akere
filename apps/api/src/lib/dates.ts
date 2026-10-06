/** Date-only helpers. All @db.Date values are handled as UTC midnight to avoid TZ drift. */
export const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
export const fromDateStr = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const todayUtc = () => fromDateStr(new Date().toISOString().slice(0, 10));
export const daysBetweenInclusive = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
export const optDateStr = (d: Date | null | undefined) => (d ? toDateStr(d) : null);
