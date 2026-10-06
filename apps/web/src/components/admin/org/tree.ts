import type { Department } from '@/lib/api/types';

export type DeptNode = Department & { children: DeptNode[]; depth: number };

/** Builds a sorted tree from the flat `GET /org/departments` list. Orphans become roots. */
export function buildDepartmentTree(list: Department[], locale = 'ru'): DeptNode[] {
  const byId = new Map<string, DeptNode>();
  for (const d of list) byId.set(d.id, { ...d, children: [], depth: 0 });
  const roots: DeptNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const collator = new Intl.Collator(locale);
  const seen = new Set<string>();
  const walk = (nodes: DeptNode[], depth: number) => {
    nodes.sort((a, b) => collator.compare(a.name, b.name));
    for (const n of nodes) {
      if (seen.has(n.id)) continue; // guards against cycles in bad data
      seen.add(n.id);
      n.depth = depth;
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return roots;
}

/** Ids of a node and all its descendants (cannot be chosen as its new parent). */
export function descendantIds(list: Department[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of list) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Depth-first flattening for rendering / parent pickers. */
export function flattenTree(nodes: DeptNode[], collapsed?: ReadonlySet<string>): DeptNode[] {
  const out: DeptNode[] = [];
  const walk = (ns: DeptNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (!collapsed?.has(n.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
