"""Meowdoku solver.

Rules (same as LinkedIn "Queens"):
  - N x N grid split into N color regions
  - exactly 1 cat per row, per column, per color region
  - cats cannot touch, not even diagonally
"""


def solve(regions):
    """regions: N x N list of region ids. Returns list of (row, col) or None."""
    n = len(regions)
    used_cols, used_regions = set(), set()
    placed = []

    def ok(r, c):
        if c in used_cols or regions[r][c] in used_regions:
            return False
        # only the previous row can touch (one cat per row)
        return not (placed and abs(placed[-1][1] - c) <= 1)

    def bt(r):
        if r == n:
            return True
        for c in range(n):
            if ok(r, c):
                used_cols.add(c)
                used_regions.add(regions[r][c])
                placed.append((r, c))
                if bt(r + 1):
                    return True
                placed.pop()
                used_cols.discard(c)
                used_regions.discard(regions[r][c])
        return False

    return placed if bt(0) else None
