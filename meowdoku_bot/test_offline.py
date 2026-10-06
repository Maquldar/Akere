"""Checks vision + solver + screen logic against saved screenshots (no phone needed)."""
from pathlib import Path

from PIL import Image

from bot import find_orange_button, find_tap_to_continue, is_dimmed
from solver import solve
from vision import read_board

SAMPLES = Path(__file__).parent.parent / "samples"
LEVEL47 = [(0, 2), (1, 4), (2, 6), (3, 3), (4, 8), (5, 1), (6, 7), (7, 5), (8, 0)]


def test_level47():
    for name in ["level47_empty.jpg", "level47_solved.jpg"]:
        img = Image.open(SAMPLES / name)
        assert not is_dimmed(img)
        regions, _ = read_board(img)
        assert solve(regions) == LEVEL47, name


def test_screens():
    win = Image.open(SAMPLES / "win.jpg")
    assert is_dimmed(win) and find_orange_button(win)
    home = Image.open(SAMPLES / "home.jpg")
    assert find_orange_button(home)
    for name, text_y in [("leaderboard.jpg", 1142), ("leaderboard_emu.png", 1048)]:
        lb = Image.open(SAMPLES / name)
        assert is_dimmed(lb) and find_orange_button(lb) is None
        x, y = find_tap_to_continue(lb)
        assert abs(y - text_y) < 25 and abs(x - lb.width // 2) < 60, (name, x, y)


if __name__ == "__main__":
    test_level47()
    test_screens()
    print("all tests passed")
