/**
 * System catalogue of personal documents a candidate can be asked for (M1 p10–14, M3 0:20).
 * Field keys are stable identifiers used by the personal-file adapter, the 1С export and hire conversion.
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'file';
export type CatalogField = { key: string; label: string; labelKk: string; type: FieldType; required: boolean; options?: string[] };
export type CatalogDoc = { code: string; name: string; nameKk: string; autoFillable: boolean; fields: CatalogField[] };

const f = (key: string, label: string, labelKk: string, type: FieldType = 'text', required = false, options?: string[]): CatalogField => ({
  key, label, labelKk, type, required, ...(options ? { options } : {}),
});

const personBase = [
  f('iin', 'ИИН', 'ЖСН', 'text', true),
  f('lastName', 'Фамилия', 'Тегі', 'text', true),
  f('firstName', 'Имя', 'Аты', 'text', true),
  f('middleName', 'Отчество', 'Әкесінің аты'),
  f('birthDate', 'Дата рождения', 'Туған күні', 'date', true),
];

const medical = (code: string, name: string, nameKk: string): CatalogDoc => ({
  code, name, nameKk, autoFillable: true,
  fields: [
    f('iin', 'ИИН', 'ЖСН', 'text', true), f('lastName', 'Фамилия', 'Тегі', 'text', true),
    f('birthDate', 'Дата рождения', 'Туған күні', 'date', true), f('organization', 'Наименование организации', 'Ұйымның атауы', 'text', true),
    f('doctor', 'ФИО врача', 'Дәрігердің аты-жөні', 'text', true), f('issueDate', 'Дата', 'Күні', 'date', true),
    f('conclusion', 'Заключение', 'Қорытынды', 'textarea', true),
  ],
});

export const PERSONAL_DOC_CATALOG: CatalogDoc[] = [
  {
    code: 'ID_CARD', name: 'Удостоверение личности гражданина РК', nameKk: 'ҚР азаматының жеке куәлігі', autoFillable: true,
    fields: [
      ...personBase,
      f('gender', 'Пол', 'Жынысы', 'select', true, ['Мужской', 'Женский']),
      f('nationality', 'Национальность', 'Ұлты'), f('citizenship', 'Гражданство', 'Азаматтығы', 'text', true),
      f('birthPlace', 'Место рождения', 'Туған жері'), f('docNumber', 'Номер документа', 'Құжат нөмірі', 'text', true),
      f('issueDate', 'Дата выдачи', 'Берілген күні', 'date', true), f('expiryDate', 'Срок действия', 'Жарамдылық мерзімі', 'date', true),
      f('issuedBy', 'Кем выдан', 'Кім берді', 'text', true),
    ],
  },
  {
    code: 'PASSPORT', name: 'Паспорт', nameKk: 'Төлқұжат', autoFillable: true,
    fields: [...personBase, f('docNumber', 'Номер паспорта', 'Төлқұжат нөмірі', 'text', true), f('issueDate', 'Дата выдачи', 'Берілген күні', 'date', true), f('expiryDate', 'Срок действия', 'Жарамдылық мерзімі', 'date', true), f('issuedBy', 'Кем выдан', 'Кім берді')],
  },
  {
    code: 'EDUCATION', name: 'Документ об образовании', nameKk: 'Білімі туралы құжат', autoFillable: true,
    fields: [
      f('category', 'Категория образования', 'Білім санаты', 'select', true, ['Среднее', 'Среднее специальное', 'Высшее (бакалавриат)', 'Магистратура', 'Докторантура']),
      f('institution', 'Учебное заведение', 'Оқу орны', 'text', true), f('specialty', 'Специальность', 'Мамандығы'),
      f('course', 'Курс', 'Курс'), f('docType', 'Вид документа', 'Құжат түрі', 'select', false, ['Диплом', 'Аттестат', 'Свидетельство', 'Справка']),
      f('studyForm', 'Форма обучения', 'Оқу нысаны', 'select', false, ['очная', 'заочная', 'дистанционная']),
      f('startDate', 'Дата поступления', 'Түскен күні', 'date'), f('endDate', 'Дата окончания', 'Бітірген күні', 'date'),
      f('issueDate', 'Дата выдачи документа', 'Құжат берілген күні', 'date'), f('docNumber', 'Номер документа', 'Құжат нөмірі'),
    ],
  },
  {
    code: 'WORK_HISTORY', name: 'Сведения о трудовой деятельности', nameKk: 'Еңбек қызметі туралы мәліметтер', autoFillable: true,
    fields: [f('totalExperience', 'Общий стаж (лет)', 'Жалпы еңбек өтілі (жыл)', 'number'), f('lastEmployer', 'Последнее место работы', 'Соңғы жұмыс орны'), f('lastPosition', 'Последняя должность', 'Соңғы лауазымы'), f('lastEndDate', 'Дата увольнения', 'Жұмыстан шыққан күні', 'date'), f('history', 'Трудовая деятельность', 'Еңбек қызметі', 'textarea')],
  },
  {
    code: 'ADDRESS', name: 'Адрес по прописке', nameKk: 'Тіркеу мекенжайы', autoFillable: true,
    fields: [
      f('country', 'Страна', 'Ел', 'text', true), f('region', 'Область', 'Облыс', 'text', true), f('district', 'Регион', 'Аудан'),
      f('city', 'Город, населённый пункт', 'Қала, елді мекен', 'text', true), f('street', 'Улица', 'Көше', 'text', true),
      f('building', 'Здание', 'Үй', 'text', true), f('block', 'Корпус', 'Корпус'), f('apartment', 'Квартира', 'Пәтер'),
    ],
  },
  medical('MED_075', 'Медицинская справка 075/у', '075/у медициналық анықтама'),
  medical('TB_DISPENSARY', 'Справка из противотуберкулезного диспансера', 'Туберкулезге қарсы диспансерден анықтама'),
  medical('NARCO_DISPENSARY', 'Справка из наркологического диспансера', 'Наркологиялық диспансерден анықтама'),
  medical('PSYCHO_DISPENSARY', 'Справка из психоневрологического диспансера', 'Психоневрологиялық диспансерден анықтама'),
  { code: 'PHOTO', name: 'Фотография 3×4', nameKk: '3×4 фотосурет', autoFillable: true, fields: [] },
  {
    code: 'IBAN', name: 'Карточный счет (IBAN)', nameKk: 'Карточкалық шот (IBAN)', autoFillable: false,
    fields: [f('bank', 'Банк', 'Банк', 'text', true), f('iban', 'IBAN', 'IBAN', 'text', true), f('bic', 'БИК', 'БСК')],
  },
  {
    code: 'MILITARY_ID', name: 'Военный билет / приписное удостоверение', nameKk: 'Әскери билет / тіркеу куәлігі', autoFillable: false,
    fields: [f('docNumber', 'Номер документа', 'Құжат нөмірі', 'text', true), f('category', 'Категория годности', 'Жарамдылық санаты'), f('rank', 'Воинское звание', 'Әскери атағы'), f('office', 'Военкомат', 'Әскери комиссариат')],
  },
  {
    code: 'DRIVER_LICENSE', name: 'Водительское удостоверение', nameKk: 'Жүргізуші куәлігі', autoFillable: true,
    fields: [f('docNumber', 'Номер', 'Нөмірі', 'text', true), f('categories', 'Категории', 'Санаттары', 'text', true), f('issueDate', 'Дата выдачи', 'Берілген күні', 'date'), f('expiryDate', 'Срок действия', 'Жарамдылық мерзімі', 'date')],
  },
  {
    code: 'PENSION_CERT', name: 'Пенсионное и экологическое удостоверение', nameKk: 'Зейнетақы және экологиялық куәлік', autoFillable: false,
    fields: [f('docNumber', 'Номер', 'Нөмірі', 'text', true), f('issueDate', 'Дата выдачи', 'Берілген күні', 'date')],
  },
  {
    code: 'DISABILITY_CERT', name: 'Справка об инвалидности', nameKk: 'Мүгедектік туралы анықтама', autoFillable: false,
    fields: [f('group', 'Группа', 'Тобы', 'select', true, ['I', 'II', 'III']), f('validUntil', 'Действительна до', 'Жарамды мерзімі', 'date')],
  },
  {
    code: 'NO_CRIMINAL_RECORD', name: 'Справка о наличии/отсутствии судимости', nameKk: 'Сотталғандығы туралы анықтама', autoFillable: true,
    fields: [f('issueDate', 'Дата выдачи', 'Берілген күні', 'date', true), f('result', 'Результат', 'Нәтижесі', 'select', true, ['Не имеется', 'Имеется'])],
  },
  {
    code: 'MARRIAGE_CERT', name: 'Свидетельство о браке/расторжении брака', nameKk: 'Неке қию/бұзу туралы куәлік', autoFillable: true,
    fields: [f('kind', 'Вид', 'Түрі', 'select', true, ['О браке', 'О расторжении брака']), f('docNumber', 'Номер', 'Нөмірі'), f('date', 'Дата регистрации', 'Тіркелген күні', 'date'), f('spouse', 'ФИО супруга(-и)', 'Жұбайының аты-жөні')],
  },
  {
    code: 'CHILD_BIRTH_CERT', name: 'Свидетельство о рождении детей', nameKk: 'Балалардың туу туралы куәлігі', autoFillable: true,
    fields: [f('children', 'Дети (ФИО, дата рождения)', 'Балалар (аты-жөні, туған күні)', 'textarea', true)],
  },
  { code: 'RESUME', name: 'Резюме', nameKk: 'Түйіндеме', autoFillable: false, fields: [] },
];
