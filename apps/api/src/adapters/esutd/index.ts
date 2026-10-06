import { sha256 } from '../../lib/crypto';

/**
 * ЕСУТД adapter (F-24). The real service (Единая система учёта трудовых договоров, enbek.kz) requires an ЭЦП-signed
 * SOAP integration that is out of scope (KNOWN_GAPS); this sandbox validates the payload like the real API does and
 * answers deterministically: ~5 % of submissions fail (hash of document id + attempt), the rest get an external id.
 * Replacing `esutd` with an HTTP client implementing the same interface is the go-live path.
 */
export type EsutdPayload = {
  documentId: string;
  documentKind: string;
  documentType: string;
  number: string;
  date: string; // YYYY-MM-DD
  employer: { bin: string; name: string };
  employee: { iin: string; fullName: string; position: string | null };
  contract: { startDate: string | null; endDate: string | null; salary: number | null };
  attempt: number;
};

export type EsutdResult = { ok: true; externalId: string } | { ok: false; error: string };

export interface EsutdAdapter {
  readonly sandbox: boolean;
  submit(payload: EsutdPayload): Promise<EsutdResult>;
}

const SANDBOX_ERRORS = [
  'ЕСУТД: работник с указанным ИИН не найден в ГБД ФЛ. Проверьте ИИН и повторите отправку.',
  'ЕСУТД: сервис временно недоступен (код 503). Повторите отправку позже.',
  'ЕСУТД: срок ответа истёк (таймаут шлюза ПЭП). Повторите отправку.',
  'ЕСУТД: подпись работодателя не прошла проверку НУЦ РК. Повторите отправку.',
];

type FailureRule = (payload: EsutdPayload) => string | null;
const defaultRule: FailureRule = (p) => {
  const h = sha256(`${p.documentId}:${p.attempt}`);
  const bucket = parseInt(h.slice(0, 8), 16) % 100;
  return bucket < 5 ? SANDBOX_ERRORS[parseInt(h.slice(8, 10), 16) % SANDBOX_ERRORS.length]! : null;
};
let failureRule: FailureRule = defaultRule;

/** Test hook: force sandbox outcomes (return an error text to fail). Pass null to restore the default ~5 % rule. */
export function setEsutdSandboxFailure(rule: FailureRule | null) {
  failureRule = rule ?? defaultRule;
}

/** Validation the real ЕСУТД performs before accepting a contract registration. Returns RU messages. */
export function validateEsutdPayload(p: Partial<EsutdPayload> & { employee?: Partial<EsutdPayload['employee']> | null }): string[] {
  const errors: string[] = [];
  if (!p.employee) errors.push('не указан работник');
  else if (!p.employee.iin || !/^\d{12}$/.test(p.employee.iin)) errors.push('у работника не заполнен ИИН');
  if (!p.number) errors.push('документ не зарегистрирован (нет номера)');
  if (!p.date) errors.push('не указана дата регистрации');
  if (!p.employer?.bin || !/^\d{12}$/.test(p.employer.bin)) errors.push('у юрлица не заполнен БИН');
  if (p.contract && p.documentKind === 'CONTRACT' && !p.contract.startDate) errors.push('не указана дата начала работы');
  return errors;
}

export const esutd: EsutdAdapter = {
  sandbox: true,
  async submit(payload) {
    const invalid = validateEsutdPayload(payload);
    if (invalid.length) return { ok: false, error: `ЕСУТД отклонил документ: ${invalid.join('; ')}.` };
    const failure = failureRule(payload);
    if (failure) return { ok: false, error: failure };
    const h = sha256(`esutd:${payload.documentId}:${payload.attempt}`).slice(0, 10).toUpperCase();
    return { ok: true, externalId: `ESUTD-${payload.date.slice(0, 4)}-${h}` };
  },
};
