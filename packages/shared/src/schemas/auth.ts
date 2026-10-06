import { z } from 'zod';
import { LOCALES } from '../enums';
import { id, password, phone } from '../validators';

export const LoginInput = z.object({ login: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
export const OtpInput = z.object({ code: z.string().regex(/^\d{6}$/) });
export const ForgotInput = z.object({ login: z.string().trim().min(3).max(200) });
export const ResetInput = z.object({ login: z.string().trim().min(3).max(200), code: z.string().regex(/^\d{6}$/), newPassword: password });
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
export const DemoLoginInput = z.object({ userId: id });
export const MeUpdate = z.object({ locale: z.enum(LOCALES).optional(), phone: phone.optional(), twoFactorEnabled: z.boolean().optional() });
