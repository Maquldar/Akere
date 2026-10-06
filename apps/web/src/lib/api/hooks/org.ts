'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { qk } from '../query-keys';
import type {
  AuditEntry, AuditFilter, Department, DepartmentInput, LegalEntity, LegalEntityInput,
  OutboxFilter, OutboxMessage, Page, Position, PositionInput, Seats, UserAdmin, UserFilter,
  UserInput, UserUpdate, WorkLocation, WorkLocationInput,
} from '../types';

// Legal entities ---------------------------------------------------------------

export function useLegalEntities(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.legalEntities,
    queryFn: ({ signal }) => apiFetch<LegalEntity[]>('/org/legal-entities', { signal }),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useSaveLegalEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<LegalEntityInput> }) =>
      id
        ? apiFetch<LegalEntity>(`/org/legal-entities/${id}`, { method: 'PATCH', body: input })
        : apiFetch<LegalEntity>('/org/legal-entities', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.legalEntities }),
  });
}

// Departments -----------------------------------------------------------------

export function useDepartments(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: qk.departments(legalEntityId),
    queryFn: ({ signal }) => apiFetch<Department[]>('/org/departments', { query: { legalEntityId }, signal }),
    enabled: Boolean(legalEntityId),
    staleTime: 30_000,
  });
}

export function useSaveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<DepartmentInput> }) =>
      id
        ? apiFetch<Department>(`/org/departments/${id}`, { method: 'PATCH', body: input })
        : apiFetch<Department>('/org/departments', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments() }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/org/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.departments() }),
  });
}

// Positions ---------------------------------------------------------------------

export function usePositions() {
  return useQuery({
    queryKey: qk.positions,
    queryFn: ({ signal }) => apiFetch<Position[]>('/org/positions', { signal }),
    staleTime: 60_000,
  });
}

export function useSavePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<PositionInput> }) =>
      id
        ? apiFetch<Position>(`/org/positions/${id}`, { method: 'PATCH', body: input })
        : apiFetch<Position>('/org/positions', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

// Work locations ----------------------------------------------------------------

export function useLocations() {
  return useQuery({
    queryKey: qk.locations,
    queryFn: ({ signal }) => apiFetch<WorkLocation[]>('/org/locations', { signal }),
    staleTime: 60_000,
  });
}

export function useSaveLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<WorkLocationInput> }) =>
      id
        ? apiFetch<WorkLocation>(`/org/locations/${id}`, { method: 'PATCH', body: input })
        : apiFetch<WorkLocation>('/org/locations', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.locations }),
  });
}

// Users -------------------------------------------------------------------------

export function useUsers(filter: UserFilter) {
  return useQuery({
    queryKey: qk.users(filter),
    queryFn: ({ signal }) => apiFetch<Page<UserAdmin>>('/org/users', { query: filter, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Fetcher for async user pickers (Combobox `loadOptions`). */
export async function searchUsers(q: string, signal?: AbortSignal) {
  const page = await apiFetch<Page<UserAdmin>>('/org/users', { query: { q, page: 1, pageSize: 20 }, signal });
  return page.items.map((u) => ({ value: u.id, label: u.fullName, description: u.email }));
}

export function useSaveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: UserInput | UserUpdate }) =>
      id
        ? apiFetch<UserAdmin>(`/org/users/${id}`, { method: 'PATCH', body: input })
        : apiFetch<UserAdmin>('/org/users', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.users() });
      void qc.invalidateQueries({ queryKey: qk.seats });
    },
  });
}

export function useSeats(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.seats,
    queryFn: ({ signal }) => apiFetch<Seats>('/org/seats', { signal }),
    enabled: options.enabled ?? true,
  });
}

// Audit & outbox ----------------------------------------------------------------

export function useAudit(filter: AuditFilter) {
  return useQuery({
    queryKey: qk.audit(filter),
    queryFn: ({ signal }) => apiFetch<Page<AuditEntry>>('/org/audit', { query: filter, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useOutbox(filter: OutboxFilter) {
  return useQuery({
    queryKey: qk.outbox(filter),
    queryFn: ({ signal }) => apiFetch<Page<OutboxMessage>>('/org/outbox', { query: filter, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
}
