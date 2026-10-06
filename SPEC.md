# SPEC: Akere HR (electronic HR document management + time tracking)

**Product (derived, see C-0):** a multi-tenant electronic HR document management system
(КЭДО) for companies in Kazakhstan. It covers candidate onboarding with document collection,
e-signing of HR documents through configurable routes, employee self-service requests,
vacation planning, acknowledgment of internal regulations (ВНД), contract registration with
the government (ЕСУТД), and time tracking with shift planning and the T-13 timesheet.

Source keys: **M1-pN** = Doodocs_Final.pdf page N · **M2** = commercial proposal ·
**M3@m:ss** = promo video · **M4@m:ss** = timesheet screen recording. Details in MEDIA_NOTES.md.

---

## 1. User roles and permissions

| Role | Who | Can |
|------|-----|-----|
| **Admin** (tenant administrator) | Company system owner | Everything in the tenant: users and roles, legal entities, reference data, templates, routes, integrations settings. |
| **HR** (кадровый специалист) | HR department | Candidates, employees, all HR documents of the legal entities they are assigned to, ВНД, vacation schedule campaigns, ЕСУТД, archive, timesheet for all employees, reports. |
| **Manager** (руководитель) | Department heads, directors | Own and subordinates' requests and documents; approve/sign (incl. mass); create orders; plan shifts and see the timesheet **only for their subordinates** (M4@1:17); approve vacation plans of subordinates; reports for their department. |
| **Employee** (сотрудник) | Every staff member | Own profile and e-dossier, create requests from templates, sign/acknowledge documents addressed to them, plan own vacation, clock in/out, see own schedule, correction requests, sign up for open shifts. |
| **Candidate** | External applicant | Only the candidate portal: OTP login via the chosen channel, upload/fill requested documents, confirm readiness. No access after hire conversion (they become an Employee). |

A user can hold several roles (M3@0:57 "Роли", M1-p33 role switcher). Permissions are
role-based plus scoped by legal entity and department (M2 "role and rule based access").
Signing authority (who may sign on behalf of a legal entity) is a separate flag (M2).

## 2. Feature list

### Candidate onboarding (Модуль приёма кандидатов)
| ID | Feature | Source |
|----|---------|--------|
| F-01 | **Candidate registry**: paginated table, total count, columns ФИО, comments, Статус, Приглашение, Запрос документов, Проверка кандидата, Ответственный, Дата изменения; per-column filters (search, selects, date range); column visibility settings; multi-select with bulk bar. | M1-p6, M1-p8 |
| F-02 | **Candidate card create/edit**: legal entity, surname*, name*, patronymic, ИИН* (or "ИИН отсутствует"), DOB, gender, contact channels (email / phone(SMS) / WhatsApp, multiple), email, phone, comment, tags, responsible HR. | M1-p7, M3@0:16 |
| F-03 | **Bulk candidate import** from an XLSX template (download template → upload → validation report → create). | M1-p7 |
| F-04 | **Request templates** (Шаблоны запросов): name + tab "Документы" (pick document types from a catalogue and which fields to fill) + tab "Анкета" (attach a questionnaire template). | M3@0:20, M1-p6 |
| F-05 | **Questionnaire templates** (Шаблоны анкет): custom form builder (text, number, date, select, checkbox, file). | M1-p6, M3@0:20 |
| F-06 | **Send document request** to one or many candidates with a template; invitation goes out by the candidate's channels; statuses update (Приглашение: Отправлено → Принято). | M1-p8, M2 |
| F-07 | **Candidate portal**: OTP login (code to email/phone/WhatsApp), welcome screen, accordion per requested document: upload files (.doc/.docx/.pdf/.jpg/.jpeg/.png/.heic, ≤100 MB total) + fill fields; questionnaire; "Подтвердить готовность". Mobile-first. | M1-p9, M1-p11 |
| F-08 | **Digital personal file autofill** ("Заполнить автоматически"): consent flow (simulated SMS 511/512) → document data and rendered "Личные данные" PDF pulled from the gov service through an adapter; fields marked as auto-filled. | M1-p9…14, M3@0:15 |
| F-09 | **HR review** of a candidate's package: per-document file preview + fields (editable), actions **Отклонить / На доработку (with comment) / Принять / Сохранить**; sets Проверка кандидата (На проверке, Рекомендован, Рекомендован условно, Не рекомендован). | M1-p10…14 |
| F-10 | **Candidate status pipeline**: Новый → В работе → Принят → Выгружен, or Заблокирован; doc-request status Отправлен → Заполнение начато → Документы загружены → Завершен (derived automatically from portal actions). | M1-p6 |
| F-11 | **Comments** thread on candidate (icon in registry shows there are comments). | M1-p6 |
| F-12 | **Hire conversion**: accepted candidate → Employee record + user account + e-dossier (personal documents carried over), with legal entity, department, position, hire date, tab number. | M1-p15…20, M3@0:33 |
| F-13 | **Accounting-system export (1С)**: REST endpoint + file export (JSON/XML/XLSX) of accepted candidates filtered by status/date/tags; marks them "Выгружен". | M1-p15…19, M3@0:34 |

### Documents and signing (КЭДО core)
| ID | Feature | Source |
|----|---------|--------|
| F-14 | **Document templates** per organization (employment contract, hire/transfer/dismissal/vacation orders, applications) with variables filled from employee/request data → generated PDF. | M2, M1-p21 |
| F-15 | **Document registry**: Входящие (awaiting me), Исходящие, Черновики, Все документы; filters on any field (type, status, number, date range, legal entity, employee, author); full-text search; pagination. | M2, M4 sidebar |
| F-16 | **Document card**: tabs Общая информация, Документ (PDF preview), Данные, Связи (linked docs, e.g. request → order), Вложения (any number of files **with version history**), Комментарии; download. | M1-p21, M1-p27, M2 |
| F-17 | **Configurable approval/signing routes**: per document type, ordered steps (approve / sign / acknowledge), assignee by role, by relation (employee's manager, HR of legal entity) or specific user; per-step status with timestamp and "viewed at"; return for rework ("Требуется доработать"); reject. | M2, M1-p27…30 |
| F-18 | **Electronic signature**: signing methods eGov mobile (individuals, QR), eGov mobile Business (legal entities, QR), NCALayer (desktop ЭЦП НУЦ) through a signing adapter; signature stored and verifiable; signed PDF with signature stamp page. | M1-p22, M1-p28, M1-p33, M2, M3@0:45 |
| F-19 | **Deputies** (Заместители): delegate approval/signing for a period; route shows "Является заместителем: X". | M1-p22, M1-p28 |
| F-20 | **Mass actions**: bulk create (e.g. one order for many employees), bulk approve, bulk sign. | M2 |
| F-21 | **Registration numbers**: auto numbering by document-type pattern (e.g. `12-06/24`), manual number override, backdated registration, "signed on paper" mode (upload scan). | M2, M1-p23 |
| F-22 | **Execution control**: due dates per route step, overdue highlighting, automatic reminders. | M2 |
| F-23 | **Notifications**: in-app notification center + email for every document event and deadline (email adapter). | M2 |
| F-24 | **ЕСУТД registry**: contracts, supplementary agreements, leaves with ЕСУТД status (Не отправлено / Отправлено + time / Ошибка), bulk "Отправить в ЕСУТД" through an adapter. | M1-p23, M3@0:52 |
| F-25 | **Electronic archive**: bulk upload and registration of archival (pre-existing, paper-signed) documents with metadata. | M2 |

### Employee self-service
| ID | Feature | Source |
|----|---------|--------|
| F-26 | **Requests** (Заявки) from templates: annual vacation, unpaid leave, business trip, others; form with dates → computed calendar days, current vacation balance shown, attachments; tabs Заполнение / Предпросмотр; submit. | M1-p26, M3@1:03 |
| F-27 | **Request workflow**: Manager approves → HR approves → order generated from template → order signed (manager/signatory, then employee) → request closed; all steps visible in the card. | M1-p30, M3@1:10 |
| F-28 | **Vacation balance**: accrual 24 calendar days/year (Labor Code RK base), pro-rated from hire date, decreased by approved vacations. | M1-p26, M1-p31 |
| F-29 | **Employee profile / e-dossier**: tabs Профиль (general info, place of work, deputies), Заявки и документы, Личные документы (from onboarding); visible to the employee, HR and their manager. | M3@0:57 |

### HR and manager tools
| ID | Feature | Source |
|----|---------|--------|
| F-30 | **Employees directory** (Работники): list with filters (legal entity, department, position, status), HR events **hire, transfer, dismissal** that generate the matching documents and run them through routes. | M2, M1-p32 |
| F-31 | **Reference data** (Справочники): legal entities, departments (tree), positions, document types, work locations. | M1-p6, M1-p33 |
| F-32 | **Users and roles** management (invite, roles, legal-entity scope, signing authority, deactivate; transferable seats). | M1-p6, M2 |
| F-33 | **Vacation schedule** (График отпусков): HR opens a yearly planning campaign; employees plan date ranges within entitlement (planned x/24); managers/HR approve individually or in bulk ("selected 8, can approve 7"); Gantt grid by month with filters (status, worker, department, position); reminder 14 days before vacation start. | M1-p31 |
| F-34 | **ВНД module**: create internal regulation (upload doc), add recipients (individuals, department, all), send for acknowledgment; employee acknowledges by signing; acknowledgment sheet with status per recipient + export; registry tabs Все / В процессе / Завершенные, counter 12/24, statuses Черновик / На ознакомлении / Завершен. | M1-p32, M1-p33, M3@1:13 |
| F-35 | **Analytics and reports**: hired/dismissed per period, headcount by legal entity/department, documents by status and overdue, ВНД completion, request volumes; manager sees own department. | M2, M1-p32 |
| F-36 | **Sick leaves** (Больничные): registry of sick-leave records (manual or via e-sick-leave adapter) feeding absences into the schedule and T-13. | M1-p32, M1-p36, M4@0:60 |

### Time tracking (Учёт рабочего времени)
| ID | Feature | Source |
|----|---------|--------|
| F-37 | **My time dashboard**: greeting/date, current shift card (template badge, lateness warning, times), clock in / break / clock out with live timer, week schedule list, week hours tiles, my requests, open shifts with "Записаться". | M4@0:00, M3@1:17 |
| F-38 | **Clock-in verification**: selfie capture via camera + geolocation check against the work location's geofence; result stored with the mark; failures flagged for review. | M4@0:28 |
| F-39 | **Time requests**: correction request (missed/incorrect mark), work on day off/holiday, substitution; manager approval. | M4@0:15, M4@0:56, M4@1:37 |
| F-40 | **My schedule / team schedule**: week view of my team's shifts and absences, hours planned/target per person. | M4@0:51 |
| F-41 | **Shift planning** (Планирование, manager): shift templates (name, time, break, color, location); work patterns 5/2, 2/2, custom cycle, applied over a range; assign/remove shift per cell; create shift; copy previous week; open shifts; absences overlay; draft → **Опубликовать**; manager sees only subordinates. | M4@1:14 |
| F-42 | **Timesheet "Today"**: KPI cards (on shift now, need attention, overtime, closed shifts) + table with shift, status (Норма / Нет ухода / Недоработка / Опоздание / Нет отметок), in, out, timeline bar, worked/planned, deviation; date navigation. Tabs Отметки (raw marks) and Запросы. | M4@1:24 |
| F-43 | **Form T-13**: monthly grid per employee: plan, fact, norm, 1.5x, 2x; daily hours + codes (В, К, Б, О, БС, НН, РВ, Н, С); deviations count; confirmation by managers (x/N); totals row; **export to Excel** in T-13 layout for 1С/accounting. | M4@1:42, M2 |

### Platform
| ID | Feature | Source |
|----|---------|--------|
| F-44 | **Auth**: email or phone + password, OTP second factor/OTP login; SSO / Active Directory through an adapter. | M2 |
| F-45 | **Multi-tenancy**: each customer company is a tenant with isolated data; a tenant has one or more legal entities. | M2 |
| F-46 | **Localization**: RU, KZ, EN UI; bilingual reference/document names (RU/KZ). | M2, M1-p10 |
| F-47 | **Responsive / mobile**: every cabinet usable on phones (installable PWA). | M1-p25, M3 |
| F-48 | **Help**: knowledge base page and support contact form ("База знаний", "Служба поддержки"). | M1-p10 |
| F-49 | **Messaging adapters** for candidate invitations and OTP: email, SMS, WhatsApp (Telegram optional). | M2 |
| F-50 | **Public REST API** with tenant API keys (used by 1С/ERP integrations, F-13, F-43 export). | M2 |

## 3. Additions (small essentials not in the materials)
| ID | Addition | Why |
|----|----------|-----|
| A-01 | Password reset via email/SMS OTP | Users forget passwords. |
| A-02 | Audit log (who did what, when; signature events) | Legal traceability of HR documents. |
| A-03 | Login rate limiting + lockout | Security baseline. |
| A-04 | Demo user switcher on the login page (seed users per role) | M4 shows one; needed to demo the role cabinets in a portfolio. Disabled in production mode. |
| A-05 | Health check endpoint | Ops. |

## 4. User flows

1. **Onboarding (core value):** HR creates candidate (or bulk import) → selects candidates → "Запросить документы" with template → candidate gets link + OTP → portal: "Заполнить автоматически" (consent) or upload manually → "Подтвердить готовность" → HR reviews each document → Принять → "Оформить": employee created → hire order + employment contract generated → route: Manager (eGov Business) signs → employee (eGov mobile) signs → contract appears in ЕСУТД registry → "Отправить в ЕСУТД" → status Отправлено → export to 1С.
2. **Vacation request:** employee opens "Оформить отпуск" → dates, sees balance → preview → submit → manager approves → HR approves → order generated → signatory signs → employee signs/acknowledges → balance decremented; absence appears in schedule and T-13.
3. **Vacation schedule:** HR starts 2027 campaign → employees plan ranges (must total entitlement) → managers bulk approve → schedule grid published → reminder 14 days before each vacation.
4. **ВНД:** HR creates ВНД, uploads file, adds recipients → sends → employees see "Требуется ознакомление" → sign → sheet fills → status Завершен when all done.
5. **Time tracking:** manager defines shift templates → plans month with 5/2 pattern → publishes → employee clocks in with selfie + geo → breaks → clocks out → today board updates → missed mark → employee files correction → manager approves → month end: managers confirm → HR exports T-13 to Excel.
6. **HR events:** HR opens employee → Перевод / Увольнение → document generated → route → signed → employee record updated (position change / terminated, seat freed).

## 5. Data entities (summary; full ERD in ARCHITECTURE.md)
Tenant, LegalEntity, Department, Position, WorkLocation, User, RoleAssignment, Employee,
Deputy, Candidate, CandidateComment, DocumentType (catalogue of personal documents + fields),
RequestTemplate, QuestionnaireTemplate, DocumentRequest, CandidateDocument (+ files, field values),
DocumentTemplate, Document, DocumentFile (+ versions), DocumentLink, DocumentComment,
Route, RouteStep, SignatureTask, Signature, NumberSequence, EsutdSubmission, Request,
VacationBalance (derived ledger), VacationCampaign, VacationPlan, VndDocument, VndRecipient,
SickLeave, ShiftTemplate, Shift, OpenShiftSignup, TimeMark, TimeRequest, TimesheetConfirmation,
Holiday (production calendar), Notification, AuditLog, ApiKey, OtpCode, Session.

## 6. Assumptions (defaults chosen)
- **AS-01** Product name **Akere HR** (repo name). Own logo and palette inspired by, not copied from, the references.
- **AS-02** Government and third-party integrations (Цифровое личное дело, eGov mobile/Business, NCALayer, ЕСУТД, 1С, SMS, WhatsApp, AD/SSO, e-sick-leaves) are built as **adapter interfaces with working sandbox implementations**. Real connections need accreditation, contracts and credentials (KNOWN_GAPS.md).
- **AS-03** Sandbox signing uses real cryptography (per-user key pair, signature over the document hash, verification). It simulates the eGov QR UX but has no legal force.
- **AS-04** Face verification sandbox: stores the selfie and runs a local "face present" check (adapter); real biometric matching is a known gap. Geofence check is real (haversine distance vs location radius).
- **AS-05** Vacation entitlement default 24 calendar days/year, configurable per employee. Calendar days exclude public holidays (Labor Code RK art. 88). The production calendar for KZ 2026–2027 is seeded.
- **AS-06** T-13 day codes follow the common KZ/RU timesheet letter codes seen in M4; the norm is computed from the production calendar (8 h/day, 40 h/week).
- **AS-07** Default routes: request → manager → HR; order → signatory (director with signing authority) → employee; contract → employer signatory → employee. All editable.
- **AS-08** Numbering default pattern `{seq}-{MM}/{YY}` per document type and legal entity, as in M1-p23.
- **AS-09** Languages RU (default), KZ, EN. UI strings fully translated; seed data in RU with KZ names where the references show them.
- **AS-10** Candidate portal is part of the same web app under `/portal`, with a separate auth (OTP only).
- **AS-11** Telegram channel is omitted from v1 (listed once in M2, absent from every screen).
- **AS-12** "Адаптация" (adaptation) appears only as a sidebar label in M4 with no detail. It is out of scope (not invented).
- **AS-13** Pricing/licensing is not built as billing. Seat counting (active employees and HR users per tenant) is shown in admin settings.

## 7. Conflicts
| ID | Conflict | Resolution |
|----|----------|------------|
| C-0 | The prompt template's inputs (PRODUCT, PLAN.md, CONSTRAINTS) were not filled in, and no PLAN.md exists. | The attached materials are the plan. The product line is derived from them (above). Priority order used: chat → M2 (written requirements) → M1/M3/M4 (media) → judgment. |
| C-1 | The materials are another company's product (Doodocs HR/People: names, logo, client logos). | Not reproduced. Build under **Akere HR** with its own identity. Function and flows follow the references; no brand assets, client names or personal data copied. |
| C-2 | M2 marks the timesheet module "not requested" and M1-p34 says "coming soon", but M4 demos it fully. | Included (F-37…F-43) as a late phase, so the core HR document product is complete first. |
| C-3 | Two different UI generations: M1 (light-blue sidebar, green brand, blue buttons) vs M4 (neutral grey, black logo, dark-blue buttons, sectioned sidebar). | Use the **M4 style and sidebar structure** (newer, cleaner) as the design system for all modules, with status-pill colors from M1. |
| C-4 | M1/M2 show 1С *pulling* candidates through a 1С extension; we can't ship 1С (BSL) code. | Provide the API + export files that such an extension consumes (F-13, F-50). The 1С-side processing is listed in KNOWN_GAPS. |
| C-5 | M3@0:16 shows contact channels as multi-select checkboxes, while M1-p7 shows a single radio. | Multi-select (newer screen). The first selected channel is used for OTP. |

## 8. Open questions (resolved 2026-10-06)
- Q1 Scope → **Core first, then extend.** Phases 1–4 (auth, onboarding, documents/signing, requests/vacations) are polished end to end before ВНД, ЕСУТД and the timesheet.
- Q2 Platform → **Responsive web + PWA.** No native app; camera and geolocation through browser APIs.
- Q3 Deployment → **Docker Compose, cloud-ready** (Postgres + S3-compatible storage; MinIO locally).
