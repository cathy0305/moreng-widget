#!/bin/bash
# 릴리스에 올라온 .dmg / .exe 다운로드 주소를 landing/index.html 에 자동으로 채웁니다.
# 빌드(Actions)가 끝난 뒤 실행하세요.
# 사용: bash scripts/fill-landing-urls.sh [저장소이름]
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

REPO_NAME="${1:-moreng-widget}"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
USER=$(gh api user --jq .login)
REPO="$USER/$REPO_NAME"

# 릴리스 자산 목록에서 dmg / exe 파일명 찾기
ASSETS=$(gh release view "$TAG" -R "$REPO" --json assets --jq '.assets[].name' 2>/dev/null || true)
if [ -z "$ASSETS" ]; then
  echo "❌ 릴리스 $TAG 에 자산이 없어요. Actions 빌드가 끝났는지 확인하세요:"
  echo "   https://github.com/$REPO/actions"
  exit 1
fi

DMG=$(echo "$ASSETS" | grep -i '\.dmg$' | head -1 || true)
EXE=$(echo "$ASSETS" | grep -i '\.exe$' | head -1 || true)

enc(){ python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
BASE="https://github.com/$REPO/releases/download/$TAG"
[ -n "$DMG" ] && MAC_URL="$BASE/$(enc "$DMG")" || MAC_URL="#"
[ -n "$EXE" ] && WIN_URL="$BASE/$(enc "$EXE")" || WIN_URL="#"

python3 - "$MAC_URL" "$WIN_URL" <<'PY'
import re,sys
mac,win=sys.argv[1],sys.argv[2]
p='landing/index.html'; s=open(p,encoding='utf-8').read()
s=re.sub(r'var MAC_URL = "[^"]*";', 'var MAC_URL = "%s";'%mac, s)
s=re.sub(r'var WIN_URL = "[^"]*";', 'var WIN_URL = "%s";'%win, s)
open(p,'w',encoding='utf-8').write(s)
print("  • MAC_URL:", mac)
print("  • WIN_URL:", win)
PY

echo ""
echo "✅ 랜딩 링크 채움 완료!"
echo "   미리보기: open landing/index.html"
echo "   배포:     cd landing && npx vercel --prod"
