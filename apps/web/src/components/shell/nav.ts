import {
  Archive, BarChart3, BookOpen, Building2, CalendarDays, CalendarRange, ClipboardList, Clock, FileCheck2,
  FilePlus2, FileStack, FileText, FolderKanban, House, Inbox, KeyRound, Landmark, LayoutGrid, LifeBuoy,
  ListChecks, type LucideIcon, Mail, NotebookTabs, PencilLine, Route, ScrollText, Send, Stethoscope,
  Table2, UserCheck, UserCircle, UserRoundPlus, Users, UsersRound,
} from 'lucide-react';
import { can, hasRole, type AccessContext } from '@/lib/permissions';

/**
 * Sidebar navigation (M4 structure). One file so later phases add pages and flip `ready`.
 *
 * Only items with `ready: true` (their page exists) AND `visible(ctx)` are rendered.
 */

export type BadgeSource = 'inbox.documents' | 'inbox.requests' | 'inbox.vnd' | 'inbox.timeRequests' | 'esutd';

export type NavItemKey =
  | 'home' | 'inbox'
  | 'allDocuments' | 'outgoing' | 'drafts' | 'vnd' | 'esutd' | 'archive'
  | 'myRequests' | 'teamRequests'
  | 'candidates' | 'requestTemplates' | 'questionnaires'
  | 'myAbsences' | 'vacationSchedule' | 'sickLeaves'
  | 'employees' | 'deputies'
  | 'myTime' | 'planning' | 'timesheet'
  | 'reports'
  | 'orgStructure' | 'users' | 'dictionaries' | 'documentTemplates' | 'routes' | 'audit' | 'outbox' | 'apiKeys'
  | 'help' | 'support' | 'profile'
  | 'notifications' | 'newDocument';

export type NavSectionKey =
  | 'documents' | 'requests' | 'candidates' | 'absences' | 'people' | 'time' | 'analytics' | 'admin';

export type NavItem = {
  key: NavItemKey;
  href: string;
  icon: LucideIcon;
  /** Phase that builds the page (ARCHITECTURE.md §6). */
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Page exists → item is rendered. Flip to true when the phase lands. */
  ready: boolean;
  visible: (ctx: AccessContext) => boolean;
  badge?: BadgeSource;
  /** Only match the exact path (not sub-paths). */
  exact?: boolean;
};

export type NavSection = { key: NavSectionKey | null; items: NavItem[] };

const always = () => true;
const staffWithTeam = (ctx: AccessContext) => hasRole(ctx, 'ADMIN', 'HR') || ctx.isManager;

/** "+ Новый документ" button at the top of the sidebar. */
export const newDocumentAction: NavItem = {
  key: 'newDocument',
  href: '/documents/new',
  icon: FilePlus2,
  phase: 3,
  ready: true,
  visible: (ctx) => can(ctx, 'document.create'),
};

export const navSections: NavSection[] = [
  {
    key: null,
    items: [
      { key: 'home', href: '/', icon: House, phase: 1, ready: true, visible: always, exact: true },
      { key: 'inbox', href: '/inbox', icon: Inbox, phase: 3, ready: true, visible: (c) => can(c, 'document.read'), badge: 'inbox.documents' },
    ],
  },
  {
    key: 'documents',
    items: [
      { key: 'allDocuments', href: '/documents', icon: FileText, phase: 3, ready: true, visible: (c) => can(c, 'document.read'), exact: true },
      { key: 'outgoing', href: '/documents/outgoing', icon: Send, phase: 3, ready: true, visible: (c) => can(c, 'document.read') },
      { key: 'drafts', href: '/documents/drafts', icon: PencilLine, phase: 3, ready: true, visible: (c) => can(c, 'document.create') },
      { key: 'vnd', href: '/vnd', icon: ScrollText, phase: 5, ready: true, visible: (c) => can(c, 'vnd.read'), badge: 'inbox.vnd' },
      { key: 'esutd', href: '/esutd', icon: Landmark, phase: 5, ready: true, visible: (c) => can(c, 'esutd.read'), badge: 'esutd' },
      { key: 'archive', href: '/archive', icon: Archive, phase: 5, ready: true, visible: (c) => can(c, 'document.manage') },
    ],
  },
  {
    key: 'requests',
    items: [
      { key: 'myRequests', href: '/requests', icon: ClipboardList, phase: 4, ready: true, visible: (c) => can(c, 'request.create'), exact: true },
      { key: 'teamRequests', href: '/requests/team', icon: ListChecks, phase: 4, ready: true, visible: (c) => can(c, 'request.read') && staffWithTeam(c), badge: 'inbox.requests' },
    ],
  },
  {
    key: 'candidates',
    items: [
      { key: 'candidates', href: '/candidates', icon: UserRoundPlus, phase: 2, ready: true, visible: (c) => can(c, 'candidate.read') },
      { key: 'requestTemplates', href: '/onboarding/request-templates', icon: FileStack, phase: 2, ready: true, visible: (c) => can(c, 'candidate.manage') },
      { key: 'questionnaires', href: '/onboarding/questionnaires', icon: NotebookTabs, phase: 2, ready: true, visible: (c) => can(c, 'candidate.manage') },
    ],
  },
  {
    key: 'absences',
    items: [
      { key: 'myAbsences', href: '/absences', icon: CalendarDays, phase: 4, ready: true, visible: (c) => can(c, 'request.create'), exact: true },
      { key: 'vacationSchedule', href: '/vacation-schedule', icon: CalendarRange, phase: 4, ready: true, visible: (c) => can(c, 'vacation.read') },
      { key: 'sickLeaves', href: '/absences/sick-leaves', icon: Stethoscope, phase: 5, ready: true, visible: (c) => can(c, 'sickleave.read') && staffWithTeam(c) },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'employees', href: '/employees', icon: Users, phase: 3, ready: true, visible: (c) => can(c, 'employee.manage') || (can(c, 'employee.read') && c.isManager) },
      { key: 'deputies', href: '/deputies', icon: UserCheck, phase: 3, ready: true, visible: (c) => can(c, 'deputy.read') },
    ],
  },
  {
    key: 'time',
    items: [
      { key: 'myTime', href: '/time', icon: Clock, phase: 6, ready: true, visible: (c) => can(c, 'time.self'), exact: true },
      { key: 'planning', href: '/time/planning', icon: LayoutGrid, phase: 6, ready: true, visible: (c) => can(c, 'time.manage') },
      { key: 'timesheet', href: '/time/timesheet', icon: Table2, phase: 6, ready: true, visible: (c) => can(c, 'time.manage'), badge: 'inbox.timeRequests' },
    ],
  },
  {
    key: 'analytics',
    items: [{ key: 'reports', href: '/reports', icon: BarChart3, phase: 5, ready: true, visible: (c) => can(c, 'report.read') }],
  },
  {
    key: 'admin',
    items: [
      { key: 'orgStructure', href: '/admin/org', icon: Building2, phase: 1, ready: true, visible: (c) => can(c, 'org.manage') },
      { key: 'users', href: '/admin/users', icon: UsersRound, phase: 1, ready: true, visible: (c) => can(c, 'users.manage') },
      { key: 'dictionaries', href: '/admin/document-types', icon: FolderKanban, phase: 3, ready: true, visible: (c) => can(c, 'document.manage') },
      { key: 'documentTemplates', href: '/admin/document-templates', icon: FileCheck2, phase: 3, ready: true, visible: (c) => can(c, 'document.manage') },
      { key: 'routes', href: '/admin/routes', icon: Route, phase: 3, ready: true, visible: (c) => can(c, 'document.manage') },
      { key: 'audit', href: '/admin/audit', icon: ScrollText, phase: 1, ready: true, visible: (c) => can(c, 'audit.read') },
      { key: 'outbox', href: '/admin/outbox', icon: Mail, phase: 1, ready: true, visible: (c) => hasRole(c, 'ADMIN') },
      { key: 'apiKeys', href: '/admin/api-keys', icon: KeyRound, phase: 5, ready: true, visible: (c) => can(c, 'apikey.manage') },
    ],
  },
];

/** Bottom block (above the language switcher and the user menu). */
export const bottomItems: NavItem[] = [
  { key: 'help', href: '/help', icon: BookOpen, phase: 5, ready: true, visible: always },
  { key: 'support', href: '/support', icon: LifeBuoy, phase: 5, ready: true, visible: always },
  { key: 'profile', href: '/profile', icon: UserCircle, phase: 1, ready: true, visible: always },
];

/** Pages reachable outside the sidebar (header title/breadcrumbs only). */
export const extraRoutes: NavItem[] = [
  { key: 'notifications', href: '/notifications', icon: Inbox, phase: 1, ready: true, visible: always },
];

export function isItemShown(item: NavItem, ctx: AccessContext): boolean {
  return item.ready && item.visible(ctx);
}

export function visibleSections(ctx: AccessContext): NavSection[] {
  return navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => isItemShown(i, ctx)) }))
    .filter((s) => s.items.length > 0);
}

export function isActive(item: Pick<NavItem, 'href' | 'exact'>, pathname: string): boolean {
  if (item.exact || item.href === '/') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Finds the nav entry (and its section) that best matches a path, for the header. */
export function resolveRoute(pathname: string): { item: NavItem; section: NavSectionKey | null } | null {
  let best: { item: NavItem; section: NavSectionKey | null } | null = null;
  const consider = (item: NavItem, section: NavSectionKey | null) => {
    const match = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
    if (match && (!best || item.href.length > best.item.href.length)) best = { item, section };
  };
  for (const s of navSections) for (const i of s.items) consider(i, s.key);
  for (const i of [...bottomItems, ...extraRoutes]) consider(i, null);
  return best;
}

export function hasBadge(sections: NavSection[], prefix: 'inbox' | 'esutd'): boolean {
  return sections.some((s) => s.items.some((i) => i.badge?.startsWith(prefix)));
}
