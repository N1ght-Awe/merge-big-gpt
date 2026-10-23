"""Run the signed APK through an offline first launch and process-death restore."""
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = 'io.github.n1ghtawe.pocketgames'
OUT = Path('output/android-smoke')
OUT.mkdir(parents=True, exist_ok=True)
launcher_dialogs = 0


def adb(*args, binary=False):
    return subprocess.check_output(['adb', *args], text=not binary)


def screen(name):
    (OUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))


def wait_node(label, name):
    global launcher_dialogs
    last = ''
    for _ in range(20):
        adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
        last = adb('shell', 'cat', '/sdcard/window.xml')
        (OUT / f'{name}.xml').write_text(last, encoding='utf-8')
        root = ET.fromstring(last)
        # A newly booted CI image can show a launcher ANR over another app.
        # Dismiss only that specific system dialog; never hide a game ANR.
        titles = [n.get('text', '') for n in root.iter('node') if n.get('resource-id') == 'android:id/alertTitle']
        if any(t.startswith('Pixel Launcher') and "isn't responding" in t for t in titles):
            launcher_dialogs += 1
            screen(f'launcher-dialog-{launcher_dialogs}')
            close = next(n for n in root.iter('node') if n.get('resource-id') == 'android:id/aerr_close')
            tap(close)
            time.sleep(2)
            if name == 'launcher-icon':
                open_app_drawer()
            continue
        if any("isn't responding" in t for t in titles):
            raise AssertionError(f'Application ANR: {titles}')
        for node in root.iter('node'):
            if label in node.get('text', '') or label in node.get('content-desc', ''):
                return node
        time.sleep(2)
    raise AssertionError(f'Missing visible UI: {label}')


def tap(node, x_ratio=0.5, y_ratio=0.5):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.attrib['bounds']))
    assert x2 > x1 and y2 > y1, 'Element is not visible'
    adb('shell', 'input', 'tap', str(int(x1 + (x2 - x1) * x_ratio)), str(int(y1 + (y2 - y1) * y_ratio)))


def open_app_drawer():
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(2)
    size = adb('shell', 'wm', 'size')
    width, height = map(int, re.findall(r'(\d+)x(\d+)', size)[-1])
    adb('shell', 'input', 'swipe', str(width // 2), str(int(height * .9)),
        str(width // 2), str(int(height * .3)), '400')


try:
    adb('install', '-r', 'release/merge-big-gpt-android.apk')
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable')
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    assert adb('shell', 'settings', 'get', 'global', 'airplane_mode_on').strip() == '1'
    adb('logcat', '-c')
    open_app_drawer()
    launcher_icon = wait_node('合成大GPT', 'launcher-icon')
    assert launcher_icon.get('package') == 'com.google.android.apps.nexuslauncher'
    screen('launcher-icon')
    tap(launcher_icon)
    canvas = wait_node('合成大GPT游戏画布', 'first-launch')
    time.sleep(3)
    screen('first-launch-offline')
    tap(canvas, 0.42, 0.65)
    time.sleep(3)
    screen('after-drop-offline')
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(2)
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')
    resume = wait_node('继续合成', 'restored-paused')
    screen('restored-paused-offline')
    tap(resume)
    wait_node('暂停', 'resumed')
    time.sleep(1)
    screen('resumed-offline')
    (OUT / 'result.json').write_text(json.dumps({
        'package': PACKAGE, 'airplaneMode': True, 'firstLaunchOffline': True,
        'dropAccepted': True, 'processDeathRestorePaused': True, 'resumeOffline': True,
        'launcherDialogsDismissed': launcher_dialogs,
        'launchedFromAppIcon': True,
    }, indent=2), encoding='utf-8')
finally:
    screen('last-frame')
    (OUT / 'logcat.txt').write_text(adb('logcat', '-d'), encoding='utf-8')
