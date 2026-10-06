/** Deterministic generators for realistic Kazakhstan seed data. */

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checksum(d: number[]): number | null {
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let s = w1.reduce((a, w, i) => a + w * d[i]!, 0) % 11;
  if (s === 10) {
    s = w2.reduce((a, w, i) => a + w * d[i]!, 0) % 11;
    if (s === 10) return null;
  }
  return s;
}

/** ИИН: YYMMDD + century/gender digit + 4 serial + checksum. */
export function makeIin(birth: Date, male: boolean, serial: number): string {
  const yy = String(birth.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(birth.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(birth.getUTCDate()).padStart(2, '0');
  const c = birth.getUTCFullYear() >= 2000 ? (male ? 5 : 6) : male ? 3 : 4;
  for (let k = 0; k < 50; k++) {
    const base = `${yy}${mm}${dd}${c}${String((serial + k) % 10000).padStart(4, '0')}`;
    const cs = checksum(base.split('').map(Number));
    if (cs !== null) return base + cs;
  }
  throw new Error('cannot build IIN');
}

/** БИН: YYMM + 4 (legal entity) + 0 + 5 serial + checksum. */
export function makeBin(year: number, month: number, serial: number): string {
  for (let k = 0; k < 50; k++) {
    const base = `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}40${String((serial + k) % 100000).padStart(5, '0')}`;
    const cs = checksum(base.split('').map(Number));
    if (cs !== null) return base + cs;
  }
  throw new Error('cannot build BIN');
}

export const MALE = {
  first: ['Нурлан', 'Ерлан', 'Айдар', 'Бауыржан', 'Данияр', 'Арман', 'Тимур', 'Асхат', 'Ержан', 'Руслан', 'Алихан', 'Дмитрий', 'Сергей', 'Марат', 'Санжар', 'Олжас', 'Алмас', 'Канат', 'Мирас', 'Артём'],
  last: ['Сарсенов', 'Ахметов', 'Турсунов', 'Омаров', 'Жанабаев', 'Сейтжанов', 'Калиев', 'Нурпеисов', 'Алимов', 'Байсарин', 'Кенесов', 'Есенов', 'Тлеубергенов', 'Смирнов', 'Петров', 'Мукашев', 'Исабеков', 'Касымов', 'Абдрахманов', 'Шукуров'],
  middle: ['Нурланович', 'Ерланович', 'Маратович', 'Канатович', 'Серикович', 'Бахытович', 'Алибекович', 'Ерканович', 'Сергеевич', 'Асхатович'],
};
export const FEMALE = {
  first: ['Жанара', 'Гульнар', 'Айгерим', 'Алия', 'Динара', 'Мадина', 'Асель', 'Әлия', 'Камила', 'Сауле', 'Айнур', 'Томирис', 'Ольга', 'Анна', 'Жулдыз', 'Дана', 'Аружан', 'Салтанат', 'Индира', 'Меруерт'],
  last: ['Абилова', 'Сагинова', 'Сулейменова', 'Ермекова', 'Оразова', 'Абдиева', 'Жумагалиева', 'Касымова', 'Рахметова', 'Серикова', 'Оспанова', 'Абдрахманова', 'Нурланова', 'Иванова', 'Ким', 'Бекова', 'Исмаилова', 'Токаева', 'Мусина', 'Ахметова'],
  middle: ['Султановна', 'Еркиновна', 'Талгатовна', 'Кайржановна', 'Нурлановна', 'Маратовна', 'Болатовна', 'Сериковна', 'Сергеевна', 'Бахытовна'],
};

export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)]!;
}

/** Kazakhstan transliteration for emails. */
export function translit(s: string): string {
  const map: Record<string, string> = {
    а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', і: 'i', к: 'k', қ: 'k', л: 'l', м: 'm', н: 'n', ң: 'n',
    о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'kh', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return s.toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[^a-z0-9]/g, '');
}

/** Public holidays of the Republic of Kazakhstan with weekend carry-over (Labor Code art. 84). */
export function kzHolidays(year: number): { date: string; kind: 'HOLIDAY' | 'TRANSFER_DAY_OFF'; name: string }[] {
  const kurban: Record<number, string> = { 2025: '06-06', 2026: '05-27', 2027: '05-16', 2028: '05-05' };
  const list: { md: string; name: string; religious?: boolean }[] = [
    { md: '01-01', name: 'Новый год' }, { md: '01-02', name: 'Новый год' },
    { md: '01-07', name: 'Рождество Христово', religious: true },
    { md: '03-08', name: 'Международный женский день' },
    { md: '03-21', name: 'Наурыз мейрамы' }, { md: '03-22', name: 'Наурыз мейрамы' }, { md: '03-23', name: 'Наурыз мейрамы' },
    { md: '05-01', name: 'Праздник единства народа Казахстана' }, { md: '05-07', name: 'День защитника Отечества' },
    { md: '05-09', name: 'День Победы' }, { md: '07-06', name: 'День Столицы' },
    { md: '08-30', name: 'День Конституции' }, { md: '10-25', name: 'День Республики' }, { md: '12-16', name: 'День Независимости' },
  ];
  if (kurban[year]) list.push({ md: kurban[year], name: 'Курбан айт', religious: true });
  const out: { date: string; kind: 'HOLIDAY' | 'TRANSFER_DAY_OFF'; name: string }[] = [];
  const taken = new Set<string>();
  for (const h of list) {
    const d = `${year}-${h.md}`;
    out.push({ date: d, kind: 'HOLIDAY', name: h.name });
    taken.add(d);
  }
  for (const h of list) {
    if (h.religious) continue;
    const d = new Date(`${year}-${h.md}T00:00:00Z`);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) continue;
    let next = new Date(d);
    do next = new Date(next.getTime() + 86_400_000);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6 || taken.has(next.toISOString().slice(0, 10)));
    const ds = next.toISOString().slice(0, 10);
    taken.add(ds);
    out.push({ date: ds, kind: 'TRANSFER_DAY_OFF', name: `Перенос: ${h.name}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
