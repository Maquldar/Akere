import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfBuilder, type Block } from '../../lib/pdf';

/**
 * "Цифровое личное дело" (government digital personal file) adapter — F-08.
 * The real service needs eGov accreditation (KNOWN_GAPS.md); the sandbox returns deterministic,
 * realistic data derived from the ИИН (birth date and gender are decoded from its digits) and renders
 * the "Личные данные" PDF the way the government service does (M1 p11).
 */
export type GeneratedFile = { filename: string; mime: string; buffer: Buffer };
export type PersonalFileDoc = { values: Record<string, string | number>; files: GeneratedFile[] };
export type PersonalFileResult = {
  /** Keyed by PersonalDocType.code. Only documents the service "knows" are present. */
  documents: Record<string, PersonalFileDoc>;
  /** The consolidated "Личные данные" PDF (also attached to ID_CARD). */
  report: GeneratedFile;
  photo: GeneratedFile;
};
export type PersonName = { lastName: string; firstName: string; middleName?: string | null };

export interface PersonalFileAdapter {
  readonly sandbox: boolean;
  /** Starts the consent flow; returns the text of the SMS the government gateway sends (RU + KZ). */
  requestConsent(iin: string): Promise<{ smsPreview: string }>;
  fetch(iin: string, person: PersonName): Promise<PersonalFileResult>;
}

// ── ИИН decoding ──
export function decodeIin(iin: string): { birthDate: string; gender: 'MALE' | 'FEMALE' } | null {
  if (!/^\d{12}$/.test(iin)) return null;
  const c = Number(iin[6]);
  if (c < 1 || c > 6) return null;
  const century = c <= 2 ? 1800 : c <= 4 ? 1900 : 2000;
  const year = century + Number(iin.slice(0, 2));
  const month = Number(iin.slice(2, 4));
  const day = Number(iin.slice(4, 6));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { birthDate: d.toISOString().slice(0, 10), gender: c % 2 === 1 ? 'MALE' : 'FEMALE' };
}

// ── deterministic helpers ──
function seeded(iin: string) {
  let s = 0;
  for (const ch of iin) s = (Math.imul(s, 31) + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickR = <T,>(r: () => number, arr: readonly T[]) => arr[Math.floor(r() * arr.length)]!;
const digits = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addYears = (d: Date, n: number) => utc(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const ru = (s: string) => s.split('-').reverse().join('.');

// ── reference data ──
const ADDRESSES = [
  { region: 'г. Астана', district: 'район Есиль', city: 'Астана', streets: ['пр. Мәңгілік Ел', 'ул. Сыганак', 'пр. Туран', 'ул. Кабанбай батыра', 'ул. Достык'] },
  { region: 'г. Алматы', district: 'Бостандыкский район', city: 'Алматы', streets: ['пр. Аль-Фараби', 'ул. Тимирязева', 'пр. Абая', 'ул. Жандосова', 'ул. Розыбакиева'] },
  { region: 'г. Шымкент', district: 'Аль-Фарабийский район', city: 'Шымкент', streets: ['пр. Тауке хана', 'ул. Байтурсынова', 'пр. Республики'] },
  { region: 'Карагандинская область', district: 'район им. Казыбек би', city: 'Караганда', streets: ['пр. Бухар-Жырау', 'ул. Ерубаева', 'пр. Строителей'] },
  { region: 'Павлодарская область', district: '', city: 'Павлодар', streets: ['ул. Торайгырова', 'ул. Естая', 'ул. Ломова'] },
  { region: 'Актюбинская область', district: '', city: 'Актобе', streets: ['пр. Абилкайыр хана', 'ул. Маресьева', 'пр. Санкибай батыра'] },
  { region: 'Атырауская область', district: '', city: 'Атырау', streets: ['пр. Азаттык', 'ул. Махамбета', 'ул. Сатпаева'] },
  { region: 'Костанайская область', district: '', city: 'Костанай', streets: ['пр. Аль-Фараби', 'ул. Байтурсынова', 'ул. Тарана'] },
];
const BIRTH_PLACES = ['г. Алматы', 'г. Астана', 'г. Караганда', 'г. Шымкент', 'г. Тараз', 'г. Павлодар', 'г. Семей', 'г. Усть-Каменогорск', 'г. Кызылорда', 'г. Актобе', 'г. Костанай'];
const UNIVERSITIES = [
  'Казахский национальный университет им. аль-Фараби', 'Евразийский национальный университет им. Л.Н. Гумилёва', 'Satbayev University',
  'Казахстанско-Британский технический университет', 'Карагандинский университет им. Е.А. Букетова', 'Университет КИМЭП',
  'Южно-Казахстанский университет им. М. Ауэзова', 'Astana IT University', 'Университет Нархоз',
];
const COLLEGES = ['Алматинский государственный колледж энергетики и электронных технологий', 'Высший колледж «Astana Polytechnic»', 'Карагандинский технический колледж'];
const SPECIALTIES = ['Информационные системы', 'Вычислительная техника и программное обеспечение', 'Финансы', 'Учёт и аудит', 'Логистика', 'Менеджмент', 'Маркетинг', 'Юриспруденция', 'Транспорт, транспортная техника и технологии'];
const EMPLOYERS = ['ТОО «Kaspi Logistics»', 'АО «Казпочта»', 'ТОО «Магнум Кэш энд Керри»', 'ТОО «Technodom Operator»', 'АО «Kcell»', 'ТОО «Arena S»', 'ТОО «BI Group»', 'ТОО «Chocofamily»', 'АО «Air Astana»'];
const POSITIONS = ['Специалист', 'Менеджер', 'Ведущий специалист', 'Оператор', 'Инженер', 'Бухгалтер', 'Экспедитор', 'Кладовщик'];
const CLINICS: Record<string, string[]> = {
  MED_075: ['ГКП на ПХВ «Городская поликлиника №5»', 'ГКП на ПХВ «Городская поликлиника №11»', 'Медицинский центр «Interteach»', 'ТОО «Клиника Сункар»'],
  TB_DISPENSARY: ['ГКП на ПХВ «Городской центр фтизиопульмонологии»', 'КГП «Областной противотуберкулёзный диспансер»'],
  NARCO_DISPENSARY: ['ГКП на ПХВ «Центр психического здоровья» (наркологическое отделение)', 'КГП «Областной наркологический диспансер»'],
  PSYCHO_DISPENSARY: ['ГКП на ПХВ «Центр психического здоровья»', 'КГП «Областной психоневрологический диспансер»'],
};
const CONCLUSIONS: Record<string, string> = {
  MED_075: 'Противопоказаний к работе не выявлено. Годен.',
  TB_DISPENSARY: 'На диспансерном учёте не состоит.',
  NARCO_DISPENSARY: 'На диспансерном учёте не состоит.',
  PSYCHO_DISPENSARY: 'На диспансерном учёте не состоит.',
};
const DOCTORS = { m: ['Ахметов Серик Болатович', 'Иванов Сергей Петрович', 'Касымов Ержан Маратович'], f: ['Жумагалиева Айгуль Сериковна', 'Ким Наталья Викторовна', 'Оспанова Гульмира Ерлановна', 'Абдиева Сауле Кайратовна'] };
const SPOUSE = { m: ['Ахметова Динара Маратовна', 'Сагинова Айгерим Болатовна', 'Иванова Ольга Сергеевна'], f: ['Сарсенов Арман Нурланович', 'Омаров Данияр Канатович', 'Петров Дмитрий Сергеевич'] };
const CHILD = { m: ['Алихан', 'Мирас', 'Тамерлан', 'Арсен'], f: ['Аружан', 'Томирис', 'Амина', 'Сафия'] };

const here = dirname(fileURLToPath(import.meta.url));
const sandboxDir = [resolve(here, '../../../assets/sandbox'), resolve(here, '../assets/sandbox'), resolve(process.cwd(), 'assets/sandbox')].find((p) => {
  try {
    readFileSync(resolve(p, 'photo-m.png'));
    return true;
  } catch {
    return false;
  }
});
const photoCache: Record<string, Buffer> = {};
export function sandboxPhoto(gender: 'MALE' | 'FEMALE'): Buffer {
  const name = gender === 'MALE' ? 'photo-m.png' : 'photo-f.png';
  if (!sandboxDir) throw new Error('assets/sandbox not found');
  return (photoCache[name] ??= readFileSync(resolve(sandboxDir, name)));
}

const maskIin = (iin: string) => `${iin.slice(0, 4)}****${iin.slice(-4)}`;

function smsText(iin: string) {
  return [
    `1414: Akere HR запрашивает доступ к вашим данным в сервисе «Цифровое личное дело» (ИИН ${maskIin(iin)}).`,
    'Для согласия отправьте 511, для отказа — 512. 511 — ДА, 512 — НЕТ.',
    `Akere HR «Цифрлық жеке іс» сервисіндегі деректеріңізге (ЖСН ${maskIin(iin)}) рұқсат сұрайды.`,
    'Келісу үшін 511, бас тарту үшін 512 жіберіңіз. 511 — ИӘ, 512 — ЖОҚ.',
  ].join('\n');
}

/** Builds the data set for one person. Pure and deterministic for a given ИИН + name + reference day. */
export function buildPersonalData(iin: string, person: PersonName, today = new Date()): Record<string, Record<string, string | number>> {
  const decoded = decodeIin(iin);
  const r = seeded(iin);
  const male = decoded ? decoded.gender === 'MALE' : r() < 0.5;
  const birth = decoded ? new Date(`${decoded.birthDate}T00:00:00Z`) : utc(1995, 0, 1);
  const age = Math.floor((today.getTime() - birth.getTime()) / (365.25 * 86_400_000));
  const base = { iin, lastName: person.lastName, firstName: person.firstName, ...(person.middleName ? { middleName: person.middleName } : {}), birthDate: ymd(birth) };
  const docs: Record<string, Record<string, string | number>> = {};

  // Identity card: issued after the 16th birthday (or replaced every 10 years).
  const ageAtIssue = Math.max(16, age - Math.floor(r() * 9));
  let idIssue = addDays(addYears(birth, ageAtIssue), Math.floor(r() * 120));
  if (idIssue > today) idIssue = addDays(today, -30 - Math.floor(r() * 300));
  docs.ID_CARD = {
    ...base,
    gender: male ? 'Мужской' : 'Женский',
    nationality: /ов$|ев$|ин$|ова$|ева$|ина$/.test(person.lastName) && /ович$|евич$|овна$|евна$/.test(person.middleName ?? '') && r() < 0.3 ? (male ? 'Русский' : 'Русская') : male ? 'Казах' : 'Казашка',
    citizenship: 'Республика Казахстан',
    birthPlace: pickR(r, BIRTH_PLACES),
    docNumber: `0${digits(r, 8)}`,
    issueDate: ymd(idIssue),
    expiryDate: ymd(addDays(addYears(idIssue, 10), -1)),
    issuedBy: 'МВД РК',
  };
  const ppIssue = addDays(today, -200 - Math.floor(r() * 2500));
  docs.PASSPORT = { ...base, docNumber: `N${digits(r, 8)}`, issueDate: ymd(ppIssue), expiryDate: ymd(addDays(addYears(ppIssue, 10), -1)), issuedBy: 'МВД РК' };

  // Education: university from 18 to 22 (or college from 16 to 19 for some).
  const college = r() < 0.25;
  const start = utc(birth.getUTCFullYear() + (college ? 16 : 18), 8, 1);
  const end = utc(start.getUTCFullYear() + (college ? 3 : 4), 5, 25 + Math.floor(r() * 5));
  if (end < today) {
    docs.EDUCATION = {
      category: college ? 'Среднее специальное' : 'Высшее (бакалавриат)',
      institution: pickR(r, college ? COLLEGES : UNIVERSITIES),
      specialty: pickR(r, SPECIALTIES),
      course: college ? '3' : '4',
      docType: 'Диплом',
      studyForm: 'очная',
      startDate: ymd(start),
      endDate: ymd(end),
      issueDate: ymd(addDays(end, 5)),
      docNumber: `${college ? 'ТКБ' : 'ЖБ-Б'} ${digits(r, 7)}`,
    };
    // Work history after graduation.
    const years = Math.max(0, today.getUTCFullYear() - end.getUTCFullYear() - 1);
    if (years > 0) {
      const lastEnd = addDays(today, -15 - Math.floor(r() * 120));
      const e1 = pickR(r, EMPLOYERS);
      const p1 = pickR(r, POSITIONS);
      const firstJobStart = addDays(end, 60 + Math.floor(r() * 120));
      const switchAt = years > 3 ? addYears(firstJobStart, Math.floor(years / 2)) : null;
      const e0 = pickR(r, EMPLOYERS.filter((e) => e !== e1));
      const history = switchAt
        ? `${ru(ymd(firstJobStart))} – ${ru(ymd(addDays(switchAt, -1)))}: ${e0}, ${pickR(r, POSITIONS)}\n${ru(ymd(switchAt))} – ${ru(ymd(lastEnd))}: ${e1}, ${p1}`
        : `${ru(ymd(firstJobStart))} – ${ru(ymd(lastEnd))}: ${e1}, ${p1}`;
      docs.WORK_HISTORY = { totalExperience: years, lastEmployer: e1, lastPosition: p1, lastEndDate: ymd(lastEnd), history };
    }
  }

  const addr = pickR(r, ADDRESSES);
  docs.ADDRESS = {
    country: 'Казахстан',
    region: addr.region,
    ...(addr.district ? { district: addr.district } : {}),
    city: addr.city,
    street: pickR(r, addr.streets),
    building: String(1 + Math.floor(r() * 120)),
    ...(r() < 0.3 ? { block: String(1 + Math.floor(r() * 4)) } : {}),
    ...(r() < 0.8 ? { apartment: String(1 + Math.floor(r() * 240)) } : {}),
  };

  for (const code of ['MED_075', 'TB_DISPENSARY', 'NARCO_DISPENSARY', 'PSYCHO_DISPENSARY']) {
    docs[code] = {
      iin, lastName: person.lastName, birthDate: ymd(birth), organization: pickR(r, CLINICS[code]!),
      doctor: pickR(r, r() < 0.6 ? DOCTORS.f : DOCTORS.m), issueDate: ymd(addDays(today, -3 - Math.floor(r() * 40))), conclusion: CONCLUSIONS[code]!,
    };
  }

  if (age >= 18 && r() < 0.6) {
    const dlIssue = addDays(addYears(birth, 18 + Math.floor(r() * Math.max(1, Math.min(10, age - 18)))), Math.floor(r() * 200));
    const issue = dlIssue > today ? addDays(today, -100) : dlIssue;
    docs.DRIVER_LICENSE = { docNumber: `KZ ${digits(r, 6)}`, categories: r() < 0.3 ? 'B, C, CE' : 'B', issueDate: ymd(issue), expiryDate: ymd(addDays(addYears(issue, 10), -1)) };
  }
  docs.NO_CRIMINAL_RECORD = { issueDate: ymd(addDays(today, -2 - Math.floor(r() * 20))), result: 'Не имеется' };

  if (age >= 24 && r() < 0.55) {
    const married = addDays(addYears(birth, 22 + Math.floor(r() * Math.max(1, Math.min(10, age - 23)))), Math.floor(r() * 300));
    docs.MARRIAGE_CERT = { kind: 'О браке', docNumber: `${digits(r, 7)}`, date: ymd(married), spouse: pickR(r, male ? SPOUSE.m : SPOUSE.f) };
    const childYears = Math.floor((today.getTime() - married.getTime()) / (365.25 * 86_400_000));
    if (childYears >= 2) {
      const n = 1 + Math.floor(r() * Math.min(3, Math.floor(childYears / 2)));
      const kids: string[] = [];
      for (let i = 0; i < n; i++) {
        const boy = r() < 0.5;
        const bd = addDays(married, 365 + i * 800 + Math.floor(r() * 300));
        if (bd > today) break;
        const surname = male ? person.lastName : (pickR(r, SPOUSE.f).split(' ')[0] ?? person.lastName);
        const childSurname = boy ? surname.replace(/а$/, '') : /(ов|ев|ин)$/.test(surname) ? `${surname}а` : surname;
        kids.push(`${childSurname} ${pickR(r, boy ? CHILD.m : CHILD.f)}, ${ru(ymd(bd))}`);
      }
      if (kids.length) docs.CHILD_BIRTH_CERT = { children: kids.join('\n') };
    }
  }
  return docs;
}

async function renderReport(iin: string, person: PersonName, docs: Record<string, Record<string, string | number>>, photo: Buffer): Promise<Buffer> {
  const id = docs.ID_CARD!;
  const fio = [person.lastName, person.firstName, person.middleName].filter(Boolean).join(' ');
  const d = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? ru(v) : String(v ?? '—'));
  const pdf = await PdfBuilder.create({ title: `Личные данные — ${fio}`, footer: `Цифровое личное дело (sandbox) · ИИН ${iin} · сформировано ${ru(ymd(new Date()))}` });
  await pdf.imageAt(photo, 'png', 595.28 - 56 - 90, 56, 90, 120);
  const blocks: Block[] = [
    { type: 'heading', text: 'Личные данные', align: 'left', size: 18 },
    { type: 'paragraph', text: 'Жеке деректер · Сведения из сервиса «Цифровое личное дело»', size: 9 },
    { type: 'spacer', height: 6 },
    { type: 'fields', rows: [{ label: 'ФИО', value: fio }, { label: 'ИИН', value: iin }, { label: 'Дата рождения', value: d(id.birthDate) }, { label: 'Пол', value: String(id.gender) }] },
    { type: 'fields', rows: [{ label: 'Национальность', value: String(id.nationality) }, { label: 'Гражданство', value: String(id.citizenship) }, { label: 'Место рождения', value: String(id.birthPlace) }] },
    { type: 'spacer', height: 14 },
    { type: 'banner', text: 'Документы, удостоверяющие личность', color: 'green' },
    {
      type: 'fields',
      rows: [
        { label: 'Вид документа', value: 'Удостоверение личности гражданина РК' }, { label: 'Номер документа', value: String(id.docNumber) },
        { label: 'Дата выдачи', value: d(id.issueDate) }, { label: 'Действителен до', value: d(id.expiryDate) }, { label: 'Кем выдан', value: String(id.issuedBy) },
      ],
    },
  ];
  if (docs.PASSPORT) {
    const p = docs.PASSPORT;
    blocks.push({ type: 'fields', rows: [{ label: 'Паспорт', value: String(p.docNumber) }, { label: 'Дата выдачи', value: d(p.issueDate) }, { label: 'Действителен до', value: d(p.expiryDate) }] });
  }
  const a = docs.ADDRESS!;
  blocks.push(
    { type: 'banner', text: 'Адрес постоянной регистрации', color: 'green' },
    {
      type: 'fields',
      rows: [
        { label: 'Страна', value: String(a.country) }, { label: 'Область / город', value: String(a.region) },
        ...(a.district ? [{ label: 'Район', value: String(a.district) }] : []),
        { label: 'Населённый пункт', value: String(a.city) },
        { label: 'Адрес', value: `${a.street}, д. ${a.building}${a.block ? `, корп. ${a.block}` : ''}${a.apartment ? `, кв. ${a.apartment}` : ''}` },
      ],
    },
  );
  if (docs.EDUCATION) {
    const e = docs.EDUCATION;
    blocks.push(
      { type: 'banner', text: 'Образование', color: 'green' },
      { type: 'fields', rows: [{ label: 'Уровень', value: String(e.category) }, { label: 'Учебное заведение', value: String(e.institution) }, { label: 'Специальность', value: String(e.specialty) }, { label: 'Период обучения', value: `${d(e.startDate)} – ${d(e.endDate)}` }, { label: 'Документ', value: `${e.docType} ${e.docNumber}` }] },
    );
  }
  if (docs.WORK_HISTORY) {
    const w = docs.WORK_HISTORY;
    blocks.push(
      { type: 'banner', text: 'Трудовая деятельность', color: 'green' },
      { type: 'fields', rows: [{ label: 'Общий стаж', value: `${w.totalExperience} лет` }, { label: 'Записи', value: String(w.history) }] },
    );
  }
  const m = docs.MED_075!;
  blocks.push(
    { type: 'banner', text: 'Медицинская справка', color: 'green' },
    { type: 'fields', rows: [{ label: 'Форма', value: '075/у' }, { label: 'Организация', value: String(m.organization) }, { label: 'Врач', value: String(m.doctor) }, { label: 'Дата', value: d(m.issueDate) }, { label: 'Заключение', value: String(m.conclusion) }] },
    { type: 'banner', text: 'Справки диспансеров', color: 'green' },
    {
      type: 'fields',
      rows: (['TB_DISPENSARY', 'NARCO_DISPENSARY', 'PSYCHO_DISPENSARY'] as const).map((code) => ({
        label: { TB_DISPENSARY: 'Противотуберкулёзный', NARCO_DISPENSARY: 'Наркологический', PSYCHO_DISPENSARY: 'Психоневрологический' }[code],
        value: `${docs[code]!.conclusion} (${docs[code]!.organization}, ${d(docs[code]!.issueDate)})`,
      })),
    },
    { type: 'spacer', height: 10 },
    { type: 'paragraph', text: 'Документ сформирован тестовой (sandbox) реализацией сервиса и не имеет юридической силы.', size: 8 },
  );
  await pdf.add(blocks);
  return pdf.bytes();
}

const sandbox: PersonalFileAdapter = {
  sandbox: true,
  async requestConsent(iin) {
    return { smsPreview: smsText(iin) };
  },
  async fetch(iin, person) {
    const docs = buildPersonalData(iin, person);
    const gender = decodeIin(iin)?.gender ?? 'MALE';
    const photoBuf = sandboxPhoto(gender);
    const report: GeneratedFile = { filename: 'Личные_данные.pdf', mime: 'application/pdf', buffer: await renderReport(iin, person, docs, photoBuf) };
    const photo: GeneratedFile = { filename: 'Фото_3x4.png', mime: 'image/png', buffer: photoBuf };
    const documents: Record<string, PersonalFileDoc> = {};
    for (const [code, values] of Object.entries(docs)) documents[code] = { values, files: code === 'ID_CARD' ? [report] : [] };
    documents.PHOTO = { values: {}, files: [photo] };
    return { documents, report, photo };
  },
};

export const personalFile: PersonalFileAdapter = sandbox;
export const AUTOFILL_FILENAMES = ['Личные_данные.pdf', 'Фото_3x4.png'];
