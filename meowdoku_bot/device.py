"""Device backends: take a screenshot, tap a point."""
import io
import subprocess

from PIL import Image


class AdbDevice:
    """Android phone or emulator (BlueStacks, LDPlayer) over ADB. Works on Windows."""

    def __init__(self, serial=None):
        self.base = ["adb"] + (["-s", serial] if serial else [])

    def screenshot(self):
        png = subprocess.run(self.base + ["exec-out", "screencap", "-p"],
                             capture_output=True, check=True).stdout
        return Image.open(io.BytesIO(png))

    def tap(self, x, y):
        subprocess.run(self.base + ["shell", "input", "tap", str(x), str(y)], check=True)


class IosWdaDevice:
    """iPhone running WebDriverAgent (pip install facebook-wda).

    Start WDA first, e.g. with go-ios / pymobiledevice3 / tidevice, then
    forward port 8100. WDA taps use points, screenshots use pixels.
    """

    def __init__(self, url="http://localhost:8100"):
        import wda
        self.client = wda.Client(url)
        self.scale = self.client.scale

    def screenshot(self):
        return self.client.screenshot()

    def tap(self, x, y):
        self.client.click(x / self.scale, y / self.scale)
