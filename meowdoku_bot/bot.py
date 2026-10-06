"""Plays Meowdoku level after level without user input.

Usage:
  python bot.py --device adb            # Android phone / emulator
  python bot.py --device ios            # iPhone with WebDriverAgent running
  python bot.py --device adb --levels 20
"""
import argparse
import time

import numpy as np

from solver import solve
from vision import read_board

TAPS_PER_CAT = 2      # tap 1 = X, tap 2 = cat; set to 1 if the game places a cat directly
TAP_DELAY = 0.08
SCREEN_DELAY = 1.5


def is_dimmed(img):
    """Popup overlays (win screen, leaderboard) darken the whole screen."""
    top = np.asarray(img.convert("L"))[: img.height // 20]
    return top.mean() < 150


def find_orange_button(img):
    """Center of the big orange button ('Continue', 'Level N'), or None."""
    a = np.asarray(img.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = (r > 200) & (g > 110) & (g < 180) & (b < 80)
    mask[: img.height // 2] = False  # buttons are in the lower half
    ys, xs = np.nonzero(mask)
    if len(xs) < img.width * 20:
        return None
    return int(np.median(xs)), int(np.median(ys))


def find_tap_to_continue(img):
    """Center of the yellow 'Tap to Continue' text: the lowest yellow thing on screen."""
    a = np.asarray(img.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = (r > 200) & (g > 170) & (b < 140) & (r - b > 90)
    mask[: img.height * 3 // 4] = False
    rows = np.nonzero(mask.sum(axis=1) > img.width // 60)[0]
    if len(rows) == 0:
        return None
    bottom = rows[-1]
    ys, xs = np.nonzero(mask[bottom - img.height // 25: bottom + 1])
    return int(np.median(xs)), int(bottom - img.height // 25 + np.median(ys))


def play_level(dev, img):
    regions, centers = read_board(img)
    cats = solve(regions)
    if cats is None:
        raise RuntimeError("no solution - board misread")
    for r, c in cats:
        for _ in range(TAPS_PER_CAT):
            dev.tap(*centers[r][c])
            time.sleep(TAP_DELAY)


def step(dev):
    """Look at the screen once and do the right thing. Returns True if a level was solved."""
    img = dev.screenshot()
    if not is_dimmed(img):
        try:
            play_level(dev, img)
            return True
        except (ValueError, IndexError):
            pass  # no board on screen
    button = find_orange_button(img) or find_tap_to_continue(img)
    if button:
        dev.tap(*button)  # Continue / Level N / Tap to Continue
    else:
        dev.tap(img.width // 2, int(img.height * 0.95))
    return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--device", choices=["adb", "ios"], default="adb")
    p.add_argument("--serial", help="adb device serial")
    p.add_argument("--levels", type=int, default=0, help="stop after N levels (0 = forever)")
    args = p.parse_args()

    from device import AdbDevice, IosWdaDevice
    dev = AdbDevice(args.serial) if args.device == "adb" else IosWdaDevice()

    solved = 0
    while not args.levels or solved < args.levels:
        if step(dev):
            solved += 1
            print(f"solved level #{solved}")
        time.sleep(SCREEN_DELAY)


if __name__ == "__main__":
    main()
