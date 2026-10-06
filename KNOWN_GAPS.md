# KNOWN_GAPS

Everything here works in **sandbox mode** in the app and is clearly labelled as such in the UI.
To go live, each item needs the credentials or accreditation listed. Nothing is faked silently.

## Credentials / accreditation you must add

| Integration | Feature | Sandbox behaviour today | What going live needs | Env vars |
|-------------|---------|-------------------------|-----------------------|----------|
| SMS gateway | F-49 (OTP, candidate invites) | Message stored in `Outbox`, visible in Admin → Outbox | Contract with an SMS provider in KZ (e.g. Mobizon, SMSC.kz) + implement `adapters/messaging/sms-<provider>.ts` | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER` |
| WhatsApp Business | F-49 | Same as SMS | Meta WhatsApp Business API account, approved message templates | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` |
| Email (SMTP) | F-23, F-49 | Mailpit in Docker (`http://localhost:8025`), Outbox in tests | Any SMTP provider (implementation is ready) | `SMTP_URL`, `MAIL_FROM` |
| Цифровое личное дело | F-08 | Simulated SMS consent (reply 511) + deterministic realistic data + generated "Личные данные" PDF | Accreditation as a service provider with the eGov "Digital documents / personal file" service, signed agreement, API access | `PERSONAL_FILE_MODE=real`, credentials TBD by provider |
| eGov mobile / eGov mobile Business QR signing | F-18 | ECDSA P-256 per-user keys; QR opens an in-app "eGov mobile (sandbox)" confirmation page; real cryptographic signature, verifiable, **no legal force** | Integration with eGov QR signing (mgov), CMS/GOST signatures via НУЦ РК | `SIGNING_MODE=real` |
| NCALayer (desktop ЭЦП) | F-18 | PIN-confirmed sandbox signature with the same per-user key | NCALayer websocket integration in the browser (`wss://127.0.0.1:13579`) + server-side CMS verification (e.g. KalkanCrypt / ncanode) | — |
| ЕСУТД (Enbek.kz) | F-24 | Validates payload, assigns external id after a delay, ~5% simulated rejection with a reason | API access to ЕСУТД for the employer's БИН | `ESUTD_MODE=real`, `ESUTD_API_URL`, `ESUTD_TOKEN` |
| Electronic sick leaves | F-36 | "Sync" imports deterministic sample sick leaves for active employees | Access to the e-sick-leave (ЭЛН) service | `SICKLEAVE_MODE=real` |
| Face verification | F-38 | Validates that the selfie is a real image of reasonable size and stores it; passes | Biometric vendor (liveness + match against the ID photo) | `FACE_PROVIDER`, `FACE_API_KEY` |
| SSO / Active Directory | F-44 | Login button hidden | OIDC/SAML/LDAP config of the customer | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |
| 1С external processing | F-13 | REST endpoints `/public/candidates`, file export (json/xml/xlsx) and T-13 Excel export are ready | A 1С (BSL) external processing that calls these endpoints. Not part of this repo (needs a 1С developer and the customer's configuration) | — |
| S3 storage | all files | Local disk (`./data/files`) or MinIO in Docker | Production bucket | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |

## Not built (by decision)

| Item | Reason |
|------|--------|
| Native iOS/Android apps | Chat decision Q2: responsive web + PWA instead. |
| Telegram channel | AS-11: one mention in M2, no screens. |
| "Адаптация" module | AS-12: only a sidebar label in M4, no requirements. |
| Billing / licensing | AS-13: seat counts shown, no payments. |
| Roaming with external EDMS, SAP/Bitrix24 connectors | Listed as tariff-dependent integrations in M2; the public API (F-50) is the integration point. |

## Accepted risks / follow-ups

| Item | Detail |
|------|--------|
| CSP allows `'unsafe-inline'` scripts | Required by Next.js inline bootstrap without nonces. Moving to a nonce-based CSP via middleware is a follow-up (security review L2). React escapes output and markdown is rendered without raw HTML, so no known XSS sink exists. |
| Zip-bomb check trusts declared sizes | Candidate import checks the zip central directory (≤ 20 MB uncompressed, ≤ 1000 entries); the 2 MB upload cap is the backstop. |
| Face verification | Sandbox only checks that the selfie is a valid image (see table above). |
| Questionnaire "file" fields | The candidate questionnaire builder omits the file field type: answers have no upload endpoint (attach documents via the document checklist instead). |
| Compose stack in CI | Each image was verified separately. The full `docker compose up` (postgres, minio, mailpit) was not run inside the build sandbox. |
