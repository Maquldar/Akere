import type { Tx } from './db';

/**
 * Typed in-process domain events so modules stay decoupled (e.g. onboarding fires `employee.hired`,
 * documents generates the hire order + contract). Handlers run inside the caller's transaction when `tx` is given.
 */
export type DomainEvents = {
  'employee.hired': { tenantId: string; employeeId: string; actorUserId: string; salary: number; probationMonths?: number; generateDocuments: boolean; documentIds: string[] };
  'document.completed': { tenantId: string; documentId: string };
  'document.rejected': { tenantId: string; documentId: string };
  'document.returned': { tenantId: string; documentId: string };
};

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K], tx?: Tx) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: Record<string, Handler<any>[]> = {};

export function on<K extends keyof DomainEvents>(event: K, handler: Handler<K>) {
  (handlers[event] ??= []).push(handler);
}

/** Runs handlers sequentially; a handler may push created ids into the payload (e.g. documentIds). */
export async function emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K], tx?: Tx) {
  for (const h of (handlers[event] ?? []) as Handler<K>[]) await h(payload, tx);
}
