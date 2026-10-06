# Meowdoku Bot

Plays [Meowdoku](https://apps.apple.com/search?term=meowdoku) on its own: it reads the board from a screenshot, solves it and taps the answer, then moves on to the next level.

## Rules it solves
N×N grid with N color regions. Exactly 1 cat per row, per column and per color, and cats can't touch, not even diagonally (the same rules as LinkedIn *Queens*).

## How it works
```
screenshot ─► vision.py (find grid, cluster cell colors) ─► solver.py (backtracking)
          ─► device.py (tap cells) ─► bot.py (handle win/leaderboard/home screens, loop)
```
- **vision.py**: finds the grid by color-saturation projection and samples each cell's color from its edge strip, so X marks and cats don't confuse it.
- **solver.py**: row-by-row backtracking. A 9×9 board solves in under 1 ms.
- **bot.py**: tells the screens apart (a dimmed overlay means a popup, an orange button means Continue or Level N) and decides what to tap.

## Run
```bash
pip install -r requirements.txt
python meowdoku_bot/test_offline.py           # verify on saved screenshots
python meowdoku_bot/bot.py --device adb       # Android phone/emulator
python meowdoku_bot/bot.py --device ios       # iPhone + WebDriverAgent on :8100
```

### Controlling the phone without a Mac
- **Android emulator on Windows (easiest)**: install BlueStacks or LDPlayer, install Meowdoku from the Play Store, enable ADB in the emulator settings, then run `adb connect 127.0.0.1:5555`.
- **iPhone from Windows/Linux**: sign WebDriverAgent with a free Apple ID (Sideloadly), launch it with `pymobiledevice3` or `go-ios`, and forward port 8100. This is harder, and free signing expires every 7 days.

## Known limits
- `TAPS_PER_CAT` in `bot.py` assumes tap 1 = X and tap 2 = cat. Change it if your build behaves differently.
- Full-screen ads are not handled yet.
