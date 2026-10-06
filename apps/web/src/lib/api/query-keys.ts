/** Central TanStack Query keys so invalidations stay consistent. */
export const qk = {
  me: ['me'] as const,
  demoUsers: ['auth', 'demo-users'] as const,
  inboxCounts: ['me', 'inbox-counts'] as const,
  notifications: (params?: object) => (params ? (['me', 'notifications', params] as const) : (['me', 'notifications'] as const)),
  legalEntities: ['org', 'legal-entities'] as const,
  departments: (legalEntityId?: string) =>
    legalEntityId ? (['org', 'departments', legalEntityId] as const) : (['org', 'departments'] as const),
  positions: ['org', 'positions'] as const,
  locations: ['org', 'locations'] as const,
  users: (params?: object) => (params ? (['org', 'users', params] as const) : (['org', 'users'] as const)),
  seats: ['org', 'seats'] as const,
  audit: (params?: object) => (params ? (['org', 'audit', params] as const) : (['org', 'audit'] as const)),
  outbox: (params?: object) => (params ? (['org', 'outbox', params] as const) : (['org', 'outbox'] as const)),
};
