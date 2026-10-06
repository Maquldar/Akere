/**
 * Message catalogs: the core file plus one file per feature module (messages/modules/<module>.<locale>.json),
 * so feature teams never edit the same JSON concurrently. Each module file uses its own top-level namespaces.
 */
import ruCore from '../../messages/ru.json';
import kkCore from '../../messages/kk.json';
import enCore from '../../messages/en.json';
import ruOnboarding from '../../messages/modules/onboarding.ru.json';
import kkOnboarding from '../../messages/modules/onboarding.kk.json';
import enOnboarding from '../../messages/modules/onboarding.en.json';
import ruDocuments from '../../messages/modules/documents.ru.json';
import kkDocuments from '../../messages/modules/documents.kk.json';
import enDocuments from '../../messages/modules/documents.en.json';
import ruRequests from '../../messages/modules/requests.ru.json';
import kkRequests from '../../messages/modules/requests.kk.json';
import enRequests from '../../messages/modules/requests.en.json';
import ruCompliance from '../../messages/modules/compliance.ru.json';
import kkCompliance from '../../messages/modules/compliance.kk.json';
import enCompliance from '../../messages/modules/compliance.en.json';
import ruTime from '../../messages/modules/time.ru.json';
import kkTime from '../../messages/modules/time.kk.json';
import enTime from '../../messages/modules/time.en.json';

export const ruMessages = { ...ruCore, ...ruOnboarding, ...ruDocuments, ...ruRequests, ...ruCompliance, ...ruTime };
export type Messages = typeof ruMessages;

export const catalogs = {
  ru: ruMessages,
  kk: { ...kkCore, ...kkOnboarding, ...kkDocuments, ...kkRequests, ...kkCompliance, ...kkTime } as Messages,
  en: { ...enCore, ...enOnboarding, ...enDocuments, ...enRequests, ...enCompliance, ...enTime } as Messages,
};

/** For tests: raw per-file catalogs to compare locales file by file. */
export const moduleFiles = {
  core: { ru: ruCore, kk: kkCore, en: enCore },
  onboarding: { ru: ruOnboarding, kk: kkOnboarding, en: enOnboarding },
  documents: { ru: ruDocuments, kk: kkDocuments, en: enDocuments },
  requests: { ru: ruRequests, kk: kkRequests, en: enRequests },
  compliance: { ru: ruCompliance, kk: kkCompliance, en: enCompliance },
  time: { ru: ruTime, kk: kkTime, en: enTime },
} as const;
