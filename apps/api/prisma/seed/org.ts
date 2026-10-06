import type { Gender, PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
import { FEMALE, MALE, kzHolidays, makeBin, makeIin, pick, rng, translit } from './kz';

export const DEMO_PASSWORD = 'Akere2026demo';

export type OrgCtx = Awaited<ReturnType<typeof seedOrg>>;

export async function seedOrg(prisma: PrismaClient) {
  const r = rng(20261006);
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // Production calendar (shared by all tenants).
  for (const year of [2025, 2026, 2027]) {
    await prisma.holiday.createMany({ data: kzHolidays(year).map((h) => ({ date: new Date(`${h.date}T00:00:00Z`), kind: h.kind, name: h.name })) });
  }

  const tenant = await prisma.tenant.create({
    data: { name: 'Dala Group', slug: 'dala', settings: { requireSelfie: true, requireGeofence: true, timezone: 'Asia/Almaty' } },
  });

  const dala = await prisma.legalEntity.create({
    data: { tenantId: tenant.id, name: 'ТОО «Dala Tech»', nameKk: '«Dala Tech» ЖШС', bin: makeBin(2019, 3, 10421), address: 'г. Астана, пр. Мәңгілік Ел, 55/20', directorName: 'Байсарин Тимур Ерланович' },
  });
  const altyn = await prisma.legalEntity.create({
    data: { tenantId: tenant.id, name: 'ТОО «Алтын Логистик»', nameKk: '«Алтын Логистик» ЖШС', bin: makeBin(2016, 9, 55210), address: 'г. Алматы, пр. Аль-Фараби, 77/8', directorName: 'Омаров Бахытжан Алибекович' },
  });

  const astana = await prisma.workLocation.create({ data: { tenantId: tenant.id, name: 'Главный офис (Астана)', address: 'пр. Мәңгілік Ел, 55/20', lat: 51.0906, lng: 71.4183, radiusM: 250 } });
  const almaty = await prisma.workLocation.create({ data: { tenantId: tenant.id, name: 'Склад (Алматы)', address: 'пр. Аль-Фараби, 77/8', lat: 43.2183, lng: 76.9271, radiusM: 400 } });

  const posNames = [
    ['Генеральный директор', 'Бас директор'], ['Кадровый специалист', 'Кадр маманы'], ['Системный администратор', 'Жүйелік әкімші'],
    ['Руководитель разработки', 'Әзірлеу бөлімінің басшысы'], ['Backend-разработчик', 'Backend-әзірлеуші'], ['Frontend-разработчик', 'Frontend-әзірлеуші'],
    ['QA-инженер', 'QA-инженер'], ['Product Manager', 'Өнім менеджері'], ['Руководитель отдела продаж', 'Сату бөлімінің басшысы'],
    ['Менеджер по продажам', 'Сату жөніндегі менеджер'], ['Руководитель поддержки', 'Қолдау қызметінің басшысы'], ['Специалист поддержки', 'Қолдау маманы'],
    ['Главный бухгалтер', 'Бас бухгалтер'], ['Бухгалтер', 'Бухгалтер'], ['Директор филиала', 'Филиал директоры'], ['Начальник склада', 'Қойма меңгерушісі'],
    ['Кладовщик', 'Қоймашы'], ['Водитель-экспедитор', 'Жүргізуші-экспедитор'], ['Офис-менеджер', 'Кеңсе менеджері'],
  ] as const;
  const pos: Record<string, string> = {};
  for (const [name, nameKk] of posNames) pos[name] = (await prisma.position.create({ data: { tenantId: tenant.id, name, nameKk } })).id;

  const dept = async (legalEntityId: string, name: string, nameKk: string, parentId?: string) =>
    (await prisma.department.create({ data: { tenantId: tenant.id, legalEntityId, name, nameKk, parentId } })).id;
  const d = {
    mgmt: await dept(dala.id, 'Руководство', 'Басшылық'),
    hr: await dept(dala.id, 'Отдел кадров', 'Кадр бөлімі'),
    dev: await dept(dala.id, 'Разработка', 'Әзірлеу'),
    sales: await dept(dala.id, 'Отдел продаж', 'Сату бөлімі'),
    support: await dept(dala.id, 'Служба поддержки', 'Қолдау қызметі'),
    finance: await dept(dala.id, 'Бухгалтерия', 'Бухгалтерия'),
    aMgmt: await dept(altyn.id, 'Администрация', 'Әкімшілік'),
    aWarehouse: await dept(altyn.id, 'Склад', 'Қойма'),
    aTransport: await dept(altyn.id, 'Транспортный отдел', 'Көлік бөлімі'),
  };
  const backend = await dept(dala.id, 'Backend', 'Backend', d.dev);
  const frontend = await dept(dala.id, 'Frontend', 'Frontend', d.dev);

  let tab = 100;
  let serial = 1000;
  type P = {
    first: string; last: string; middle?: string; gender: Gender; le: string; dept: string; pos: string; manager?: string; location?: string;
    roles: { role: Role; legalEntityId?: string | null; canSign?: boolean }[]; email?: string; demo?: number; hire?: string; birth?: string;
  };
  const people: Record<string, { userId: string; employeeId: string }> = {};

  async function person(key: string, p: P) {
    const birth = new Date(p.birth ? `${p.birth}T00:00:00Z` : Date.UTC(1975 + Math.floor(r() * 27), Math.floor(r() * 12), 1 + Math.floor(r() * 27)));
    const hire = new Date(p.hire ? `${p.hire}T00:00:00Z` : Date.UTC(2019 + Math.floor(r() * 7), Math.floor(r() * 12), 1 + Math.floor(r() * 27)));
    const email = p.email ?? `${translit(p.first)}.${translit(p.last)}@dala.kz`;
    const phone = `+7701${String(1000000 + Math.floor(r() * 8999999))}`;
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id, email, phone, passwordHash, firstName: p.first, lastName: p.last, middleName: p.middle ?? null,
        demoListed: p.demo !== undefined, demoOrder: p.demo ?? 0,
        roles: { create: [{ role: 'EMPLOYEE' as Role, legalEntityId: null, canSign: false }, ...p.roles.map((x) => ({ role: x.role, legalEntityId: x.legalEntityId ?? null, canSign: x.canSign ?? false }))] },
      },
    });
    const employee = await prisma.employee.create({
      data: {
        tenantId: tenant.id, userId: user.id, legalEntityId: p.le, departmentId: p.dept, positionId: p.pos, managerId: p.manager ? people[p.manager]!.employeeId : null,
        locationId: p.location ?? (p.le === dala.id ? astana.id : almaty.id), tabNumber: String(tab++).padStart(6, '0'),
        iin: makeIin(birth, p.gender === 'MALE', serial++), birthDate: birth, gender: p.gender, hireDate: hire,
        personal: { citizenship: 'КАЗАХСТАН', address: p.le === dala.id ? 'г. Астана' : 'г. Алматы' },
      },
    });
    people[key] = { userId: user.id, employeeId: employee.id };
    return people[key]!;
  }

  // Leadership and key roles (demo accounts).
  await person('ceo', { first: 'Тимур', last: 'Байсарин', middle: 'Ерланович', gender: 'MALE', le: dala.id, dept: d.mgmt, pos: pos['Генеральный директор']!, roles: [{ role: 'MANAGER', legalEntityId: dala.id, canSign: true }], email: 'ceo@dala.kz', demo: 3, hire: '2019-03-11' });
  await person('admin', { first: 'Ерлан', last: 'Мукашев', middle: 'Канатович', gender: 'MALE', le: dala.id, dept: d.mgmt, pos: pos['Системный администратор']!, manager: 'ceo', roles: [{ role: 'ADMIN' }], email: 'admin@dala.kz', demo: 1, hire: '2019-04-01' });
  await person('hr', { first: 'Жанара', last: 'Сулейменова', middle: 'Нурлановна', gender: 'FEMALE', le: dala.id, dept: d.hr, pos: pos['Кадровый специалист']!, manager: 'ceo', roles: [{ role: 'HR' }], email: 'hr@dala.kz', demo: 2, hire: '2020-02-03' });
  await person('hr2', { first: 'Алия', last: 'Ермекова', middle: 'Талгатовна', gender: 'FEMALE', le: altyn.id, dept: d.aMgmt, pos: pos['Кадровый специалист']!, roles: [{ role: 'HR', legalEntityId: altyn.id }], email: 'hr.altyn@dala.kz', hire: '2021-06-14' });
  await person('devlead', { first: 'Руслан', last: 'Алимов', middle: 'Маратович', gender: 'MALE', le: dala.id, dept: d.dev, pos: pos['Руководитель разработки']!, manager: 'ceo', roles: [{ role: 'MANAGER' }], email: 'r.alimov@dala.kz', demo: 4, hire: '2019-05-20' });
  await person('saleslead', { first: 'Марат', last: 'Сейтжанов', middle: 'Бахытович', gender: 'MALE', le: dala.id, dept: d.sales, pos: pos['Руководитель отдела продаж']!, manager: 'ceo', roles: [{ role: 'MANAGER' }], hire: '2020-09-01' });
  await person('supportlead', { first: 'Айгерим', last: 'Сагинова', middle: 'Еркиновна', gender: 'FEMALE', le: dala.id, dept: d.support, pos: pos['Руководитель поддержки']!, manager: 'ceo', roles: [{ role: 'MANAGER' }], hire: '2021-01-18' });
  await person('accountant', { first: 'Сауле', last: 'Рахметова', middle: 'Болатовна', gender: 'FEMALE', le: dala.id, dept: d.finance, pos: pos['Главный бухгалтер']!, manager: 'ceo', roles: [], hire: '2019-08-05' });
  await person('dev1', { first: 'Әлия', last: 'Серикова', middle: 'Болатовна', gender: 'FEMALE', le: dala.id, dept: frontend, pos: pos['Frontend-разработчик']!, manager: 'devlead', roles: [], email: 'a.serikova@dala.kz', demo: 5, hire: '2022-04-11', birth: '1996-07-14' });
  await person('altynDirector', { first: 'Бахытжан', last: 'Омаров', middle: 'Алибекович', gender: 'MALE', le: altyn.id, dept: d.aMgmt, pos: pos['Директор филиала']!, roles: [{ role: 'MANAGER', legalEntityId: altyn.id, canSign: true }], hire: '2016-09-12' });
  await prisma.employee.update({ where: { id: people.hr2!.employeeId }, data: { managerId: people.altynDirector!.employeeId } });
  await person('warehouseLead', { first: 'Канат', last: 'Исабеков', middle: 'Серикович', gender: 'MALE', le: altyn.id, dept: d.aWarehouse, pos: pos['Начальник склада']!, manager: 'altynDirector', roles: [{ role: 'MANAGER' }], hire: '2017-03-01' });

  // Rank-and-file staff.
  const staff: [string, string, string, string][] = [
    ['dev', backend, 'Backend-разработчик', 'devlead'], ['dev', backend, 'Backend-разработчик', 'devlead'], ['dev', backend, 'Backend-разработчик', 'devlead'],
    ['dev', frontend, 'Frontend-разработчик', 'devlead'], ['dev', frontend, 'Frontend-разработчик', 'devlead'],
    ['dev', d.dev, 'QA-инженер', 'devlead'], ['dev', d.dev, 'QA-инженер', 'devlead'], ['dev', d.dev, 'Product Manager', 'devlead'],
    ['sales', d.sales, 'Менеджер по продажам', 'saleslead'], ['sales', d.sales, 'Менеджер по продажам', 'saleslead'], ['sales', d.sales, 'Менеджер по продажам', 'saleslead'], ['sales', d.sales, 'Менеджер по продажам', 'saleslead'],
    ['sup', d.support, 'Специалист поддержки', 'supportlead'], ['sup', d.support, 'Специалист поддержки', 'supportlead'], ['sup', d.support, 'Специалист поддержки', 'supportlead'], ['sup', d.support, 'Специалист поддержки', 'supportlead'],
    ['fin', d.finance, 'Бухгалтер', 'accountant'], ['fin', d.mgmt, 'Офис-менеджер', 'ceo'],
    ['wh', d.aWarehouse, 'Кладовщик', 'warehouseLead'], ['wh', d.aWarehouse, 'Кладовщик', 'warehouseLead'], ['wh', d.aWarehouse, 'Кладовщик', 'warehouseLead'],
    ['tr', d.aTransport, 'Водитель-экспедитор', 'altynDirector'], ['tr', d.aTransport, 'Водитель-экспедитор', 'altynDirector'], ['tr', d.aTransport, 'Водитель-экспедитор', 'altynDirector'],
  ];
  const usedNames = new Set<string>();
  let i = 0;
  for (const [, deptId, posName, mgr] of staff) {
    const male = r() < 0.55;
    const pool = male ? MALE : FEMALE;
    let first = '', last = '';
    do {
      first = pick(r, pool.first);
      last = pick(r, pool.last);
    } while (usedNames.has(first + last));
    usedNames.add(first + last);
    const le = [d.aWarehouse, d.aTransport].includes(deptId) ? altyn.id : dala.id;
    await person(`staff${i++}`, { first, last, middle: pick(r, pool.middle), gender: male ? 'MALE' : 'FEMALE', le, dept: deptId, pos: pos[posName]!, manager: mgr, roles: [] });
  }

  return { tenantId: tenant.id, legalEntities: { dala: dala.id, altyn: altyn.id }, departments: { ...d, backend, frontend }, positions: pos, locations: { astana: astana.id, almaty: almaty.id }, people };
}
