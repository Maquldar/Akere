"""Read the Meowdoku board from a screenshot.

Works on the empty board and on boards with X marks / cats, because each
cell's color is sampled from a thin strip along its edge.
"""
import numpy as np
from PIL import Image


def _runs(mask, min_len):
    """Start/end index pairs of consecutive True values."""
    runs, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    if start is not None and len(mask) - start >= min_len:
        runs.append((start, len(mask)))
    return runs


def _largest_uniform_group(runs, tol=0.25):
    """Longest chain of consecutive runs with similar length (the grid rows)."""
    best, cur = [], []
    for r in runs:
        if cur and abs((r[1] - r[0]) - (cur[0][1] - cur[0][0])) <= tol * (cur[0][1] - cur[0][0]):
            cur.append(r)
        else:
            cur = [r]
        if len(cur) > len(best):
            best = list(cur)
    return best


def read_board(image):
    """Return (regions, cell_centers).

    regions: N x N region ids; cell_centers: N x N (x, y) pixel coordinates.
    """
    img = np.asarray(image.convert("RGB")).astype(int)
    h, w, _ = img.shape
    sat = img.max(axis=2) - img.min(axis=2) > 35  # colored cell pixels

    rows = _largest_uniform_group(_runs(sat.mean(axis=1) > 0.3, h // 60))
    y0, y1 = rows[0][0], rows[-1][1]
    cols = _largest_uniform_group(_runs(sat[y0:y1].mean(axis=0) > 0.3, w // 60))
    n = len(rows)
    if len(cols) != n:
        raise ValueError(f"grid detection failed: {n} rows vs {len(cols)} cols")

    colors = np.zeros((n, n, 3))
    centers = [[None] * n for _ in range(n)]
    for i, (ya, yb) in enumerate(rows):
        for j, (xa, xb) in enumerate(cols):
            m = max(2, (yb - ya) // 12)  # thin border strip, skips X / cat art
            strip = np.concatenate([
                img[ya + m:ya + 2 * m, xa + m:xb - m].reshape(-1, 3),
                img[yb - 2 * m:yb - m, xa + m:xb - m].reshape(-1, 3),
            ])
            colors[i, j] = np.median(strip, axis=0)
            centers[i][j] = ((xa + xb) // 2, (ya + yb) // 2)

    # greedy color clustering
    palette, regions = [], [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            c = colors[i, j]
            for k, p in enumerate(palette):
                if np.abs(c - p).max() < 28:
                    regions[i][j] = k
                    break
            else:
                palette.append(c)
                regions[i][j] = len(palette) - 1
    if len(palette) != n:
        raise ValueError(f"found {len(palette)} colors for a {n}x{n} grid")
    return regions, centers


if __name__ == "__main__":
    import sys
    from solver import solve
    regions, centers = read_board(Image.open(sys.argv[1]))
    sol = set(solve(regions) or [])
    for i, row in enumerate(regions):
        print(" ".join(("[%d]" if (i, j) in sol else " %d ") % v for j, v in enumerate(row)))
