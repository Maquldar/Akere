# MEDIA_NOTES

How each input was processed, and what it contains. No PLAN.md was supplied, so these
materials are the plan (see SPEC.md → Conflicts C-0).

| ID | File | Type | How processed |
|----|------|------|---------------|
| M1 | `Doodocs_Final.pdf` | 41-page sales deck (RU), mostly product screenshots | `pdftotext -layout` + every page viewed as an image |
| M2 | `КП 2 ... ELK - Doodocs HR.pdf` | 9-page commercial proposal (RU) | `pdftotext -layout`, read in full |
| M3 | `WhatsApp_Video_2026-10-06_at_20.23.13.mp4` | 97 s, 464×832 vertical promo video, RU voice-over | ffmpeg: 1 frame / 4 s (24 frames); audio → faster-whisper `small` (lang ru, p=1.00) |
| M4 | `WhatsApp_Video_2026-10-06_at_20.23.17.mp4` | 141 s, 2880×1800 screen recording of a web app, RU voice-over | ffmpeg: 1 frame / 4 s (35 frames) + 6 full-res frames of key screens; audio → faster-whisper `small` (lang ru, p=0.99) |

Whisper spells brand names phonetically ("Дудок Сычар" = Doodocs HR, "IDNES/Одинес" = 1С,
"ИГОВ МОБАЕЛ" = eGov mobile, "ЯНПЕК" = Enbek). They are corrected below.

Personal contact details and the client-specific prices in M2 are left out on purpose.
They don't affect the build, and this repository may be public.

---

## M1: Doodocs_Final.pdf (sales deck "КЭДО: Перезагрузка кадровых процессов")

**Product:** Doodocs HR, a КЭДО system (кадровый электронный документооборот, electronic HR
document management) for Kazakhstan. It covers the whole cycle from hiring to dismissal.

**Problems it solves (p3):** manual document collection and data entry into 1С/Enbek;
paper signing; document risk across branch offices; paper archives; no visibility
into who signed; slow onboarding; no analytics; fines for late ESUTD registration.

**Value claims (p4–5):** hire an employee in 10 minutes, 80% less HR routine, integrations with
1С and Enbek.kz, full archive. Integrations shown: "Цифровое личное дело" (government
digital personal file), 1С (all configurations), eGov / eGov Mobile (ЭЦП signing), ЕСУТД (Enbek) contract registration.

### Screens (each one is a feature reference)

| Page | Screen | What is visible |
|------|--------|-----------------|
| p6 | **Реестр кандидатов** (candidate registry) | Left sidebar: Кандидаты; Справочники → Шаблоны запросов, Шаблоны анкет, Юридические лица; Пользователи; current user "Сулейменова Ж.А / Кадровый специалист"; Связаться с поддержкой; Выйти; badge "Модуль приёма кандидатов". Header: "Массовое добавление", "+ Новый кандидат". "Всего кандидатов: 121", "Настройки" (table settings). Columns: checkbox, ФИО (search input), comment icon, Статус (dropdown filter), Приглашение, Запрос документов, Проверка кандидата, Ответственный, Дата изменения (date range). Status values: **Новый, В работе, Принят, Выгружен, Заблокирован**. Invitation: **–, Отправлено, Принято**. Doc request: **Отправлен, Заполнение начато, Документы загружены, Завершен** (with colored dot). Check: **На проверке, Рекомендован, Рекомендован условно, Не рекомендован** (colored pills). |
| p7 | **Добавление кандидатов** | Breadcrumb "Кандидаты / Новый кандидат", Отменить / Сохранить. "Карточка кандидата": Юрлицо (select, e.g. ТОО "KazTech Innovations"), Фамилия*, Имя*, Отчество, Дата рождения, Пол (Мужской/Женский), Канал связи (Электронный адрес / Номер телефона / WhatsApp; "used for the invitation and candidate authorization"), Электронный адрес*, Номер телефона*. Modal **Массовое добавление**: 1) download import template, 2) fill one row per candidate, 3) upload file → "Создать кандидатов". |
| p8 | **Запрос документов** | Rows multi-selected → bar "Выбрано 3 · Выбрать всех · Запросить документы · ×". Modal: Кандидат (multi-chip select), Шаблон запроса (select) → Отменить / Отправить. |
| p9 | **Кандидат предоставляет доступ** (mobile) | Candidate cabinet: "Добро пожаловать, <ФИО>". "Цифровое личное дело" info box explaining: press "Заполнить автоматически" → SMS from government service to the phone tied to the ИИН → reply "511" to consent (512 = refuse) → documents load from the service, or fill missing fields manually → "Подтвердить готовность". Below: "Загрузите документы и заполните поля", accordion per document. Second phone: the real SMS consent thread (number 1414, RU/KZ text, reply 511). |
| p10 | **Готовый список документов кандидата** (HR view) | Breadcrumb Кандидаты / <name> / Запрос документов. Actions: **Отклонить, На доработку, Принять, Сохранить**. Accordion items, each with a "magic wand" (auto-filled) icon: Удостоверение личности гражданина РК; Справка из противотуберкулезного диспансера; Справка из наркологического диспансера; Документ об образовании; Сведения о трудовой деятельности; Медицинская справка 075/у; Паспорт; Фотография 3×4; Справка из психоневрологического диспансера; Адрес по прописке; Карточный счет (IBAN). Labels bilingual RU/KZ. Sidebar adds Администрирование → Пользователи, Юрлица; База знаний; Служба поддержки; language switch "Русский"; "?" help button. |
| p11 | Удостоверение личности | Left: upload zone (".doc, .docx, .pdf, .jpg, .jpeg, .png, .heic; max total 100 MB") + rendered "Личные данные" PDF from the gov service (photo, ФИО, ИИН, DOB, gender, nationality, citizenship, doc number, issue/expiry date, issuer). Right: "Заполните поля документа": ИИН, Фамилия, Имя, Отчество, Дата рождения, Пол, Национальность, Гражданство… each with an auto-fill marker. |
| p12 | Документ об образовании | Fields: Категория образования, Учебное заведение, Специальность, Курс, Вид документа, Форма обучения (очная), Дата поступления, Дата окончания, Дата выдачи документа, Номер документа. |
| p13 | Адрес по прописке | Fields: Страна*, Область*, Регион, Город/населённый пункт*, Улица*, Здание*, Корпус, Квартира. |
| p14 | Справки (075/у) | Fields: ИИН, Фамилия, Дата рождения*, Наименование организации*, ФИО врача*, Дата, Заключение*. |
| p15–20 | **1С side** ("Doodocs HR: загрузка кандидатов", a 1С external processing) | Filter Статус=Принят, Дата изменения, Теги; Обновить; organization select; list of candidates (Кандидат, Статус, Теги, Физическое лицо, Сотрудник) + side panel Телефон/E-mail/ИИН/Адрес; "Создать сотрудников" → 1С individual and employee records created; 1С employee card filled (DOB, ИИН, birthplace, citizenship, ID doc, photo). |
| p21 | **Отправка документов на подписание** | Two entry points: from 1С (Прием на работу → Приказ о приеме, Трудовой договор → "Отправить документы") and from Doodocs (Документы / Трудовой договор; tabs Общая информация, Документ, Вложения, Комментарии; Скачать). Employee sidebar: Документы (badge), Заявки, График отпусков, Заместители. |
| p22 | Mobile signing | Document card with route: signer list with "Подписано dd.mm.yyyy hh:mm", "Является заместителем: <name>" (deputy), next signer pending. "Выберите способ подписания": **eGov mobile (для физических лиц)** / **eGov mobile Business (для подписания юрлиц)**. eGov screen: QR expiry, from "Doodocs HR", documents to sign (1) → Подписать / Отказать → "Успешно подписано". |
| p23 | **Регистрация ТД в ЕСУТД** | Sidebar: Документы, Сотрудники, ЕСУТД (badge 5). Columns: Статус ЕСУТД (Не отправлено / Отправлено + timestamp), Номер (e.g. 12-06/24), Тип документа (Трудовой договор (3 приложения), Доп. соглашение к ТД №…, Отпуск (Социальный) с 05.05 по 14.05), Сотрудник (name + position, check mark), Руководитель. Bulk "Отправить в ЕСУТД". |
| p24–25 | Three cabinets | **Кабинет HR, Кабинет руководителя, Кабинет сотрудника**. Desktop and mobile access. |
| p26–30 | **Scenario: vacation request** | 1) Employee mobile "Новая" request: tabs Заполнение / Предпросмотр; Вид заявки (e.g. Заявление на неоплачиваемое отсутствие); Дата начала*, Дата окончания*; computed "Количество календарных дней", "Накоплено дней отпуска 24"; "Документ подтверждающий отсутствие*" (attachment); Далее. 2) System builds the e-document and routes it: card tabs Общая информация / Данные / Связи / Вложения; "Трудовой отпуск №332 от 17.09.2024"; status "Требуется доработать"; signer list with "Ожидается подписание • Просмотрено 17 сент. 14:32"; Юрлицо/Подразделение; Дата отправки заявки; buttons Посмотреть документ, Подписать, Еще действия. 3) Signed via eGov in a minute; route: **Руководитель → HR → Формирование приказа → Автоматическое подписание**. |
| p31 | **График отпусков** | "Планирование графика отпусков на 2026 г. ✓ Активно"; filters Статус, Работник, Подразделение, Должность; grid workers × months with vacation bars. Modal "Планирование отпуска": Правила оформления (collapsible), Работник, Необходимо запланировать: Основной отпуск 24 дн., Запланировано 0/24 дн.; date ranges (start*, end*, days, remove ×); Отменить / Сохранить / Согласовать. Modal "Согласование: Выбрано для согласования: 8, Из них можно согласовать: 7". Reminder 2 weeks before the vacation. Sidebar now: Документы, Заявки, ВНД, Заместители, График отпусков, Отчеты. |
| p32 | **Модуль ВНД** | HR sends internal regulations / safety instructions for acknowledgment and monitors the acknowledgment sheet. Doc page tabs "Документ" / "Ознакомление 100"; "+ Добавить получателя", "Лист ознакомления" (download); columns Получатель, Подразделение, Должность, Статус (На ознакомлении / Завершено). Modal "Добавить получателя: Работник (select)" → toast "Получатель добавлен". Full sidebar: Аналитика, Документы, Заявки, ВНД, Заместители, График отпусков, Отчёты, Работники, Справочники, ЕСУТД, Больничные. |
| p33 | ВНД registry + archive | Tabs Все / В процессе / Завершенные, "+ Новый ВНД", "Всего: 8". Columns Номер, Дата отправки (range), Тип документа, Ознакомление (12/24), Статус (На ознакомлении / Завершен / Черновик), comments count, Юрлицо. "Подтвердить ознакомление" panel: eGov QR ("1. Open eGov mobile 2. eGov QR 3. Scan") **or** "Подписать с ЭЦП НУЦ". Справочники page lists document types; role switcher "HR" under the user name. |
| p34 | Coming soon: Табель учёта рабочего времени | Calendar week view, per-worker rows with shifts (Дневная 09:00–18:00, Вечерняя), "12ч / 24ч", absence blocks (Ежегодный трудовой отпуск, Командировка, Выходной). Sidebar adds Календарь, Табель. |
| p35–41 | Marketing | Regulatory drivers (e-sick-leaves since Jan 2025, mandatory ESUTD registration, e-signing of contracts), ROI table for 1000 employees, client logos, demo call to action. No product features. |

**Visual style (M1):** light UI, white cards, very light-blue sidebar, primary blue buttons
(#1677ff-like), bright green brand accent (#00FF2A-like), colored status pills
(green/orange/red), dense data tables, accordion document lists, Inter-like sans-serif.

## M2: Commercial proposal (Doodocs HR for "ТОО ELK", dated 27.07.2026)

Modules and functions, all treated as requirements:
- **Candidate onboarding module:** invite via WhatsApp, Telegram, SMS; access to digital documents.
- **Employee cabinet:** create requests from the organization's document templates, send, sign, track. Auth by **OTP code + password** or **corporate account (Active Directory etc.)**.
- **HR cabinet:** single control center for HR documents: hiring, admission, transfer, dismissal. Incoming/outgoing documents, request processing, registries, reports.
- **Manager cabinet:** create and sign orders, **mass approve/sign**, status tracking, HR reports (hired/dismissed counts, headcount, etc.).
- **ЭЦП and QR signing:** NCALayer (desktop), eGov mobile, eGov mobile Business.
- **Configurable approval and signing business processes.**
- **Search and filtering** by filters on any document field.
- **Email notifications** for all document events and deadlines.
- **Execution control:** approval/signing deadlines.
- **Mass creation, signing, approval.**
- **Automatic numbering** of documents and drafts; registration number set automatically or manually; backdated registration; print and sign on paper.
- **Files:** any number of attachments per document card, **version tracking** per file.
- **Access control** by roles and rules; signing-authority management and ЭЦП rights check.
- **Scale:** >100 TB storage, secure storage.
- **Mobile:** email integration so approvals can be done from any device.
- **Electronic archive:** bulk upload and registration of archival documents.
- **Localization:** multilingual UI, reference data and business processes.
- **Integrations:** eGov mobile/business, NCALayer, ЕСУТД (Enbek.kz), digital personal file; SAP, 1С, Bitrix24, CRM/ERP; Active Directory, SSO; roaming with external EDMS; public API.
- **Infosec:** certified by an accredited lab.
- **Licensing model:** per tenant (legal entity, own data store) / per employee seat (transferable) / per HR-specialist seat; optional on-premises deployment; WhatsApp notifications billed per message; timesheet module priced per employee but **"не запрошен"** (not requested) for this client.
- **Timesheet module description:** shift planning, presence/absence tracking, timesheet for payroll, integration with accounting systems.

## M3: Video 1 (promo, 97 s)

| Time | Voice-over (corrected) | Visual |
|------|------------------------|--------|
| 0:00–0:13 | HR loses hours on collecting documents, manual entry and fixing errors. Doodocs HR removes the routine and covers all HR document flow: fast, error-free, fully online. | Title cards, marketing site on laptop and phone. |
| 0:13–0:33 | How it works: request documents from the candidate; enter ФИО and ИИН. The system pulls all digital documents from government databases: ID, medical certificates, diplomas, work history, address, even a 3×4 photo. | New-candidate form with **Способ авторизации и связи** (checkboxes: Электронная почта, WhatsApp; multiple allowed), **ИИН\*** with "ИИН отсутствует" checkbox, Дата рождения\*, Пол\*, "Дополнительно": Комментарий, Теги, Ответственный. **Request template editor** (Шаблоны запросов / Новый шаблон): name, tabs **Документы / Анкета**, "Документы для загрузки: выберите документы и поля для заполнения" list: ID document, passport, education/qualification document, military ID, driver's license, pension & ecological certificate, disability certificate, no-criminal-record certificate, marriage/divorce certificate, children's birth certificates, narcology/psychoneurology dispensary certificates, résumé, photo 3×4. |
| 0:33–0:43 | No manual entry. Physical person and employee are auto-created in 1С. Data arrives correct, with no tax-refund risk. | 1С screens. |
| 0:43–0:55 | Online signing of the document package: contract and orders signed by the **manager via eGov mobile Business**, by the **employee via eGov mobile**. Contract auto-registered in **Enbek (ЕСУТД)**. | eGov mobile: document list "Подписать документы", Face-ID-like biometric step, success. ESUTD registry. |
| 0:55–1:03 | **Electronic personal file**: a full e-dossier per employee, available to HR and the manager. | Работники / Профиль: name, ИИН; tabs **Профиль, Заявки и документы, Личные документы**; sub-tabs Общая информация, Место работы, Заместители, …; Общая информация: ФИО, ИИН, Дата рождения, Пол, Роли (Администратор…); Место работы: Юрлицо, Подразделение, Должность, Табельный номер, Накоплено дней отпуска (32). Sidebar: Аналитика, Документы, Заявки, ВНД, Заместители, График отпусков, Отчёты, Работники, Справочники, ЕСУТД, Больничные. |
| 1:03–1:12 | Requests from the phone (vacation, business trip, any request) in a couple of clicks; the manager approves from mobile. "Сотрудник видит количество отпускных дней" (employee sees vacation day balance). After approval, **HR launches the order for signing online**. | Mobile home "Популярные сервисы" tiles (Оформить отпуск, Оформить командировку…), list of request types (KZ), success screen. |
| 1:13–1:22 | Additional: ВНД with signing of safety instructions, vacation schedule, timesheets. | Mobile ВНД card "Требуется ознакомление", Посмотреть документ, Подписать. Mobile home "Доброе утро, Артём!": Расписание (date), Начало 09:00 / Перерыв 13:00–14:00 / Конец 18:00, "Отработано: 0ч 1мин / из 8ч", progress bar, **Отметить уход**, "Отметка принята, до перерыва 3ч 59мин", Календарь, Посещаемость, Популярные сервисы; toast "Отметка принята". |
| 1:23–1:36 | Automation: saves time, cuts HR admin costs, minimizes risk; full compliance with the Labor Code of the RK. | Closing cards, app store badges. |

## M4: Video 2 (timesheet module screen recording, 141 s, product "Doodocs People")

The URL is `demo-people.doodocs.kz`. This is a **newer UI** than M1: neutral grey/white, black
logo, dark-blue primary buttons. The sidebar is the newer navigation: "+ Новый документ (⌘K)",
Входящие; ДОКУМЕНТЫ: Все документы, Исходящие, Черновики; ОТСУТСТВИЯ: Мои отсутствия
(+ Отсутствия, График отпусков for managers); ЛЮДИ: Адаптация (+ Сотрудники); УЧЁТ РАБОЧЕГО
ВРЕМЕНИ: Моё время (+ Планирование, Табель); КОРПОРАТИВНЫЕ ДОКУМЕНТЫ: Все документы, Мои
документы; Мой профиль, (Настройки), user switcher at the bottom.

| Time | Voice-over (corrected) | Visual / interaction |
|------|------------------------|----------------------|
| 0:00–0:23 | The timesheet module. Companies spend hours on manual timesheets, Excel reconciliation, error hunting; month-end mass timesheet work. In Doodocs it's fully automated. | **/my-time "Моё время"**: "Добрый день, Элия · Понедельник, 22 Июня". Card **Моя смена**: badge "5/2 Разработка", red "Опоздание 7ч 25м", "10:00 – 19:00", button **Отметить приход**. Card **Расписание** (Все >): Вт 23 "Без сохранения" (orange, unpaid), Ср 24–Пт 26 10:00–19:00, Сб 27 Выходной. Card **Эта неделя 22–28 июня**: "0ч из 24ч", day tiles ПН–ВС (absence icons, planned blue tiles, hatched weekend), "Посмотреть все часы". Card **Мои запросы (1)**: "Работа в выходной/праздничный день · На согласовании". Card **Открытые смены (1)**: "Сб 27 · Дежурство поддержки · 09:00–21:00 · 12ч · Главный офис" + **Записаться**. |
| 0:23–0:51 | Employees mark start and end of the workday in a couple of clicks, also from the mobile app: mark arrival, **take a photo**; the system **identifies you** and checks by **geolocation** that you are actually at work. Mark leaving the same way. | Click Отметить приход → modal **"Подтвердите личность"**: camera circle, "Посмотрите прямо в камеру", **Сделать снимок** → "Верификация пройдена" ✓. Shift card turns into a live timer "0ч 0м ●", "До конца 1ч 34м", **Перерыв** / **Отметить уход**, check-in time 17:26; toast "Вы отметились в 17:26". Leaving: same verification → toast "Смена завершена · Итого 0ч 0м"; card shows Отработано 0м, Приход 17:26 (+7ч 26м late), Уход 17:26 (−1ч 34м early), Перерывы 0м, **Запросить корректировку**. |
| 0:51–1:14 | Real-time tracking of actual hours, overtime, lateness and absence. Each employee sees their monthly schedule with shifts, sick leave, etc. | **/my-time/schedule "Мой график"** tabs Мои часы / Мой график / Запросы; week "8 — 14 Июня", search, filter/settings icons; rows per teammate (name, position, "45.8 / 45ч" hours), cells "5/2 Разработка 10:00–19:00", red **Больничный 10 — 14 июнь** span; "Открытые смены: нет открытых"; footer ‹ Сегодня ›. User switcher list (demo switching between users and roles). |
| 1:14–1:42 | Managers: each manager keeps their own timesheet and **sees only their own employees**. They plan shifts, patterns **5/2, 2/2** etc., plan a whole month, plan shifts, **approve substitutions**. | **/scheduling "Планирование"** + **Опубликовать** button; icons filter, settings, **copy**, **+**; week grid; employee cells: "День офис 09:00–18:00" (teal), "5/2 Разработка" (grey), "Командировка 12–14 июнь" (blue span), "Командировка (Стамбул)", "Больничный" (red span); empty cell "+" → popover **НАЗНАЧИТЬ СМЕНУ** listing shift templates with color dot and time (Поддержка — утро 08:00–16:00 green, Поддержка — вечер 13:00–21:00 orange, Поддержка — полный 09:00–21:00 blue, Ранний день (внедрение) 08:00–17:00 grey, День офис 09:00–18:00 green) + **Создать смену**. Row shows planned/target hours "42.5 / 45ч". |
| 1:24 (also shown) | | **/timelog/today "Табель"** tabs **Сегодня / Отметки / Запросы / Форма Т-13**; date nav "Понедельник, 22 июня ‹ Сегодня ›"; KPI cards: **На смене сейчас 7/12** (progress), **Требуют внимания 3** (red, "3 без отметок"), **Переработки —**, **Закрыли смену 4/17** ("4ч 5м факт · −22ч 55м к плану"). Table: Сотрудник (name, position), Смена (shift chip), Статус (**Нет ухода** red, **Норма** green, **Недоработка** orange), Приход, Уход, **Хронология** (timeline bar: green worked segment, yellow break dot, purple overtime end), Отработано "9ч 29м / 9ч", Отклонение. |
| 1:42–2:13 | Data flows automatically into the timesheet in the required form, a single timesheet in **form T-13**, with no manual filling or reconciliation. | **/timelog/t13 "Форма Т-13"**: month nav "Июнь 2026", red pill "• 21 отклонение", "Подтверждение 1/8"; filter/settings/**download** icons (tooltip "Выгрузить T-13"); columns Сотрудник, **План, Факт, Норма, 1.5x, 2x**, then each day 1…30 with weekday header; cells show hours (8, 9) with sub-code letters: **С** (overtime, orange), **В** (weekend, grey), **К** (business trip, blue), **Б** (sick, blue), **О** (vacation, green), **БС** (unpaid leave, green), **НН** (absence, red-outlined), **РВ** (work on day off), **Н** (night); red outline = deviation; fact > norm in red/orange; red badge count next to employee name = deviations; footer **ИТОГО** row with column sums. Tooltip on hover: "Выходной или нерабочий праздничный день". |
| 2:02–2:21 | The finished timesheet exports to 1С in a few clicks, as Excel, to hand to the accountant. | Download button → Excel. |

**Visual style (M4):** neutral greys, white rounded cards with thin borders, black logo,
dark-blue (#2433d6-like) primary buttons, small uppercase section labels in the sidebar,
colored shift chips, timeline bars, compact numeric grid. This is the reference style for the
build (see SPEC.md C-3).
