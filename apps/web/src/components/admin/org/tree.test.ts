import { describe, expect, it } from 'vitest';
import type { Department } from '@/lib/api/types';
import { buildDepartmentTree, descendantIds, flattenTree } from './tree';

const d = (id: string, parentId: string | null, name: string): Department => ({
  id, parentId, name, legalEntityId: 'le', nameKk: null, employeeCount: 0,
});

describe('department tree', () => {
  const list = [d('b', null, 'Бухгалтерия'), d('a', null, 'Администрация'), d('a1', 'a', 'Канцелярия'), d('a1x', 'a1', 'Архив'), d('o', 'missing', 'Сирота')];

  it('nests children, sorts by name and keeps orphans as roots', () => {
    const tree = buildDepartmentTree(list);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'o']);
    expect(tree[0]!.children[0]!.id).toBe('a1');
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2);
  });
  it('flattens depth-first and honours collapsed nodes', () => {
    const tree = buildDepartmentTree(list);
    expect(flattenTree(tree).map((n) => n.id)).toEqual(['a', 'a1', 'a1x', 'b', 'o']);
    expect(flattenTree(tree, new Set(['a'])).map((n) => n.id)).toEqual(['a', 'b', 'o']);
  });
  it('collects descendants', () => {
    expect([...descendantIds(list, 'a')].sort()).toEqual(['a', 'a1', 'a1x']);
  });
});
