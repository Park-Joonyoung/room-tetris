#!/usr/bin/env bash
# CI 의 안드로이드 에뮬레이터에 APK 를 설치해 실제로 띄워 보고 화면을 캡처한다.
# 캡처와 로그는 smoke/ 에 남고, 워크플로가 아티팩트로 올린다.
#   사용: bash android/ci-smoke.sh <apk 경로>
set -uo pipefail

APK="$1"
PKG=io.github.parkjoonyoung.roomtetris
ACTIVITY="$PKG/.MainActivity"
BASE="https://park-joonyoung.github.io/room-tetris/"
OUT=smoke
mkdir -p "$OUT"

shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "captured $1"; }
open() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' -n $ACTIVITY" > /dev/null; }

# 화면에 보이는 글자(웹 화면 포함)의 가운데 좌표를 찾아 누른다. 못 찾으면 1 을 돌려준다.
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1
  local xy
  xy=$(python3 - "$1" "$OUT/ui.xml" <<'PY'
import re, sys
text, path = sys.argv[1], sys.argv[2]
try:
    xml = open(path, encoding='utf-8').read()
except OSError:
    sys.exit(1)
for node in re.findall(r'<node [^>]*>', xml):
    labels = [m.group(1).strip() for m in (re.search(r' text="([^"]*)"', node), re.search(r' content-desc="([^"]*)"', node)) if m]
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if bounds and text in labels:
        x1, y1, x2, y2 = map(int, bounds.groups())
        print((x1 + x2) // 2, (y1 + y2) // 2)
        sys.exit(0)
sys.exit(1)
PY
  ) || return 1
  echo "tap '$1' at $xy"
  adb shell input tap $xy
}

set -e
adb install -r "$APK"
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode" | head -2
adb shell dumpsys webviewupdate | grep -iE "current webview package" | head -1 || true
adb logcat -c

# 1) 앱 실행 → 첫 화면
adb shell am start -W -n "$ACTIVITY"
sleep 30
shot 01-first-screen

# 2) 가져오기 링크로 열기 → 확인 창 → 합치기
#    (앱 안에 테스트용 가구와 배치도를 넣는 방법이기도 하다)
LINK=$(node android/ci-demo-link.mjs "$BASE")
echo "import link: ${#LINK} chars"
open "$LINK"
sleep 12
shot 02-import-confirm
set +e
if ! tap_text "합치기"; then
  echo "::warning::'합치기' 버튼을 화면에서 찾지 못해 위치를 추정해서 누릅니다"
  SIZE=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1)
  W=${SIZE%x*}; H=${SIZE#*x}
  adb shell input tap $((W * 3 / 4)) $((H * 93 / 100))
fi
set -e
sleep 6
shot 03-after-import

# 3) 가져온 배치도의 3D 편집 화면
open "${BASE}#/layout/demo"
sleep 20
shot 04-editor-3d

# 4) 설정 화면
open "${BASE}#/settings"
sleep 8
shot 05-settings

# 5) 휴대폰 뒤로가기 → 웹 화면 안에서 뒤로
adb shell input keyevent KEYCODE_BACK
sleep 5
shot 06-after-back

# 웹 화면의 콘솔 메시지와 앱 오류를 남긴다.
adb logcat -d -v brief | grep -E "chromium|AndroidRuntime|$PKG" | tail -200 > "$OUT/logcat.txt" || true
echo "---- console / errors ----"
grep -iE "error|exception|uncaught|fatal" "$OUT/logcat.txt" | tail -30 || echo "(오류 로그 없음)"

# 앱이 죽지 않고 떠 있는지 확인
if adb shell pidof "$PKG" > /dev/null; then
  echo "app is running"
else
  echo "::error::앱이 실행 중이 아닙니다(크래시 가능성)"
  exit 1
fi
