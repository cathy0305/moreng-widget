#!/bin/bash
# 애드혹(임시) 서명 — 애플 실리콘에서 서명 없는 앱이 즉시 강제 종료(trace trap)되는 것을 막습니다.
#
# 핵심 두 가지:
#  1) 안쪽 부품부터 바깥 순서로 서명해야 유효한 서명이 됩니다.
#  2) Electron(V8)은 JIT 를 쓰기 때문에 entitlements 를 함께 넣어야 합니다.
#     안 넣으면 서명이 "유효"해도 macOS 의 code signing monitor 가 실행 직후 죽입니다.
#
# 반드시 dmg 를 만들기 "전에" 실행돼야 합니다. (electron-builder 의 afterPack 훅에서 호출)
# 사용법: sign-mac.sh "/path/to/앱.app"
set -u

APP="${1:-}"
if [ -z "$APP" ]; then
  APP=$(find dist -maxdepth 2 -name "*.app" -type d 2>/dev/null | head -1)
fi
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "❌ 서명할 .app 을 찾지 못했습니다: '$APP'"
  exit 1
fi

# entitlements 위치 (이 스크립트 기준 ../build/)
ENT="$(cd "$(dirname "$0")/.." && pwd)/build/entitlements.mac.plist"
if [ ! -f "$ENT" ]; then
  echo "❌ entitlements 파일이 없습니다: $ENT"
  exit 1
fi

echo "  • 애드혹 서명 대상: $APP"
echo "  • entitlements: $ENT"

SIGN_OPTS=(--force --sign - --timestamp=none --entitlements "$ENT")

# 1) 내부 dylib / so (entitlements 불필요)
find "$APP/Contents/Frameworks" -type f \( -name "*.dylib" -o -name "*.so" \) 2>/dev/null | while read -r f; do
  codesign --force --sign - "$f" 2>/dev/null
done

# 2) 프레임워크 (Electron Framework 등)
for f in "$APP"/Contents/Frameworks/*.framework; do
  [ -e "$f" ] || continue
  codesign --force --sign - "$f/Versions/A" 2>/dev/null || codesign --force --sign - "$f" 2>/dev/null
done

# 3) 헬퍼 앱들 — JIT 권한이 여기에도 필요합니다 (렌더러가 여기서 돕니다)
for h in "$APP"/Contents/Frameworks/*.app; do
  [ -e "$h" ] || continue
  codesign "${SIGN_OPTS[@]}" "$h" 2>/dev/null
done

# 4) 마지막에 앱 본체
codesign "${SIGN_OPTS[@]}" "$APP"

# 5) 검증
if codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | grep -q "valid on disk"; then
  echo "  • ✅ 서명 유효"
else
  echo "  • ⚠️ 서명 검증 실패:"
  codesign --verify --deep --strict --verbose=2 "$APP" || true
fi

# entitlements 가 실제로 들어갔는지 확인
if codesign -d --entitlements - "$APP" 2>/dev/null | grep -q "allow-jit"; then
  echo "  • ✅ JIT entitlements 적용됨"
else
  echo "  • ⚠️ JIT entitlements 가 안 들어갔습니다 — 실행 시 죽을 수 있어요"
fi

xattr -cr "$APP" 2>/dev/null
