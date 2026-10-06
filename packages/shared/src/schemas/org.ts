import { z } from 'zod';
import { ROLES } from '../permissions';
import { bin, email, id, phone } from '../validators';

export const LegalEntityInput = z.object({
  name: z.string().trim().min(2).max(300), nameKk: z.string().trim().max(300).nullish(), bin,
  address: z.string().trim().max(500).nullish(), directorName: z.string().trim().max(200).nullish(),
});
export const DepartmentInput = z.object({ legalEntityId: id, parentId: id.nullish(), name: z.string().trim().min(1).max(200), nameKk: z.string().trim().max(200).nullish() });
export const PositionInput = z.object({ name: z.string().trim().min(1).max(200), nameKk: z.string().trim().max(200).nullish() });
export const WorkLocationInput = z.object({
  name: z.string().trim().min(1).max(200), address: z.string().trim().max(500).nullish(),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(20).max(5000),
});
export const RoleInput = z.object({ role: z.enum(ROLES), legalEntityId: id.nullable(), canSign: z.boolean() });
export const UserInput = z.object({
  email, phone: phone.nullish(), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).nullish(), roles: z.array(RoleInput).min(1).max(20), sendInvite: z.boolean().default(true),
});
export const UserUpdate = UserInput.partial().extend({ isActive: z.boolean().optional() });
