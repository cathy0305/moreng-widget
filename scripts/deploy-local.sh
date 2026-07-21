#!/bin/bash
# 내 맥에 최신 코드로 재설치 — 빌드 → /Applications 에 설치 → 실행
# 사용: npm run deploy
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

APP_SRC="dist/mac-arm64/Moreng.app"
APP_DST="/Applications/Moreng.app"

echo "▶ 실행 중인 위젯 종료…"
pkill -f "Moreng.app/Contents/MacOS/Moreng" 2>/dev/null || true
sleep 1

echo "▶ 이전 빌드 정리…"
rm -rf "$APP_DST" dist

echo "▶ 빌드 + 서명…"
npx electron-builder -m

if [ ! -d "$APP_SRC" ]; then
  echo "❌ 빌드 결과물이 없습니다: $APP_SRC"
  exit 1
fi

echo "▶ Applications 에 설치…"
ditto "$APP_SRC" "$APP_DST"
xattr -cr "$APP_DST" 2>/dev/null || true

echo "▶ 실행…"
open "$APP_DST"

echo ""
echo "✅ 업데이트 완료! 화면 오른쪽 아래 + 메뉴바를 확인하세요."
echo "   (배포용 dmg 도 dist/ 에 함께 생성됨)"
