import type { Prisma } from '@prisma/client';
import type { HireInput } from '@akere/shared';
import { prisma } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { AppError, businessRule, conflict, fieldError, notFound } from '../../lib/errors';
import { legalEntityAllowed } from '../../lib/scope';
import { fromDateStr } from '../../lib/dates';
import { emit } from '../../lib/hooks';
import { audit } from '../../lib/audit';
import { t } from '../../lib/i18n';
import { config } from '../../config';
import { messaging } from '../../adapters/messaging';
import { decodeIin } from '../../adapters/personal-file';
import { acceptedValues, findCandidate, personalData } from './service';

/** Next free numeric tab number in the tenant (zero-padded to 6 like the seed: 000101). */
export async function nextTabNumber(tenantId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST("tabNumber" AS INTEGER)) AS max FROM "Employee" WHERE "tenantId" = ${tenantId} AND "tabNumber" ~ '^[0-9]{1,9}$'`;
  return String((rows[0]?.max ?? 0) + 1).padStart(6, '0');
}

/** F-12: accepted candidate → User (EMPLOYEE) + Employee with the onboarding data; fires `employee.hired`. */
export async function hireCandidate(u: UserCtx, candidateId: string, input: HireInput, ip?: string) {
  const c = await findCandidate(u, candidateId);
  if (c.employeeId) throw conflict('Candidate has already been hired', { employeeId: c.employeeId });
  if (c.status !== 'ACCEPTED' && c.status !== 'EXPORTED') throw businessRule('CANDIDATE_NOT_ACCEPTED', 'Оформить можно только принятого кандидата');

  const le = await prisma.legalEntity.findFirst({ where: { id: input.legalEntityId, tenantId: u.tenantId } });
  if (!le) throw notFound('Legal entity');
  if (!legalEntityAllowed(u, le.id)) throw new AppError(403, 'FORBIDDEN', 'Legal entity is outside your scope');
  if (!(await prisma.department.findFirst({ where: { id: input.departmentId, tenantId: u.tenantId, legalEntityId: le.id } }))) {
    throw fieldError('departmentId', 'Department does not belong to the legal entity');
  }
  if (!(await prisma.position.findFirst({ where: { id: input.positionId, tenantId: u.tenantId } }))) throw fieldError('positionId', 'Unknown position');
  if (input.managerId && !(await prisma.employee.findFirst({ where: { id: input.managerId, tenantId: u.tenantId, status: 'ACTIVE' } }))) {
    throw fieldError('managerId', 'Unknown manager');
  }
  if (input.locationId && !(await prisma.workLocation.findFirst({ where: { id: input.locationId, tenantId: u.tenantId } }))) {
    throw fieldError('locationId', 'Unknown work location');
  }
  const tabNumber = input.tabNumber ?? (await nextTabNumber(u.tenantId));
  if (await prisma.employee.findFirst({ where: { tenantId: u.tenantId, tabNumber } })) throw conflict('Tab number is already used', { field: 'tabNumber' });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
  const hasRealEmail = !!c.email;
  const email = c.email ?? `emp.${tabNumber}.${tenant.slug}@noemail.akere.local`;
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('A user with this email already exists', { field: 'email' });
  const phone = c.phone && !(await prisma.user.findUnique({ where: { phone: c.phone } })) ? c.phone : null;

  const { values, photoFileId } = await acceptedValues(c.id);
  const decoded = c.iin ? decodeIin(c.iin) : null;
  const idCard = values.ID_CARD ?? {};
  const birthDate = c.birthDate ?? (typeof idCard.birthDate === 'string' ? fromDateStr(idCard.birthDate) : decoded ? fromDateStr(decoded.birthDate) : null);
  const gender = c.gender ?? (idCard.gender === 'Мужской' ? 'MALE' : idCard.gender === 'Женский' ? 'FEMALE' : (decoded?.gender ?? null));
  const personal = {
    ...personalData(values),
    email: c.email,
    phone: c.phone,
    probationMonths: input.probationMonths ?? null,
    candidateId: c.id,
    documents: values,
  } as unknown as Prisma.InputJsonValue;

  const payload = {
    tenantId: u.tenantId, employeeId: '', actorUserId: u.userId, salary: input.salary,
    probationMonths: input.probationMonths, generateDocuments: input.generateDocuments, documentIds: [] as string[],
  };
  const employee = await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: u.tenantId, email, phone, firstName: c.firstName, lastName: c.lastName, middleName: c.middleName, locale: 'ru',
          roles: { create: [{ role: 'EMPLOYEE', legalEntityId: null, canSign: false }] },
        },
      });
      const emp = await tx.employee.create({
        data: {
          tenantId: u.tenantId, userId: user.id, legalEntityId: le.id, departmentId: input.departmentId, positionId: input.positionId,
          managerId: input.managerId ?? null, locationId: input.locationId ?? null, tabNumber, iin: c.noIin ? null : c.iin,
          birthDate, gender, hireDate: fromDateStr(input.hireDate), personal, photoFileId,
        },
      });
      await tx.candidate.update({
        where: { id: c.id },
        data: { employeeId: emp.id, legalEntityId: le.id, departmentId: input.departmentId, positionId: input.positionId, plannedHireDate: fromDateStr(input.hireDate) },
      });
      await tx.session.deleteMany({ where: { candidateId: c.id } }); // portal access ends at hire (SPEC §1)
      payload.employeeId = emp.id;
      await emit('employee.hired', payload, tx);
      return emp;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  await audit(u, 'candidate.hire', 'Candidate', c.id, { employeeId: employee.id, tabNumber, documentIds: payload.documentIds }, { ip });
  await audit(u, 'employee.create', 'Employee', employee.id, { fromCandidate: c.id, tabNumber }, { ip });
  if (hasRealEmail) {
    await messaging('EMAIL')
      .send({ tenantId: u.tenantId, to: email, subject: t('invite.subject', 'ru'), text: t('invite.user', 'ru', { name: c.firstName, company: tenant.name, url: `${config.APP_URL}/ru/reset` }) })
      .catch(() => undefined);
  }
  return { employeeId: employee.id, documentIds: payload.documentIds };
}
