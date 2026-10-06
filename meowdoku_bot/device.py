"""Device backends: take a screenshot, tap a point."""
import io
import subprocess

from PIL import Image


class AdbDevice:
    """Android phone or emulator (BlueStacks, LDPlayer) over ADB. Works on Windows."""

    def __init__(self, serial=None):
        if serial and ":" in serial:
            subprocess.run(["adb", "connect", serial], capture_output=True)
        devices = self._devices()
        if serial is None:
            if len(devices) != 1:
                raise SystemExit(
                    f"adb sees {len(devices)} ready devices: {devices or 'none'}\n"
                    "Run 'adb devices', then pass one with --serial, e.g. --serial 127.0.0.1:5555")
            serial = devices[0]
        elif serial not in devices:
            raise SystemExit(f"device {serial} is not ready. 'adb devices' shows: {devices or 'none'}")
        print(f"using adb device {serial}")
        self.base = ["adb", "-s", serial]

    @staticmethod
    def _devices():
        out = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
        return [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith("device")]

    def _run(self, *args):
        res = subprocess.run(self.base + list(args), capture_output=True)
        if res.returncode != 0:
            raise RuntimeError(f"adb {' '.join(args)} failed: {res.stderr.decode(errors='replace').strip()}")
        return res.stdout

    def screenshot(self):
        return Image.open(io.BytesIO(self._run("exec-out", "screencap", "-p")))

    def tap(self, x, y):
        self._run("shell", "input", "tap", str(x), str(y))


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
