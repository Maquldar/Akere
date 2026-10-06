# API contract: Akere HR (v1)

All agents build against this file. To change the contract, edit this file first, then the
code. Request/response schemas are implemented as Zod schemas in `packages/shared/src/schemas/*`
with the **same names** as the types below.

## 0. Conventions

- **Base URL:** `/api/v1`. The web app proxies `/api/*` to the API (same origin), so cookies are first-party.
- **Format:** JSON, UTF-8. Timestamps are ISO-8601 UTC (`2026-10-06T09:30:00.000Z`). Date-only fields are `YYYY-MM-DD` (type `DateStr`). IDs are cuid strings.
- **Auth:** session cookie `akere_session` (httpOnly, SameSite=Lax). Public API (§15) uses `Authorization: Bearer <apiKey>`.
- **CSRF:** every non-GET request with a cookie session must send `X-Requested-With: akere`, or it gets `403 CSRF`.
- **Locale:** `Accept-Language: ru|kk|en` picks the language of server-generated texts (emails, PDFs use document language).
- **Pagination:** list endpoints take `?page=1&pageSize=25` (max 100) and return
  ```ts
  type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
  ```
- **Sorting:** `?sort=field&order=asc|desc` where noted.
- **Errors:** non-2xx responses always have this body:
  ```ts
  type ApiError = { error: { code: ErrorCode; message: string; details?: unknown } }
  ```
  | HTTP | code | When |
  |------|------|------|
  | 400 | `VALIDATION_ERROR` | Zod validation failed; `details` = `{ fieldErrors: Record<string,string[]>, formErrors: string[] }` |
  | 401 | `UNAUTHENTICATED` | No/expired session |
  | 403 | `FORBIDDEN` | Lacks permission or outside scope |
  | 403 | `CSRF` | Missing `X-Requested-With` |
  | 404 | `NOT_FOUND` | Missing or other tenant's entity (never leak existence) |
  | 409 | `CONFLICT` | Unique violation / state conflict (e.g. already signed) |
  | 413 | `FILE_TOO_LARGE` | Upload over limit |
  | 415 | `UNSUPPORTED_FILE` | Disallowed type (magic-byte check) |
  | 422 | `BUSINESS_RULE` | Domain rule broken; `details.rule` names it (e.g. `INSUFFICIENT_VACATION_BALANCE`) |
  | 429 | `RATE_LIMITED` | Too many attempts; `details.retryAfterSec` |
  | 500 | `INTERNAL` | Unexpected; message is generic |
- **Permissions:** each endpoint lists the permission key(s) from `packages/shared/src/permissions.ts`. "Scoped" means results are filtered by row scope (HR → assigned legal entities, MANAGER → subordinate subtree, EMPLOYEE → self).
- **Files:** uploads are `multipart/form-data` with field `file` (one or more). Allowed: pdf, doc, docx, jpg, jpeg, png, heic, xlsx (per endpoint). Max 25 MB per file, 100 MB per candidate request. Downloads: `GET /files/:id` streams with `Content-Disposition`; access is checked against the owning entity.

### Shared types
```ts
type DateStr = string                    // YYYY-MM-DD
type Role = 'ADMIN'|'HR'|'MANAGER'|'EMPLOYEE'
type Locale = 'ru'|'kk'|'en'
type ContactChannel = 'EMAIL'|'SMS'|'WHATSAPP'
type Gender = 'MALE'|'FEMALE'
type UserRef = { id: string; fullName: string; shortName: string; position?: string|null; department?: string|null }
type FileRef = { id: string; filename: string; mime: string; size: number; url: string; createdAt: string }
type Option = { id: string; name: string }
```

## 1. Auth (`/auth`) — F-44, A-01, A-03, A-04

| Method | Path | Body | Response | Notes |
|--------|------|------|----------|-------|
| POST | `/auth/login` | `LoginInput { login: string /*email or phone*/, password: string }` | `200 LoginResult { status: 'OK', me: Me } \| { status: 'OTP_REQUIRED', channel: ContactChannel, maskedTarget: string }` | Rate limited 5/15 min per login+IP. 5 failures → account locked 15 min. |
| POST | `/auth/login/otp` | `{ code: string }` | `200 { status:'OK', me: Me }` | Completes 2FA for the pending session. |
| POST | `/auth/logout` | — | `204` | |
| GET | `/auth/me` | — | `200 Me` | `401` if no session. |
| POST | `/auth/password/forgot` | `{ login: string }` | `204` always (no account enumeration) | Sends OTP to email/phone. |
| POST | `/auth/password/reset` | `{ login: string, code: string, newPassword: string }` | `204` | Password policy: ≥ 10 chars, letters + digits. Invalidates all sessions. |
| POST | `/auth/password/change` | `{ currentPassword, newPassword }` | `204` | |
| GET | `/auth/demo-users` | — | `200 DemoUser[]` | Only when `DEMO_MODE=true`; else `404`. |
| POST | `/auth/demo-login` | `{ userId }` | `200 { status:'OK', me: Me }` | Only in `DEMO_MODE`. |

```ts
type Me = {
  id: string; email: string; phone: string|null; firstName: string; lastName: string; middleName: string|null
  fullName: string; locale: Locale; roles: { role: Role; legalEntityId: string|null; canSign: boolean }[]
  permissions: string[]; tenant: { id: string; name: string }
  employee: { id: string; legalEntityId: string; legalEntity: string; department: string|null; position: string|null; isManager: boolean } | null
  unreadNotifications: number
}
type DemoUser = { id: string; fullName: string; roles: Role[]; position: string|null }
```

## 2. Profile and notifications (`/me`) — F-23, F-29

| Method | Path | Body / Query | Response |
|--------|------|------|----------|
| PATCH | `/me` | `{ locale?: Locale, phone?: string, twoFactorEnabled?: boolean }` | `200 Me` |
| GET | `/me/notifications` | `?unread=true&page&pageSize` | `200 Page<Notification>` |
| POST | `/me/notifications/read` | `{ ids?: string[] /*omit = all*/ }` | `204` |
| GET | `/me/inbox-counts` | — | `200 { documents: number; requests: number; vnd: number; timeRequests: number }` (sidebar badges) |

```ts
type Notification = { id: string; type: string; title: string; body: string|null; link: string|null; readAt: string|null; createdAt: string }
```

## 3. Organization (`/org`) — F-31, F-32, F-45

Permissions: read = `org.read` (all staff); write = `org.manage` (ADMIN), `users.manage` (ADMIN).

| Method | Path | Body / Query | Response |
|--------|------|------|----------|
| GET | `/org/legal-entities` | — | `200 LegalEntity[]` |
| POST | `/org/legal-entities` | `LegalEntityInput { name, nameKk?, bin /*12 digits*/, address?, directorName? }` | `201 LegalEntity` |
| PATCH | `/org/legal-entities/:id` | `Partial<LegalEntityInput>` | `200 LegalEntity` |
| GET | `/org/departments` | `?legalEntityId` | `200 Department[]` (flat, with `parentId`) |
| POST | `/org/departments` | `{ legalEntityId, parentId?, name, nameKk? }` | `201 Department` |
| PATCH | `/org/departments/:id` | partial | `200 Department` |
| DELETE | `/org/departments/:id` | — | `204` (`409` if it has employees) |
| GET | `/org/positions` | — | `200 Position[]` |
| POST | `/org/positions` | `{ name, nameKk? }` | `201 Position` |
| PATCH | `/org/positions/:id` | partial | `200 Position` |
| GET | `/org/locations` | — | `200 WorkLocation[]` |
| POST | `/org/locations` | `{ name, address?, lat, lng, radiusM }` | `201 WorkLocation` |
| PATCH | `/org/locations/:id` | partial | `200 WorkLocation` |
| GET | `/org/users` | `?q&role&active&page&pageSize` | `200 Page<UserAdmin>` |
| POST | `/org/users` | `UserInput { email, phone?, firstName, lastName, middleName?, roles: RoleInput[], sendInvite: boolean }` | `201 UserAdmin` (invite email contains a set-password OTP link) |
| PATCH | `/org/users/:id` | `Partial<UserInput> & { isActive?: boolean }` | `200 UserAdmin` |
| GET | `/org/seats` | — | `200 { activeEmployees: number; hrUsers: number; legalEntities: number }` |
| GET | `/org/audit` | `?entityType&entityId&actorId&from&to&page&pageSize` | `200 Page<AuditEntry>` (`audit.read`) |
| GET | `/org/outbox` | `?channel&page&pageSize` | `200 Page<OutboxMessage>` (ADMIN; sandbox SMS/WhatsApp/email log) |

```ts
type LegalEntity = { id; name; nameKk: string|null; bin; address: string|null; directorName: string|null; employeeCount: number }
type Department = { id; legalEntityId; parentId: string|null; name; nameKk: string|null; employeeCount: number }
type Position = { id; name; nameKk: string|null }
type WorkLocation = { id; name; address: string|null; lat: number; lng: number; radiusM: number }
type RoleInput = { role: Role; legalEntityId: string|null; canSign: boolean }
type UserAdmin = { id; email; phone: string|null; fullName; firstName; lastName; middleName: string|null; isActive: boolean; roles: RoleInput[]; lastLoginAt: string|null; employeeId: string|null }
type AuditEntry = { id; action; entityType; entityId: string|null; actor: UserRef|null; meta: unknown; ip: string|null; createdAt }
type OutboxMessage = { id; channel: ContactChannel; to; subject: string|null; body; status: 'SENT'|'FAILED'; error: string|null; createdAt }
```

## 4. Employees (`/employees`) — F-29, F-30, F-28

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/employees` | `?q&legalEntityId&departmentId&positionId&status&managerId&page&pageSize&sort` | `200 Page<EmployeeListItem>` | `employee.read` (scoped) |
| GET | `/employees/options` | `?q&legalEntityId` | `200 UserRef[]` (≤ 50, for pickers; includes `employeeId` as `id`) | `employee.read` |
| GET | `/employees/:id` | — | `200 EmployeeProfile` | `employee.read` (scoped; self always) |
| PATCH | `/employees/:id` | `EmployeeUpdate { departmentId?, positionId?, managerId?, locationId?, tabNumber?, vacationDaysPerYear?, personal? }` | `200 EmployeeProfile` | `employee.manage` |
| GET | `/employees/:id/documents` | `?page&pageSize` | `200 Page<DocumentListItem>` (documents about this employee) | scoped |
| GET | `/employees/:id/personal-documents` | — | `200 CandidateDocumentView[]` (from onboarding) | scoped |
| GET | `/employees/:id/vacation-balance` | — | `200 VacationBalance` | scoped |
| POST | `/employees/:id/vacation-adjustments` | `{ days: number, date: DateStr, note: string }` | `201 VacationBalance` | `employee.manage` |
| POST | `/employees/:id/events/transfer` | `{ effectiveDate: DateStr, departmentId?, positionId?, managerId?, salary?: number, reason?: string }` | `201 DocumentDetail` (transfer order in route) | `employee.manage` |
| POST | `/employees/:id/events/dismissal` | `{ effectiveDate: DateStr, reason: string, article: string }` | `201 DocumentDetail` (dismissal order in route) | `employee.manage` |
| GET | `/deputies` | `?mine=true` | `200 DeputyItem[]` | `deputy.read` |
| POST | `/deputies` | `{ principalUserId /*self unless admin*/, deputyUserId, startDate, endDate }` | `201 DeputyItem` | `deputy.manage` (self) |
| DELETE | `/deputies/:id` | — | `204` | |

```ts
type EmployeeListItem = { id; userId; fullName; tabNumber; legalEntity: Option; department: Option|null; position: Option|null; manager: UserRef|null; status: 'ACTIVE'|'TERMINATED'; hireDate: DateStr; email; phone: string|null }
type EmployeeProfile = EmployeeListItem & {
  iin: string|null; birthDate: DateStr|null; gender: Gender|null; terminationDate: DateStr|null
  location: Option|null; roles: Role[]; vacationDaysPerYear: number; vacationBalance: number
  personal: Record<string, unknown>; photoUrl: string|null; deputies: DeputyItem[]
  candidateId: string|null
}
type VacationBalance = { available: number; accrued: number; used: number; adjusted: number; perYear: number; entries: { id; type: 'ACCRUAL'|'USAGE'|'ADJUSTMENT'; days: number; date: DateStr; note: string|null }[] }
type DeputyItem = { id; principal: UserRef; deputy: UserRef; startDate: DateStr; endDate: DateStr; active: boolean }
```

## 5. Candidate onboarding (`/candidates`, `/onboarding`) — F-01…F-13

Permissions: `candidate.read`, `candidate.manage` (HR, ADMIN), scoped by legal entity.

| Method | Path | Body / Query | Response |
|--------|------|------|----------|
| GET | `/candidates` | `CandidateFilter ?q&status&invitationStatus&docRequestStatus&checkStatus&responsibleUserId&legalEntityId&tag&updatedFrom&updatedTo&page&pageSize&sort=updatedAt\|lastName&order` | `200 Page<CandidateListItem>` |
| POST | `/candidates` | `CandidateInput` | `201 CandidateDetail` |
| GET | `/candidates/:id` | — | `200 CandidateDetail` |
| PATCH | `/candidates/:id` | `Partial<CandidateInput> & { status?: CandidateStatus }` | `200 CandidateDetail` |
| DELETE | `/candidates/:id` | — | `204` (only `NEW` with no requests; else `409`) |
| GET | `/candidates/import-template` | — | `200` xlsx file |
| POST | `/candidates/import` | multipart `file` (xlsx), field `legalEntityId` | `200 ImportResult` (`?dryRun=true` validates only) |
| POST | `/candidates/request-documents` | `{ candidateIds: string[] /*1..200*/, requestTemplateId }` | `200 { sent: number; skipped: { candidateId; reason }[] }` |
| POST | `/candidates/:id/resend-invite` | — | `204` |
| GET | `/candidates/:id/comments` | — | `200 CandidateCommentItem[]` |
| POST | `/candidates/:id/comments` | `{ text: string /*1..2000*/ }` | `201 CandidateCommentItem` |
| GET | `/candidates/:id/request` | — | `200 DocumentRequestView` (latest request with documents) / `404` |
| PATCH | `/candidates/:id/request/documents/:docId` | `{ values: Record<string, unknown> }` | `200 CandidateDocumentView` (HR edits fields) |
| POST | `/candidates/:id/request/documents/:docId/files` | multipart `file` | `201 FileRef` |
| POST | `/candidates/:id/request/review` | `ReviewInput { decision: 'ACCEPT'\|'RETURN'\|'REJECT'; comment?: string; checkStatus?: CandidateCheck; returnDocIds?: string[] }` | `200 CandidateDetail` |
| POST | `/candidates/:id/hire` | `HireInput { legalEntityId, departmentId, positionId, managerId?, locationId?, hireDate: DateStr, tabNumber?: string, salary: number, probationMonths?: number, generateDocuments: boolean }` | `201 { employeeId: string; documentIds: string[] }` |
| POST | `/candidates/export` | `{ candidateIds?: string[]; format: 'json'\|'xml'\|'xlsx'; markExported: boolean }` | `200` file. Default selection = status `ACCEPTED`. |
| GET | `/onboarding/personal-doc-types` | — | `200 PersonalDocTypeView[]` |
| GET | `/onboarding/request-templates` | — | `200 RequestTemplateView[]` |
| POST | `/onboarding/request-templates` | `RequestTemplateInput { name; questionnaireTemplateId?: string\|null; items: { personalDocTypeId; required: boolean; fieldKeys: string[] }[] }` | `201 RequestTemplateView` |
| GET/PATCH/DELETE | `/onboarding/request-templates/:id` | `RequestTemplateInput` | `200 RequestTemplateView` / `204` |
| GET | `/onboarding/questionnaires` | — | `200 QuestionnaireView[]` |
| POST | `/onboarding/questionnaires` | `QuestionnaireInput { name; fields: FormField[] }` | `201 QuestionnaireView` |
| GET/PATCH/DELETE | `/onboarding/questionnaires/:id` | `QuestionnaireInput` | `200` / `204` |

```ts
type CandidateStatus = 'NEW'|'IN_PROGRESS'|'ACCEPTED'|'EXPORTED'|'BLOCKED'
type InvitationStatus = 'NONE'|'SENT'|'ACCEPTED'
type DocRequestStatus = 'NONE'|'SENT'|'FILLING'|'UPLOADED'|'COMPLETED'|'RETURNED'
type CandidateCheck = 'NONE'|'ON_REVIEW'|'RECOMMENDED'|'CONDITIONAL'|'NOT_RECOMMENDED'
type CandidateInput = {
  legalEntityId: string; lastName: string; firstName: string; middleName?: string|null
  iin?: string|null /*12 digits, checksum validated*/; noIin?: boolean; birthDate?: DateStr|null; gender?: Gender|null
  channels: ContactChannel[] /*≥1*/; email?: string|null /*required if EMAIL*/; phone?: string|null /*E.164 +7…; required if SMS/WHATSAPP*/
  comment?: string|null; tags?: string[]; responsibleUserId?: string|null
  departmentId?: string|null; positionId?: string|null; plannedHireDate?: DateStr|null
}
type CandidateListItem = { id; fullName; status: CandidateStatus; invitationStatus: InvitationStatus; docRequestStatus: DocRequestStatus; checkStatus: CandidateCheck; responsible: UserRef|null; legalEntity: Option; commentsCount: number; tags: string[]; updatedAt: string }
type CandidateDetail = CandidateListItem & CandidateInput & { createdAt: string; employeeId: string|null; exportedAt: string|null; position: Option|null; department: Option|null }
type ImportResult = { created: number; errors: { row: number; field: string; message: string }[] }
type FormField = { key: string; label: string; labelKk?: string; type: 'text'|'textarea'|'number'|'date'|'select'|'checkbox'|'file'; required: boolean; options?: string[] }
type PersonalDocTypeView = { id; code; name; nameKk: string|null; fields: FormField[]; autoFillable: boolean }
type RequestTemplateView = { id; name; questionnaire: Option|null; items: { personalDocType: PersonalDocTypeView; required: boolean; fieldKeys: string[] }[]; updatedAt: string }
type QuestionnaireView = { id; name; fields: FormField[]; updatedAt: string }
type CandidateDocumentView = { id; docType: PersonalDocTypeView; required: boolean; fieldKeys: string[]; status: 'PENDING'|'FILLED'|'ACCEPTED'|'RETURNED'; values: Record<string, unknown>; autoFilledKeys: string[]; files: FileRef[]; returnComment: string|null }
type DocumentRequestView = { id; status: DocRequestStatus; consentStatus: 'NONE'|'REQUESTED'|'GRANTED'|'DENIED'; template: Option; questionnaire: QuestionnaireView|null; questionnaireAnswers: Record<string, unknown>; documents: CandidateDocumentView[]; readyAt: string|null; reviewedAt: string|null; reviewComment: string|null; createdAt: string }
type CandidateCommentItem = { id; text; author: UserRef|null; byCandidate: boolean; createdAt }
```

**State rules:** sending a request sets `invitationStatus=SENT`, `docRequestStatus=SENT`, `status=IN_PROGRESS`. First portal login → `invitationStatus=ACCEPTED`. First field save → `FILLING`. Confirm readiness → `UPLOADED` + `checkStatus=ON_REVIEW`. Review ACCEPT → `COMPLETED`, `status=ACCEPTED`, all docs `ACCEPTED`; RETURN → `RETURNED` (portal reopens listed docs); REJECT → `status=BLOCKED`. Export with `markExported` → `EXPORTED`. Hire requires `status ∈ {ACCEPTED, EXPORTED}`.

## 6. Candidate portal (`/portal`) — F-07, F-08

Candidate session only (`subjectType=CANDIDATE`). Each candidate only sees their own latest request.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/portal/auth/request-code` | `{ login: string /*email or phone*/ }` | `200 { channel: ContactChannel; maskedTarget: string }` always (no enumeration); rate limited |
| POST | `/portal/auth/verify` | `{ login, code }` | `200 PortalMe` |
| POST | `/portal/auth/logout` | — | `204` |
| GET | `/portal/me` | — | `200 PortalMe` |
| GET | `/portal/request` | — | `200 DocumentRequestView` |
| PATCH | `/portal/request/documents/:docId` | `{ values: Record<string, unknown> }` | `200 CandidateDocumentView` |
| POST | `/portal/request/documents/:docId/files` | multipart `file` | `201 FileRef` |
| DELETE | `/portal/request/documents/:docId/files/:fileId` | — | `204` |
| PATCH | `/portal/request/questionnaire` | `{ answers: Record<string, unknown> }` | `200 DocumentRequestView` |
| POST | `/portal/request/autofill/consent` | — | `200 { status: 'REQUESTED'; smsPreview: string /*sandbox text of the gov SMS*/ }` |
| POST | `/portal/request/autofill/reply` | `{ reply: '511'\|'512' }` | `200 DocumentRequestView` (on 511: fills all autoFillable docs, attaches generated "Личные данные" PDF) |
| POST | `/portal/request/submit` | — | `200 DocumentRequestView` (`422 BUSINESS_RULE rule=REQUIRED_MISSING details.missing[]` if required docs/fields missing) |
| GET | `/portal/files/:id` | — | file stream |

```ts
type PortalMe = { candidateId: string; fullName: string; legalEntity: string; locale: Locale }
```

## 7. Documents (`/documents`) — F-14…F-23, F-25

Permissions: `document.read` (scoped: author, assignee of any step, subject employee, HR of the legal entity, manager of the subject), `document.create`, `document.manage` (HR/ADMIN: templates, types, routes, numbering).

| Method | Path | Body / Query | Response |
|--------|------|------|----------|
| GET | `/documents` | `DocumentFilter ?box=inbox\|outbox\|drafts\|all\|archive&q&kind&documentTypeId&status&legalEntityId&subjectEmployeeId&authorId&dateFrom&dateTo&overdue&page&pageSize&sort=createdAt\|number\|dueAt&order` | `200 Page<DocumentListItem>` |
| POST | `/documents` | `DocumentCreate { documentTypeId; legalEntityId; title?; subjectEmployeeId?; data: Record<string, unknown>; dueAt?: string; startRoute: boolean }` | `201 DocumentDetail` (PDF generated from template if the type has one) |
| POST | `/documents/bulk` | `{ documentTypeId; legalEntityId; subjectEmployeeIds: string[] /*1..200*/; data; startRoute: boolean }` | `201 { documentIds: string[] }` (F-20) |
| GET | `/documents/:id` | — | `200 DocumentDetail` (marks the current user's pending step `viewedAt`) |
| PATCH | `/documents/:id` | `{ title?; data?; dueAt? }` (DRAFT/REWORK only; regenerates PDF) | `200 DocumentDetail` |
| DELETE | `/documents/:id` | — | `204` (DRAFT only) |
| POST | `/documents/:id/start` | — | `200 DocumentDetail` (DRAFT/REWORK → IN_ROUTE, registers number if not set) |
| POST | `/documents/:id/cancel` | `{ reason }` | `200 DocumentDetail` (author/HR, not COMPLETED) |
| POST | `/documents/:id/register` | `{ number?: string /*manual*/; registeredAt?: DateStr /*backdate*/ }` | `200 DocumentDetail` (`409` if number taken) |
| POST | `/documents/:id/approve` | `{ comment? }` | `200 DocumentDetail` (current user's APPROVE/ACKNOWLEDGE step without ЭЦП) |
| POST | `/documents/:id/return` | `{ comment: string }` | `200 DocumentDetail` (→ REWORK; author notified) |
| POST | `/documents/:id/reject` | `{ comment: string }` | `200 DocumentDetail` (→ REJECTED) |
| POST | `/documents/bulk-approve` | `{ documentIds: string[] }` | `200 BulkResult` |
| POST | `/documents/:id/paper-signed` | multipart `file` (scan) + field `registeredAt?` | `200 DocumentDetail` (HR; completes route as PAPER) |
| GET | `/documents/:id/pdf` | `?signed=true` | PDF stream (signed version has signature sheet appended) |
| GET | `/documents/:id/files` | — | `200 DocumentFileView[]` |
| POST | `/documents/:id/files` | multipart `file`, field `documentFileId?` (new version of existing) | `201 DocumentFileView` |
| GET | `/documents/:id/comments` | — | `200 DocumentCommentItem[]` |
| POST | `/documents/:id/comments` | `{ text }` | `201 DocumentCommentItem` |
| POST | `/documents/:id/links` | `{ toId: string; relation: string }` | `201 DocumentLinkItem` |
| DELETE | `/documents/:id/links/:linkId` | — | `204` |
| GET | `/documents/:id/signatures/verify` | — | `200 { valid: boolean; signatures: { signer: UserRef; method: SignMethod; signedAt: string; valid: boolean }[] }` |

**Archive (F-25):**

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/documents/archive` | multipart: `files[]` + JSON field `meta` = `ArchiveItem[]` (same order: `{ documentTypeId; legalEntityId; title; number?; registeredAt: DateStr; subjectEmployeeId? }`) | `201 { documentIds: string[]; errors: { index; message }[] }` (status COMPLETED, kind ARCHIVE, paperSigned) |

**Signing (F-18, F-20):**

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/signing/sessions` | `{ documentIds: string[] /*1..100*/; method: 'EGOV_MOBILE'\|'EGOV_BUSINESS'\|'NCALAYER' }` | `201 SigningSessionView` (only docs where the user has a pending SIGN/ACKNOWLEDGE step; `422 rule=NOTHING_TO_SIGN` otherwise; EGOV_BUSINESS requires `canSign` for the legal entity) |
| GET | `/signing/sessions/:id` | — | `200 SigningSessionView` (poll for status) |
| GET | `/signing/qr/:token` | — | `200 { session: SigningSessionView; documents: { id; title; number: string\|null }[] }` (opened on the phone; the "eGov mobile sandbox" page; requires the same user's session) |
| POST | `/signing/qr/:token/confirm` | `{ decision: 'SIGN'\|'DECLINE' }` | `200 SigningSessionView` |
| POST | `/signing/sessions/:id/ncalayer` | `{ pin: string }` | `200 SigningSessionView` (sandbox: pin = user's signing PIN, default `123456` in seed) |
| POST | `/signing/sessions/:id/cancel` | — | `204` |

**Configuration (HR/ADMIN, `document.manage`):**

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/document-types` | `?kind&active` | `200 DocumentTypeView[]` |
| POST | `/document-types` | `DocumentTypeInput { code; name; nameKk?; kind; numberPattern; templateId?; routeTemplateId?; esutdRequired; isActive }` | `201 DocumentTypeView` |
| PATCH | `/document-types/:id` | partial | `200 DocumentTypeView` |
| GET | `/document-templates` | — | `200 DocumentTemplateView[]` |
| POST | `/document-templates` | `{ name; body: TemplateBlock[] }` | `201 DocumentTemplateView` |
| GET/PATCH | `/document-templates/:id` | same | `200 DocumentTemplateView` |
| POST | `/document-templates/:id/preview` | `{ data: Record<string, unknown>; subjectEmployeeId?; legalEntityId }` | PDF stream |
| GET | `/document-templates/variables` | — | `200 { key: string; label: string; example: string }[]` |
| GET | `/route-templates` | — | `200 RouteTemplateView[]` |
| POST | `/route-templates` | `{ name; steps: RouteStepDef[] }` | `201 RouteTemplateView` |
| GET/PATCH/DELETE | `/route-templates/:id` | same | `200` / `204` (`409` if in use) |

```ts
type DocumentKind = 'GENERIC'|'CONTRACT'|'SUPPLEMENTARY'|'ORDER'|'APPLICATION'|'VND'|'ARCHIVE'
type DocumentStatus = 'DRAFT'|'IN_ROUTE'|'REWORK'|'COMPLETED'|'REJECTED'|'CANCELLED'
type StepAction = 'APPROVE'|'SIGN'|'ACKNOWLEDGE'
type StepStatus = 'WAITING'|'PENDING'|'DONE'|'REJECTED'|'RETURNED'|'SKIPPED'
type SignMethod = 'EGOV_MOBILE'|'EGOV_BUSINESS'|'NCALAYER'|'PAPER'|'CLICK'
type AssigneeRule = 'USER'|'ROLE_HR'|'MANAGER_OF_SUBJECT'|'SUBJECT'|'SIGNATORY'|'AUTHOR'
type RouteStepDef = { order: number; action: StepAction; rule: AssigneeRule; userId?: string; dueDays?: number }
type TemplateBlock =
  | { type: 'heading'; text: string; align?: 'left'|'center' }
  | { type: 'paragraph'; text: string }
  | { type: 'fields'; rows: { label: string; value: string }[] }
  | { type: 'signatures'; parties: { label: string; name: string }[] }
  | { type: 'spacer' }
// text/value may contain {{variable.path}} placeholders
type DocumentListItem = { id; title; number: string|null; kind: DocumentKind; type: Option; status: DocumentStatus; legalEntity: Option; subject: UserRef|null; author: UserRef; currentStep: { action: StepAction; assignee: UserRef; dueAt: string|null } | null; myPendingAction: StepAction|null; dueAt: string|null; overdue: boolean; createdAt; updatedAt }
type RouteStepView = { id; order; action: StepAction; status: StepStatus; assignee: UserRef; actedBy: UserRef|null; onBehalfOf: UserRef|null /*deputy case*/; dueAt: string|null; viewedAt: string|null; actedAt: string|null; comment: string|null; signatureMethod: SignMethod|null }
type DocumentDetail = DocumentListItem & {
  data: Record<string, unknown>; registeredAt: DateStr|null; backdated: boolean; paperSigned: boolean
  pdfUrl: string|null; signedPdfUrl: string|null; steps: RouteStepView[]
  files: DocumentFileView[]; links: DocumentLinkItem[]; commentsCount: number
  esutd: { status: EsutdStatus; sentAt: string|null; error: string|null } | null
  canEdit: boolean; canStart: boolean; canCancel: boolean; canRegister: boolean
  request: { id: string; status: RequestStatus } | null
}
type DocumentFileView = { id; name; currentVersion: number; versions: { version: number; file: FileRef; uploadedBy: UserRef; createdAt: string }[] }
type DocumentLinkItem = { id; relation: string; direction: 'from'|'to'; document: { id; title; number: string|null; status: DocumentStatus } }
type DocumentCommentItem = { id; text; author: UserRef; createdAt }
type BulkResult = { succeeded: string[]; failed: { id: string; reason: string }[] }
type SigningSessionView = { id; method: SignMethod; status: 'PENDING'|'COMPLETED'|'CANCELLED'|'EXPIRED'; qrDataUrl: string|null /*data:image/png*/; qrUrl: string|null; expiresAt: string; documentIds: string[]; signedCount: number }
type DocumentTypeView = DocumentTypeInput & { id; template: Option|null; routeTemplate: Option|null }
type DocumentTemplateView = { id; name; body: TemplateBlock[]; updatedAt: string }
type RouteTemplateView = { id; name; steps: RouteStepDef[]; usedBy: number; updatedAt: string }
```

**Route engine rules:** on start, steps with the lowest `order` become PENDING (all parallel ones). When all steps of an order are DONE, the next order activates. RETURN sets the document to REWORK and resets all steps to WAITING; restarting begins at order 1. REJECT ends the route. A deputy (active Deputy record for the assignee) can act; the step records `actedById` and the signature `onBehalfOfUserId`. When the last step finishes → `COMPLETED`, signed PDF generated, hooks fire (request completion, ESUTD queue, VND acknowledgment, employee updates for transfer/dismissal). Reminders: a job runs hourly, notifying assignees of steps due within 24 h and overdue steps (once per day).

## 8. Requests (`/requests`) — F-26, F-27

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/request-types` | — | `200 RequestTypeView[]` | `request.create` |
| GET | `/requests` | `?scope=mine\|team\|all&status&requestTypeId&employeeId&page&pageSize` | `200 Page<RequestListItem>` | `request.read` (scoped) |
| POST | `/requests` | `RequestInput { requestTypeId; startDate?; endDate?; data: Record<string, unknown>; attachmentFileIds?: string[]; submit: boolean }` | `201 RequestDetail` | `request.create` |
| POST | `/requests/preview` | `RequestInput` | `200 { days: number; balanceAfter: number\|null; pdfDataUrl: string; warnings: string[] }` | `request.create` |
| GET | `/requests/:id` | — | `200 RequestDetail` | scoped |
| PATCH | `/requests/:id` | `RequestInput` (DRAFT/REWORK) | `200 RequestDetail` | owner |
| POST | `/requests/:id/submit` | — | `200 RequestDetail` | owner |
| POST | `/requests/:id/cancel` | — | `200 RequestDetail` | owner (before COMPLETED) |
| POST | `/uploads` | multipart `file` | `201 FileRef` (temporary attachment, linked on submit; purged after 24 h if unused) | any staff |

```ts
type RequestStatus = 'DRAFT'|'IN_APPROVAL'|'REWORK'|'ORDER_SIGNING'|'COMPLETED'|'REJECTED'|'CANCELLED'
type RequestTypeView = { id; code: 'ANNUAL_LEAVE'|'UNPAID_LEAVE'|'BUSINESS_TRIP'|'SOCIAL_LEAVE'|'CERTIFICATE'|string; name; nameKk: string|null; fields: FormField[]; usesVacationBalance: boolean; requiresAttachment: boolean; hasDates: boolean; absenceKind: AbsenceKind|null }
type RequestListItem = { id; type: Option; employee: UserRef; status: RequestStatus; startDate: DateStr|null; endDate: DateStr|null; days: number|null; createdAt; submittedAt: string|null }
type RequestDetail = RequestListItem & { data: Record<string, unknown>; applicationDocument: DocumentDetail|null; orderDocument: DocumentDetail|null; attachments: FileRef[]; timeline: { at: string; label: string; actor: UserRef|null }[] }
```

**Rules:** days = calendar days in `[startDate, endDate]` minus public holidays for leave types
(Labor Code RK); `ANNUAL_LEAVE` requires `days ≤ available balance` (`422 rule=INSUFFICIENT_VACATION_BALANCE`); overlapping requests/absences → `422 rule=OVERLAP`; start date in the past only for HR. Flow: submit → application document (kind APPLICATION) in route Manager → HR. On completion, if the type has an order doc type, an order document is generated, linked (`ORDER_FOR`), and routed (signatory sign → employee acknowledge); request status `ORDER_SIGNING`. On order completion → request `COMPLETED`, `Absence` created, `VacationLedger USAGE` written.

## 9. Vacation schedule (`/vacation-schedule`) — F-33

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/vacation-schedule/campaigns` | — | `200 CampaignView[]` | `vacation.read` |
| POST | `/vacation-schedule/campaigns` | `{ year: number; deadline?: DateStr }` | `201 CampaignView` | `vacation.manage` (HR) |
| PATCH | `/vacation-schedule/campaigns/:id` | `{ status?: 'ACTIVE'\|'CLOSED'; deadline? }` | `200 CampaignView` | `vacation.manage` |
| GET | `/vacation-schedule/campaigns/:id/grid` | `?status&employeeId&departmentId&positionId&q&page&pageSize` | `200 Page<PlanRow>` | `vacation.read` (scoped) |
| GET | `/vacation-schedule/campaigns/:id/my-plan` | — | `200 PlanRow` | employee |
| PUT | `/vacation-schedule/campaigns/:id/plans/:employeeId` | `{ periods: { startDate: DateStr; endDate: DateStr }[]; submit: boolean }` | `200 PlanRow` (self, or HR/manager for subordinates) | |
| POST | `/vacation-schedule/campaigns/:id/approve` | `{ employeeIds: string[]; decision: 'APPROVE'\|'REJECT'; comment? }` | `200 BulkResult` (only SUBMITTED plans in scope are approvable) | `vacation.approve` |
| GET | `/vacation-schedule/campaigns/:id/export` | — | xlsx (Т-7 style schedule) | `vacation.read` |

```ts
type CampaignView = { id; year: number; status: 'DRAFT'|'ACTIVE'|'CLOSED'; deadline: DateStr|null; totals: { employees: number; submitted: number; approved: number } }
type PlanRow = { employee: UserRef & { employeeId: string }; status: 'NONE'|'DRAFT'|'SUBMITTED'|'APPROVED'|'REJECTED'; entitlement: number; planned: number; periods: { id; startDate: DateStr; endDate: DateStr; days: number }[]; comment: string|null; canApprove: boolean }
```

**Rules:** each period ≥ 1 day; at least one part ≥ 14 calendar days when the total ≥ 14 (Labor Code RK art. 94); total ≤ entitlement + carry-over balance; no overlaps. Reminder job: 14 days before an approved period starts, notify the employee and their manager.

## 10. ВНД (`/vnd`) — F-34

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/vnd` | `?tab=all\|in_progress\|completed&q&legalEntityId&dateFrom&dateTo&page&pageSize` | `200 Page<VndListItem>` | `vnd.read` |
| POST | `/vnd` | multipart: `file` (pdf/docx) + fields `title`, `legalEntityId`, `documentTypeId?`, `dueAt?` | `201 VndDetail` (status DRAFT) | `vnd.manage` |
| GET | `/vnd/:id` | — | `200 VndDetail` | `vnd.read` |
| GET | `/vnd/:id/recipients` | `?status&departmentId&q&page&pageSize` | `200 Page<VndRecipientView>` | `vnd.read` |
| POST | `/vnd/:id/recipients` | `{ employeeIds?: string[]; departmentIds?: string[]; allOfLegalEntity?: boolean }` | `200 { added: number }` | `vnd.manage` |
| DELETE | `/vnd/:id/recipients/:recipientId` | — | `204` (PENDING only) | `vnd.manage` |
| POST | `/vnd/:id/send` | — | `200 VndDetail` (status IN_ROUTE = "На ознакомлении"; notifies recipients) | `vnd.manage` |
| GET | `/vnd/:id/sheet` | — | xlsx acknowledgment sheet | `vnd.read` |
| GET | `/vnd/my` | `?status=PENDING\|ACKNOWLEDGED` | `200 VndListItem[]` | employee |
| POST | `/vnd/:id/acknowledge` | `{ signingSessionId?: string }` | `200 VndDetail` | recipient (acknowledgment = ACKNOWLEDGE signature via `/signing/sessions` with this doc id, or CLICK if the type does not require ЭЦП) |

```ts
type VndListItem = { id; number: string|null; title; type: Option; sentAt: string|null; acknowledged: number; total: number; status: 'DRAFT'|'IN_ROUTE'|'COMPLETED'; commentsCount: number; legalEntity: Option; myStatus?: 'PENDING'|'ACKNOWLEDGED' }
type VndDetail = VndListItem & { fileUrl: string; dueAt: string|null; author: UserRef }
type VndRecipientView = { id; employee: UserRef; status: 'PENDING'|'ACKNOWLEDGED'; sentAt; acknowledgedAt: string|null }
```

## 11. ЕСУТД (`/esutd`) — F-24

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/esutd` | `?status&legalEntityId&q&page&pageSize` | `200 Page<EsutdItem>` | `esutd.read` (HR) |
| POST | `/esutd/submit` | `{ documentIds: string[] }` | `200 BulkResult` (queues; only COMPLETED docs with `esutdRequired`) | `esutd.submit` |
| GET | `/esutd/count` | — | `200 { notSent: number; errors: number }` (sidebar badge) | `esutd.read` |

```ts
type EsutdStatus = 'NOT_SENT'|'QUEUED'|'SENT'|'ERROR'
type EsutdItem = { documentId; number: string|null; type: Option; title; employee: UserRef; signer: UserRef|null; status: EsutdStatus; sentAt: string|null; externalId: string|null; error: string|null }
```

## 12. Sick leaves and absences (`/sick-leaves`, `/absences`) — F-36

| Method | Path | Body / Query | Response | Permission |
|--------|------|------|----------|-----------|
| GET | `/sick-leaves` | `?employeeId&from&to&page&pageSize` | `200 Page<SickLeaveView>` | `sickleave.read` (HR; scoped manager; self) |
| POST | `/sick-leaves` | `{ employeeId; number; startDate; endDate; source: 'MANUAL'\|'ELECTRONIC'; fileId?; note? }` | `201 SickLeaveView` (creates Absence SICK) | `sickleave.manage` |
| PATCH | `/sick-leaves/:id` | partial | `200 SickLeaveView` | `sickleave.manage` |
| DELETE | `/sick-leaves/:id` | — | `204` | `sickleave.manage` |
| POST | `/sick-leaves/sync` | — | `200 { imported: number }` (sandbox e-sick-leave adapter) | `sickleave.manage` |
| GET | `/absences` | `?from&to&employeeId&departmentId&kind` | `200 AbsenceView[]` | scoped |

```ts
type SickLeaveView = { id; employee: UserRef; number; startDate: DateStr; endDate: DateStr; days: number; source: 'MANUAL'|'ELECTRONIC'; file: FileRef|null; note: string|null; createdAt }
type AbsenceKind = 'VACATION'|'UNPAID'|'SICK'|'BUSINESS_TRIP'|'OTHER'
type AbsenceView = { id; employeeId; kind: AbsenceKind; startDate: DateStr; endDate: DateStr; note: string|null; source: 'REQUEST'|'SICK_LEAVE'|'MANUAL' }
```

## 13. Time tracking (`/time`) — F-37…F-43

Permissions: `time.self` (all employees), `time.manage` (MANAGER for subordinates, HR/ADMIN for all), `time.export` (HR).

| Method | Path | Body / Query | Response |
|--------|------|------|----------|
| GET | `/time/me/today` | — | `200 MyDay` |
| GET | `/time/me/week` | `?date` | `200 MyWeek` |
| POST | `/time/marks` | multipart: fields `type` (`IN\|BREAK_START\|BREAK_END\|OUT`), `lat?`, `lng?`, `accuracyM?`; file `selfie` (jpeg/png, required for IN/OUT when tenant setting `requireSelfie`) | `201 MarkResult` (`422 rule=OUTSIDE_GEOFENCE` when `requireGeofence` and distance > radius; `rule=INVALID_SEQUENCE` e.g. OUT without IN) |
| GET | `/time/marks` | `?employeeId&date&from&to&page&pageSize` | `200 Page<TimeMarkView>` (Отметки tab; scoped) |
| GET | `/time/shift-templates` | — | `200 ShiftTemplateView[]` |
| POST | `/time/shift-templates` | `{ name; startTime: 'HH:MM'; endTime; breakMinutes; color; locationId? }` | `201 ShiftTemplateView` |
| PATCH/DELETE | `/time/shift-templates/:id` | partial | `200` / `204` (soft-deactivate) |
| GET | `/time/schedule` | `?from&to&departmentId&q&scope=team\|managed` | `200 ScheduleView` (team = my department colleagues, published only; managed = my subordinates incl. drafts) |
| POST | `/time/shifts` | `{ employeeId: string\|null /*null=open*/; date: DateStr; templateId?: string; startTime?; endTime?; breakMinutes?; title? }` | `201 ShiftView` (DRAFT) |
| PATCH | `/time/shifts/:id` | partial | `200 ShiftView` |
| DELETE | `/time/shifts/:id` | — | `204` |
| POST | `/time/shifts/pattern` | `{ employeeIds: string[]; templateId; pattern: '5/2'\|'2/2'\|'custom'; cycle?: boolean[] /*custom: true=work*/; from: DateStr; to: DateStr; startOffset?: number; skipHolidays: boolean; replace: boolean }` | `201 { created: number; skipped: number }` |
| POST | `/time/shifts/copy-week` | `{ fromWeekStart: DateStr; toWeekStart: DateStr; employeeIds?: string[] }` | `201 { created: number }` |
| POST | `/time/shifts/publish` | `{ from: DateStr; to: DateStr; employeeIds?: string[] }` | `200 { published: number }` (notifies affected employees) |
| POST | `/time/shifts/:id/claim` | — | `201` (open shift; employee) |
| POST | `/time/shifts/:id/claims/:claimId/decide` | `{ decision: 'APPROVE'\|'REJECT' }` | `200 ShiftView` |
| GET | `/time/requests` | `?scope=mine\|managed&status&kind&page&pageSize` | `200 Page<TimeRequestView>` |
| POST | `/time/requests` | `TimeRequestInput { kind: 'CORRECTION'; date; in?: 'HH:MM'; out?: 'HH:MM'; reason } \| { kind: 'DAY_OFF_WORK'; date; start: 'HH:MM'; end: 'HH:MM'; reason } \| { kind: 'SUBSTITUTION'; shiftId; substituteEmployeeId; reason }` | `201 TimeRequestView` |
| POST | `/time/requests/:id/decide` | `{ decision: 'APPROVE'\|'REJECT'; comment? }` | `200 TimeRequestView` (APPROVE applies: correction marks with source CORRECTION / day-off shift created / shift reassigned) |
| GET | `/time/board` | `?date&departmentId&q&status` | `200 TodayBoard` (scoped) |
| GET | `/time/t13` | `?year&month&legalEntityId&departmentId&q` | `200 T13Sheet` (scoped) |
| POST | `/time/t13/confirm` | `{ year; month }` | `200 { confirmed: number; total: number }` (manager confirms their subordinates' month) |
| GET | `/time/t13/export` | `?year&month&legalEntityId&departmentId` | xlsx in T-13 layout (`time.export`) |

```ts
type ShiftTemplateView = { id; name; startTime: string; endTime: string; breakMinutes: number; color: ShiftColor; location: Option|null; isActive: boolean }
type ShiftColor = 'green'|'teal'|'blue'|'orange'|'purple'|'gray'|'red'
type ShiftView = { id; employeeId: string|null; date: DateStr; startAt: string; endAt: string; breakMinutes: number; title: string; color: ShiftColor; status: 'DRAFT'|'PUBLISHED'; templateId: string|null; claims: { id; employee: UserRef; status: 'PENDING'|'APPROVED'|'REJECTED' }[] }
type ScheduleView = { from: DateStr; to: DateStr; rows: { employee: UserRef & { employeeId: string }; plannedHours: number; targetHours: number; shifts: ShiftView[]; absences: AbsenceView[] }[]; openShifts: ShiftView[]; holidays: { date: DateStr; name: string; kind: string }[]; hasDrafts: boolean }
type DayStatus = 'NOT_STARTED'|'ON_SHIFT'|'ON_BREAK'|'FINISHED'|'NO_MARKS'|'NO_OUT'|'DAY_OFF'|'ABSENT'
type MyDay = { date: DateStr; shift: ShiftView|null; status: DayStatus; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; breakMinutes: number; marks: TimeMarkView[]; remainingMinutes: number|null; settings: { requireSelfie: boolean; requireGeofence: boolean; location: WorkLocation|null }; upcoming: { date: DateStr; shift: ShiftView|null; absence: AbsenceView|null; holiday: string|null }[]; requests: TimeRequestView[]; openShifts: ShiftView[] }
type MyWeek = { from: DateStr; to: DateStr; workedMinutes: number; plannedMinutes: number; days: { date: DateStr; plannedMinutes: number; workedMinutes: number; kind: 'WORK'|'OFF'|'ABSENCE'|'HOLIDAY'; absenceKind: AbsenceKind|null }[] }
type TimeMarkView = { id; employee: UserRef; type: 'IN'|'BREAK_START'|'BREAK_END'|'OUT'; at: string; distanceM: number|null; verification: 'PASSED'|'FAILED'|'SKIPPED'; verificationNote: string|null; selfieUrl: string|null; source: 'SELF'|'CORRECTION' }
type MarkResult = { mark: TimeMarkView; day: MyDay }
type TimeRequestView = { id; kind: 'CORRECTION'|'DAY_OFF_WORK'|'SUBSTITUTION'; employee: UserRef; date: DateStr; data: Record<string, unknown>; status: 'PENDING'|'APPROVED'|'REJECTED'; decidedBy: UserRef|null; decidedAt: string|null; comment: string|null; createdAt }
type BoardStatus = 'NORMAL'|'LATE'|'NO_OUT'|'NO_MARKS'|'UNDERWORK'|'OVERTIME'|'ON_SHIFT'|'NOT_STARTED'|'ABSENT'|'DAY_OFF'
type TodayBoard = {
  date: DateStr
  kpi: { onShiftNow: number; scheduledToday: number; needAttention: number; noMarks: number; overtimeMinutes: number; closedShifts: number; totalShifts: number; factMinutes: number; deltaToPlanMinutes: number }
  rows: { employee: UserRef & { employeeId: string }; shift: ShiftView|null; status: BoardStatus; inAt: string|null; outAt: string|null; segments: { from: string; to: string; kind: 'work'|'break'|'overtime' }[]; workedMinutes: number; plannedMinutes: number; deviationMinutes: number }[]
}
type T13Code = 'Я'|'В'|'К'|'Б'|'О'|'БС'|'НН'|'РВ'|'Н'|'С'|'П'   // presence, day off, business trip, sick, vacation, unpaid, absence, work on day off, night, overtime, holiday
type T13Sheet = {
  year: number; month: number; days: { day: number; weekday: number; isHoliday: boolean; isWeekend: boolean }[]
  rows: { employee: UserRef & { employeeId: string }; planHours: number; factHours: number; normHours: number; overtime15: number; overtime2: number; deviations: number; cells: { day: number; hours: number|null; codes: T13Code[]; deviation: boolean; note: string|null }[] }[]
  totals: { planHours: number; factHours: number; normHours: number; overtime15: number; overtime2: number; perDay: number[] }
  deviationsTotal: number; confirmation: { confirmed: number; total: number; mine: boolean|null }
}
```

**Computation rules:** worked = Σ(IN→OUT) − breaks; late = IN − shift start (> 5 min grace);
underwork = planned − worked > 15 min; overtime = worked − planned > 15 min; first 2 h of daily overtime = 1.5x,
beyond and holiday/weekend work = 2x (Labor Code RK art. 108–109). Norm hours = working days in
month (production calendar) × 8. Night = hours between 22:00–06:00 (code Н). A deviation is NO_MARKS,
NO_OUT, LATE, UNDERWORK or a cell where fact ≠ plan by > 15 min.

## 14. Reports and analytics (`/reports`) — F-35

| Method | Path | Query | Response | Permission |
|--------|------|-------|----------|-----------|
| GET | `/reports/dashboard` | `?legalEntityId&from&to` | `200 Dashboard` | `report.read` (HR/ADMIN all; MANAGER own department subtree) |
| GET | `/reports/headcount` | `?legalEntityId&date` | `200 { byDepartment: { department: Option; count: number }[]; byPosition: { position: Option; count: number }[]; total: number }` | `report.read` |
| GET | `/reports/movements` | `?legalEntityId&from&to` | `200 { months: { month: string; hired: number; dismissed: number; transferred: number }[] }` | `report.read` |
| GET | `/reports/:report/export` | `report=headcount\|movements\|documents\|vnd` | xlsx | `report.read` |

```ts
type Dashboard = {
  headcount: number; hiredInPeriod: number; dismissedInPeriod: number; turnoverPct: number
  candidates: Record<CandidateStatus, number>
  documents: { inRoute: number; overdue: number; completedInPeriod: number; avgCompletionHours: number|null }
  requests: { pending: number; completedInPeriod: number }
  vnd: { inProgress: number; completionPct: number }
  esutd: { notSent: number; errors: number }
  absencesToday: { vacation: number; sick: number; businessTrip: number }
}
```

## 15. Public API (`/public`) — F-50, F-13, F-43

Header `Authorization: Bearer ak_<prefix>_<secret>`. Keys are managed by ADMIN:

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api-keys` | — | `200 { id; name; prefix; scopes: string[]; lastUsedAt; revokedAt; createdAt }[]` |
| POST | `/api-keys` | `{ name; scopes: ('candidates:read'\|'candidates:write'\|'employees:read'\|'timesheet:read'\|'documents:read')[] }` | `201 { id; key: string /*shown once*/ }` |
| DELETE | `/api-keys/:id` | — | `204` (revoke) |

Public endpoints (rate limited 60 req/min per key):

| Method | Path | Scope | Response |
|--------|------|-------|----------|
| GET | `/public/candidates` | `candidates:read` | `?status=ACCEPTED&updatedFrom&tag&page&pageSize` → `Page<PublicCandidate>` (full personal data for 1С: ФИО, ИИН, DOB, gender, contacts, address, ID document, education, IBAN, photo URL) |
| POST | `/public/candidates/mark-exported` | `candidates:write` | `{ candidateIds }` → `{ updated: number }` |
| GET | `/public/employees` | `employees:read` | `Page<EmployeeListItem>` |
| GET | `/public/timesheet` | `timesheet:read` | `?year&month&legalEntityId` → `T13Sheet` |
| GET | `/public/documents` | `documents:read` | `?status=COMPLETED&updatedFrom&kind` → `Page<DocumentListItem>` |

## 16. Help (`/help`) — F-48

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/help/articles` | `?q` | `200 { slug; title; body /*markdown*/; category }[]` (localized, static content in repo) |
| POST | `/help/tickets` | `{ subject; message }` | `201 { id }` (emails support address) |

## 17. Files and health

| Method | Path | Response |
|--------|------|----------|
| GET | `/files/:id` | file stream; access checked via the owning entity (candidate doc, document version, request attachment, VND, selfie). `?download=1` forces attachment. |
| GET | `/health` | `200 { status: 'ok', db: 'ok', storage: 'ok', version }` (no auth) |

## Permission keys (summary)

| Key | ADMIN | HR | MANAGER | EMPLOYEE |
|-----|:-:|:-:|:-:|:-:|
| org.read | ✓ | ✓ | ✓ | ✓ |
| org.manage, users.manage, audit.read, apikey.manage | ✓ | | | |
| employee.read | ✓ | ✓ | ✓ (subtree) | self |
| employee.manage | ✓ | ✓ | | |
| deputy.read, deputy.manage | ✓ | ✓ | ✓ | ✓ (self) |
| candidate.read, candidate.manage | ✓ | ✓ | | |
| document.read | ✓ | ✓ | ✓ | ✓ (scoped) |
| document.create | ✓ | ✓ | ✓ | |
| document.manage | ✓ | ✓ | | |
| request.create, request.read | ✓ | ✓ | ✓ | ✓ |
| vacation.read | ✓ | ✓ | ✓ | ✓ |
| vacation.manage | ✓ | ✓ | | |
| vacation.approve | ✓ | ✓ | ✓ | |
| vnd.read | ✓ | ✓ | ✓ | ✓ (own) |
| vnd.manage | ✓ | ✓ | | |
| esutd.read, esutd.submit | ✓ | ✓ | | |
| sickleave.read | ✓ | ✓ | ✓ | self |
| sickleave.manage | ✓ | ✓ | | |
| time.self | ✓ | ✓ | ✓ | ✓ |
| time.manage | ✓ | ✓ | ✓ (subtree) | |
| time.export | ✓ | ✓ | | |
| report.read | ✓ | ✓ | ✓ (subtree) | |

## Addendum (P6 implementation notes)
- Extra `BUSINESS_RULE` rules in `/time`: `GEOLOCATION_REQUIRED`, `SELFIE_REQUIRED`, `ALREADY_SCHEDULED`, `NO_SUBORDINATES`, `DATE_IN_FUTURE`, `SHIFT_IN_PAST`.
- `ShiftView.location: Option|null`; `GET /time/shift-templates?all=true` includes inactive templates; T-13 cell code `Я` = normal presence.
- Computation details: an unmarked break on a closed day is auto-deducted (if ≥ 4 h worked remain); time before shift start is not work; all hours on a day off (no shift / public holiday / "Работа в выходной") are 2x, while scheduled weekend shifts (e.g. 2/2) are normal; GPS accuracy added to the geofence radius is capped at 150 m.
- Editing a shift resets it to DRAFT. Norm hours = working days × 8 (not reduced for absences or mid-month hire). T-13 confirmation total = managers with direct reports among the sheet rows.
