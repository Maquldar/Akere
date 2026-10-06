/** Server-side strings (emails, SMS, notifications, PDFs). UI strings live in apps/web/messages. */
export type Lang = 'ru' | 'kk' | 'en';

const dict = {
  'otp.login': { ru: 'Код входа в Akere HR: {code}. Никому не сообщайте его.', kk: 'Akere HR жүйесіне кіру коды: {code}. Ешкімге айтпаңыз.', en: 'Your Akere HR sign-in code: {code}. Do not share it.' },
  'otp.reset': { ru: 'Код для сброса пароля Akere HR: {code}', kk: 'Akere HR құпия сөзін қалпына келтіру коды: {code}', en: 'Your Akere HR password reset code: {code}' },
  'otp.subject': { ru: 'Код подтверждения', kk: 'Растау коды', en: 'Verification code' },
  'invite.subject': { ru: 'Приглашение в Akere HR', kk: 'Akere HR жүйесіне шақыру', en: 'Invitation to Akere HR' },
  'invite.user': {
    ru: 'Здравствуйте, {name}! Для вас создан аккаунт в Akere HR ({company}). Чтобы задать пароль, откройте {url} и используйте «Забыли пароль?» с вашим email.',
    kk: 'Сәлеметсіз бе, {name}! Сізге Akere HR жүйесінде ({company}) аккаунт ашылды. Құпия сөзді орнату үшін {url} ашып, email арқылы «Құпия сөзді ұмыттыңыз ба?» батырмасын басыңыз.',
    en: 'Hello {name}! An Akere HR account was created for you ({company}). To set a password, open {url} and use "Forgot password?" with your email.',
  },
} as const;

export type MsgKey = keyof typeof dict;

export function t(key: MsgKey, lang: string, params: Record<string, string | number> = {}): string {
  const l = (['ru', 'kk', 'en'].includes(lang) ? lang : 'ru') as Lang;
  return dict[key][l].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

/** Allow modules to extend the dictionary without editing this file concurrently. */
const extra: Record<string, Record<Lang, string>> = {};
export function defineMessages(messages: Record<string, Record<Lang, string>>) {
  Object.assign(extra, messages);
}
export function tx(key: string, lang: string, params: Record<string, string | number> = {}): string {
  const l = (['ru', 'kk', 'en'].includes(lang) ? lang : 'ru') as Lang;
  const entry = extra[key] ?? (dict as Record<string, Record<Lang, string>>)[key];
  if (!entry) return key;
  return entry[l].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}
