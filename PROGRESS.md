# PROGRESS

Resume guide for a fresh session: read SPEC.md (features), ARCHITECTURE.md (stack, phases), API.md
(contract + addenda at the end), KNOWN_GAPS.md (sandbox integrations), then this file.

## Status: all phases complete (2026-10-07)

| Phase | State | Evidence |
|-------|-------|----------|
| Step 0–2 Ingest, architecture, contract | ✅ | MEDIA_NOTES.md, SPEC.md, ARCHITECTURE.md, API.md |
| P1 Foundation | ✅ | test/auth, org, scope; e2e/smoke.spec.ts |
| P2 Candidate onboarding | ✅ | test/onboarding, portal; e2e/onboarding.spec.ts |
| P3 Documents & e-signing | ✅ | test/documents*, signing, employees; e2e/documents.spec.ts |
| P4 Requests & vacations | ✅ | test/requests, vacation-schedule; e2e/requests.spec.ts |
| P5 ВНД, ЕСУТД, archive, reports, API | ✅ | test/vnd, esutd, archive, reports, public, help; e2e/compliance.spec.ts |
| P6 Time tracking | ✅ | test/time*, absences, calendar; e2e/time.spec.ts |
| P7 Polish & release | ✅ | security review + fixes, PWA, Docker images, README, screenshots |

## Final verification run (2026-10-07, fresh seed, production web build)

```
packages/shared  vitest   Tests  5 passed (5)
apps/api         tsc --noEmit OK
apps/api         vitest   Test Files 25 passed (25) · Tests 137 passed (137)   # real Postgres
apps/web         tsc OK · eslint OK
apps/web         vitest   Test Files 11 passed (11) · Tests 52 passed (52)
apps/web         playwright (next start + API, workers=1)   17 passed           # run twice in a row by QA as well
apps/web         next build   ✓ 139 pages
Docker           akere-api image: build → migrate → start (jobs) → seed ✓
                 akere-web image: build → serves /ru/login 200, proxies /api ✓
```

Not verified in this sandbox: `docker compose up` of the whole stack (postgres/minio/mailpit images). Each app image was verified individually against a native Postgres. The sandbox's TLS proxy requires a CA injection for in-container npm installs, so the builds used a throwaway Dockerfile variant; the committed Dockerfiles need no changes on a normal machine.

## Feature verification

✅ = works end to end (UI → API → DB → UI), covered by the listed automated tests. "API" = vitest integration test against Postgres, "E2E" = Playwright through the real UI.

| ID | Feature | Verified by |
|----|---------|-------------|
| F-01 | Candidate registry | ✅ API onboarding.test · E2E onboarding |
| F-02 | Candidate card create/edit | ✅ API onboarding.test · E2E onboarding |
| F-03 | Bulk XLSX import | ✅ API onboarding.test (dry run, row errors, zip limits in security-fixes) · UI dialog |
| F-04 | Request templates | ✅ API onboarding.test · E2E onboarding (creates template) |
| F-05 | Questionnaire templates | ✅ API onboarding.test · UI builder (file-type field omitted, see KNOWN_GAPS) |
| F-06 | Send document request | ✅ API onboarding.test · E2E onboarding |
| F-07 | Candidate portal (OTP) | ✅ API portal.test · E2E onboarding (360px) |
| F-08 | Digital personal file autofill (sandbox) | ✅ API portal.test (511/512, NO_IIN) · E2E onboarding |
| F-09 | HR review | ✅ API onboarding.test · E2E onboarding (accept) |
| F-10 | Candidate status pipeline | ✅ API onboarding.test (state rules) |
| F-11 | Candidate comments | ✅ API onboarding.test · UI tab |
| F-12 | Hire conversion + hire documents | ✅ API onboarding.test + documents (employee.hired) · E2E onboarding |
| F-13 | 1С export (file + API) | ✅ API onboarding.test, public.test |
| F-14 | Document templates → PDF | ✅ API documents-config.test · E2E documents (admin) |
| F-15 | Document registry & search | ✅ API documents.test · E2E documents |
| F-16 | Document card (tabs, versions, links, comments) | ✅ API documents.test · E2E documents |
| F-17 | Configurable routes | ✅ API documents.test (sequential/parallel/return/reject) · UI route editor |
| F-18 | E-signature (eGov QR, NCALayer; sandbox) | ✅ API signing.test (verify, tamper) · E2E documents (both flows) |
| F-19 | Deputies | ✅ API documents.test + security-fixes (ACKNOWLEDGE exception) · UI page |
| F-20 | Mass create/approve/sign | ✅ API documents.test, security-fixes (cap 50) · UI bulk bar |
| F-21 | Numbering, manual, backdated, paper | ✅ API documents.test + security-fixes (unique) |
| F-22 | Deadlines & reminders | ✅ API documents.test (reminder job) |
| F-23 | Notifications (in-app + email) | ✅ API org.test + module tests · E2E smoke (bell) |
| F-24 | ЕСУТД registry (sandbox) | ✅ API esutd.test · E2E compliance |
| F-25 | Electronic archive | ✅ API archive.test · E2E compliance |
| F-26 | Employee requests | ✅ API requests.test · E2E requests |
| F-27 | Manager → HR → order → signing flow | ✅ API requests.test · E2E requests |
| F-28 | Vacation balance ledger | ✅ API requests.test, employees.test |
| F-29 | Employee e-dossier | ✅ API employees.test · E2E documents (employee page) |
| F-30 | HR events: hire/transfer/dismissal | ✅ API employees.test, security-fixes · E2E documents (transfer) |
| F-31 | Reference data | ✅ API org.test · E2E smoke (admin org) |
| F-32 | Users & roles | ✅ API org.test · E2E smoke |
| F-33 | Vacation schedule campaigns | ✅ API vacation-schedule.test · E2E requests (bulk approve) |
| F-34 | ВНД acknowledgments | ✅ API vnd.test + security-fixes · E2E compliance (ЭЦП acknowledgment) |
| F-35 | Analytics & reports | ✅ API reports.test · E2E compliance |
| F-36 | Sick leaves & absences | ✅ API absences.test · UI registry (create/sync); feeds T-13 (time tests) |
| F-37 | My time dashboard | ✅ API time tests · E2E time |
| F-38 | Selfie + geofence clock-in | ✅ API time tests (geofence, selfie) · E2E time (fake camera + geolocation) |
| F-39 | Time requests | ✅ API time tests (apply effects) · UI |
| F-40 | Team schedule | ✅ API time tests (publish visibility) · E2E time |
| F-41 | Shift planning | ✅ API time tests (5/2, 2/2, holidays) · E2E time |
| F-42 | Today board | ✅ API time tests (KPIs) · UI + screenshot |
| F-43 | T-13 + Excel export | ✅ API time tests · E2E time (xlsx download) |
| F-44 | Auth (password, OTP 2FA, reset) | ✅ API auth.test + security-fixes · E2E smoke |
| F-45 | Multi-tenancy | ✅ API org.test, onboarding.test (isolation) + review audit |
| F-46 | Localization RU/KZ/EN | ✅ web messages.test (key/placeholder parity) · E2E smoke (kk) |
| F-47 | Responsive / PWA | ✅ E2E 360px checks in 5 specs · manifest + icons |
| F-48 | Help & support | ✅ API help.test · E2E compliance |
| F-49 | Messaging adapters (sandbox SMS/WhatsApp, SMTP) | ✅ API onboarding/auth tests (outbox) · E2E onboarding reads OTP from outbox |
| F-50 | Public API + keys | ✅ API public.test · E2E compliance (key lifecycle) |
| A-01…A-05 | Reset, audit, lockout, demo switcher, health | ✅ API auth/org tests · E2E smoke |

## Security review (P7)

Review round 1 found 3 High, 7 Medium and 4 Low/perf issues, 9 of them confirmed live. All are fixed with 18 regression tests (`test/security-fixes.test.ts`), except the accepted risk L2 (CSP `unsafe-inline`, see KNOWN_GAPS). The final E2E run surfaced two more product bugs, both fixed: a rate limiter keyed by the proxy IP (now keyed per session subject) and a 360px overflow on the ВНД list.

## Known issues / follow-ups
- The KNOWN_GAPS.md integrations need real credentials (eGov/NCALayer, ЕСУТД, SMS, WhatsApp, Цифровое личное дело, face match, SSO, 1С processing).
- Native date inputs display in the browser's locale format.
- Headless Chromium shows framed PDFs blank (real browsers render them; ВНД/requests use pdf.js canvases).
- E2E specs mutate the shared dev DB. Re-run `pnpm db:seed` to restore the demo state.

## How to run
See README.md (Docker quick start and local development).
