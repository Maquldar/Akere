import type { HelpArticle } from '@akere/shared';

/** Knowledge base (EN). Markdown; slugs are shared across languages. */
export const articles: HelpArticle[] = [
  {
    slug: 'getting-started',
    category: 'start',
    title: 'Getting started with Akere HR',
    body: `## What is Akere HR

Akere HR is an electronic HR document management system (KEDO) for companies in Kazakhstan: documents, e-signatures, onboarding, time tracking and reporting in one place.

## Roles

| Role | What you can do |
|------|-----------------|
| **Administrator** | Company settings, legal entities, users, API keys, audit log |
| **HR** | Employees, candidates, documents, internal regulations, ESUTD, reports for assigned legal entities |
| **Manager** | Approvals, timesheets and shifts of direct and indirect reports, department analytics |
| **Employee** | Own documents, applications, acknowledging regulations, clock-in and clock-out |

One user can hold several roles — the role switcher is under your name.

## Signing in

1. Open the sign-in page and enter your email or phone and password.
2. If two-factor authentication is on, enter the code from SMS or email.
3. Forgot your password? Click "Forgot password?" and follow the emailed instructions.

## Navigation

The left menu lists the modules. Numbers next to items show what is waiting for you: documents to sign, regulations to acknowledge, requests to approve. The bell at the top shows notifications.`,
  },
  {
    slug: 'documents-and-routes',
    category: 'documents',
    title: 'Documents and approval routes',
    body: `## Creating a document

1. Open **Documents → Create**.
2. Choose the document type (order, employment contract, application, etc.), legal entity and employee.
3. Fill in the fields — the PDF is generated from the template automatically.
4. Click **Start route** or save a draft.

## How routes work

- The route comes from the document type: approval, signing, acknowledgment.
- Steps with the same order run in parallel; the next stage starts when every step of the current one is done.
- **Return for rework** sends the document back to the author; after corrections the route starts over.
- **Reject** ends the route.
- The number is assigned on start using the type's numbering pattern (e.g. \`12-к/26\`). HR can register a document manually or backdate it.

## Deadlines and reminders

Each step has a due date. The system reminds assignees a day before and when a step is overdue. Overdue documents are highlighted in the registry.

## Paper signing

If a document was signed on paper, HR uploads the scan via **Signed on paper** — the route completes and the scan becomes the original.`,
  },
  {
    slug: 'signing-ecp',
    category: 'documents',
    title: 'E-signatures: eGov mobile and NCALayer',
    body: `## Signing methods

- **eGov mobile** — scan the QR code in the eGov mobile app and confirm.
- **eGov mobile Business** — for legal entity signatories (director or authorised person).
- **NCA RK e-signature (NCALayer)** — sign with a key on your computer using a PIN.

## How to sign

1. Open the document and click **Sign** (or select several documents in the inbox and click **Sign selected**).
2. Choose the signing method.
3. eGov: open eGov mobile → "eGov QR" → scan the code. NCALayer: enter your PIN.
4. Once confirmed, the document moves to the next route step.

A QR code is valid for 5 minutes. If it expires, start signing again.

## Deputies

During a vacation or business trip, assign a deputy in **Deputies**. The deputy sees your tasks and signs on your behalf — the signature sheet shows it.

## Verifying signatures

Click **Verify signatures** on the document page — the system checks the PDF hash and every participant's signature. The signed PDF includes a signature sheet.`,
  },
  {
    slug: 'candidate-onboarding',
    category: 'onboarding',
    title: 'Candidate onboarding and 1C export',
    body: `## Inviting a candidate

1. **Candidates → Add** (or import from Excel).
2. Enter the full name, contacts and channels: email, SMS or WhatsApp.
3. Click **Request documents** and choose a document set template.

The candidate receives a portal link, signs in with a one-time code and uploads documents: ID card, diploma, certificates, bank details. Some data is filled in automatically.

## Review

HR reviews each document: **Accept** or **Return** with a comment. When all documents are accepted the candidate becomes "Accepted".

## Hiring

**Hire** creates the employee record and can immediately generate the employment contract and hire order with their routes started.

## Export to 1C

- **Export** — XML, JSON or Excel file with full personal data.
- **Integration** — 1C pulls accepted candidates through the public API (see "Public API and integrations") and marks them as exported.`,
  },
  {
    slug: 'employees-and-events',
    category: 'employees',
    title: 'Employees, HR events and sick leaves',
    body: `## Employee record

**Employees** holds the company structure: legal entities, departments, positions, managers. The record contains personal data, documents, vacation balance and event history.

## HR events

- **Transfer** — issued as a transfer order; once signed, department, position and manager change automatically.
- **Dismissal** — a dismissal order; once signed the employee becomes "Dismissed" with the termination date.
- **Vacation, business trip, unpaid leave** — the employee applies, the manager and HR approve, then the order is signed.

## Vacation balance

Accrued in proportion to months worked (24 calendar days a year by default). Used days are deducted once the order is signed.

## Sick leaves

HR registers a sick leave manually (with a scan) or receives an electronic sick leave. Sick days appear in the timesheet with code "Б".`,
  },
  {
    slug: 'time-tracking',
    category: 'time',
    title: 'Time tracking and the T-13 timesheet',
    body: `## Shifts and schedules

Managers plan shifts in **Schedule**: from templates (5/2, 2/2 or custom), by copying a week or manually. Published shifts are visible to employees.

## Clocking in

Employees record **arrival**, **break** and **departure** in the mobile app. The company can require a selfie and presence in the office geofence. A missed mark is fixed with a correction request approved by the manager.

## Live board

The board shows who is at work, who is late and who is absent (vacation, sick leave, business trip).

## T-13 timesheet

1. Open **Timesheet**, choose the month and department.
2. Review deviations (late arrivals, absences, overtime).
3. Managers confirm the timesheet of their teams.
4. HR exports the T-13 form to Excel, or 1C pulls it through the API.

Work on weekends and public holidays is paid double and shown separately.`,
  },
  {
    slug: 'vnd-acknowledgment',
    category: 'vnd',
    title: 'Internal regulations: acknowledgment',
    body: `## What are internal regulations

Internal regulatory documents (VND) — internal labour rules, occupational safety instructions, pay regulations and so on. Under the Labour Code of Kazakhstan employees must acknowledge them with a signature.

## Sending a regulation (HR)

1. **Regulations → New**: upload the file (PDF or DOCX), enter the title, legal entity and deadline.
2. **Add recipient**: choose employees, departments (including sub-departments) or the whole legal entity. The same employee is never added twice.
3. Click **Send** — recipients are notified and the status becomes "In acknowledgment".

The "12/24" counter shows how many recipients have acknowledged. When everyone has, the status becomes "Completed".

## Acknowledging (employee)

1. Open the regulation from the notification or **Regulations → Mine**.
2. Read the document and click **Confirm acknowledgment**.
3. Sign with eGov mobile (QR code) or an NCA RK e-signature.

## Acknowledgment sheet

On the "Acknowledgment" tab click **Acknowledgment sheet** — an Excel file with recipient, department, position, status and acknowledgment date.`,
  },
  {
    slug: 'esutd',
    category: 'esutd',
    title: 'ESUTD: registering employment contracts',
    body: `## Why it matters

Employers must submit employment contracts and supplementary agreements to the Unified Employment Contract Registry (ESUTD).

## ESUTD registry

**ESUTD** automatically lists signed documents of types marked "ESUTD required": employment contracts, supplementary agreements, unpaid leave orders. The number next to the menu item counts documents not yet sent or returned with an error.

Statuses:
- **Not sent** — signed but not yet submitted;
- **Queued** — submission scheduled;
- **Sent** — with the date and time and the ESUTD number;
- **Error** — with the reason (e.g. invalid IIN).

## Sending

1. Select documents in the registry.
2. Click **Send to ESUTD**.
3. The system checks the required fields (employee IIN, contract number and date) and queues the documents. Sending happens within a minute.

A document with an error can be corrected and sent again.`,
  },
  {
    slug: 'reports-and-archive',
    category: 'reports',
    title: 'Analytics, reports and the electronic archive',
    body: `## Analytics

**Analytics** shows key figures for the selected period:
- headcount, hires and dismissals, turnover;
- documents in progress, overdue, average approval time;
- requests, regulation acknowledgment, ESUTD status;
- who is on vacation, sick leave or a business trip today.

HR sees their legal entities, managers see their department.

## Reports

- **Headcount** — by department and position on any date.
- **Staff movements** — hires, dismissals and transfers per month.
- **Documents** and **Regulations** — registries for the period.

Every report can be exported to Excel with **Export**.

## Electronic archive

Paper documents from previous years can be moved into the system: **Documents → Archive → Upload**. Select the scans and give each one a type, legal entity, title, number and registration date. They are stored as paper-signed and searchable together with electronic documents.`,
  },
  {
    slug: 'public-api',
    category: 'integrations',
    title: 'Public API and 1C integration',
    body: `## API keys

An administrator creates a key in **Settings → API keys**: a name (e.g. "1C:ZUP integration") and scopes. The key is shown **only once** — store it safely. A revoked key stops working immediately.

Scopes:
- \`candidates:read\` / \`candidates:write\` — accepted candidates and the exported mark;
- \`employees:read\` — employee list;
- \`timesheet:read\` — T-13 timesheet;
- \`documents:read\` — document registry.

## Requests

Send the key in the header:

\`\`\`
Authorization: Bearer ak_xxxxxxxxxxxx_...
\`\`\`

Main endpoints:
- \`GET /api/v1/public/candidates?status=ACCEPTED&updatedFrom=2026-10-01\`
- \`POST /api/v1/public/candidates/mark-exported\` with body \`{ "candidateIds": [...] }\`
- \`GET /api/v1/public/employees\`
- \`GET /api/v1/public/timesheet?year=2026&month=9\`
- \`GET /api/v1/public/documents?status=COMPLETED&updatedFrom=2026-10-01\`

The limit is 60 requests per minute per key. Above it the API returns 429 with a Retry-After header.`,
  },
  {
    slug: 'security-and-privacy',
    category: 'security',
    title: 'Security and personal data',
    body: `## Protecting your account

- Use a password of at least 10 characters with letters and digits.
- Turn on **two-factor authentication** in your profile — a code is sent at every sign-in.
- After several failed sign-in attempts the account is locked temporarily.
- Sessions end automatically after a period of inactivity.

## Personal data

Akere HR processes personal data under the Law of the Republic of Kazakhstan "On personal data and their protection":
- candidates give consent on the portal;
- access is limited by role and legal entity;
- every action on documents and data is written to the audit log;
- uploaded files are checked by content, not by extension.

## Electronic signatures

A signature covers the hash of the PDF. Any change to the file after signing invalidates the signature — signature verification shows it.

## If something goes wrong

Contact **Support** using the form on this page — describe the problem and the steps that led to it.`,
  },
];
