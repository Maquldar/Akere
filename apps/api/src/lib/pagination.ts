export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const pageArgs = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export function toPage<T>(items: T[], total: number, q: { page: number; pageSize: number }): Page<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
