import { createHash } from 'node:crypto';

/**
 * Electronic sick-leave registry adapter (F-36). The real source is the national e-health
 * registry, which requires accreditation (KNOWN_GAPS.md). The sandbox returns a deterministic
 * sample: up to 2 electronic sick leaves in the last 30 days for employees picked from the
 * given list. The same tenant/day always yields the same numbers, so imports are idempotent.
 */
export type EsickLeaveRecord = { employeeId: string; number: string; startDate: string; endDate: string };

export interface SickLeaveRegistry {
  readonly sandbox: boolean;
  fetchRecent(input: { tenantId: string; today: string; employees: { id: string; iin: string | null }[] }): Promise<EsickLeaveRecord[]>;
}

const hashInt = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const sandbox: SickLeaveRegistry = {
  sandbox: true,
  async fetchRecent({ tenantId, today, employees }) {
    if (!employees.length) return [];
    const pool = [...employees].sort((a, b) => a.id.localeCompare(b.id));
    const out: EsickLeaveRecord[] = [];
    const used = new Set<string>();
    for (let k = 0; k < 2 && used.size < pool.length; k++) {
      let idx = hashInt(`${tenantId}:${today}:${k}`) % pool.length;
      while (used.has(pool[idx]!.id)) idx = (idx + 1) % pool.length;
      const emp = pool[idx]!;
      used.add(emp.id);
      const h = hashInt(`${emp.id}:${today}:${k}`);
      const startOffset = 3 + (h % 25); // 3…27 days ago
      const length = 3 + ((h >> 8) % 8); // 3…10 days
      const startDate = addDays(today, -startOffset);
      const endDate = addDays(startDate, length - 1);
      const number = `ЭЛН-${today.replaceAll('-', '').slice(2)}-${String(h % 1_000_000).padStart(6, '0')}`;
      out.push({ employeeId: emp.id, number, startDate, endDate: endDate > today ? today : endDate });
    }
    return out;
  },
};

let current: SickLeaveRegistry = sandbox;
export const sickLeaveRegistry = () => current;
export const setSickLeaveRegistry = (r: SickLeaveRegistry | null) => {
  current = r ?? sandbox;
};
