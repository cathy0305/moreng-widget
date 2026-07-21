#!/bin/bash
# GitHub Releases 에 dmg 업로드 + 랜딩 페이지 링크 자동 채우기
# 필요: GitHub CLI(gh). 없으면 안내 후 종료.
# 사용: bash scripts/release-github.sh [저장소이름]
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

REPO_NAME="${1:-moreng-widget}"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
DMG="dist/Moreng-$VERSION-arm64.dmg"

# 0) gh 설치 확인
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI(gh)가 없어요. 먼저 설치하세요:"
  echo "   brew install gh"
  echo "   (Homebrew 가 없으면 https://cli.github.com 에서 설치)"
  exit 1
fi

# 1) 로그인 확인
if ! gh auth status >/dev/null 2>&1; then
  echo "▶ GitHub 로그인이 필요해요. 브라우저가 열립니다…"
  gh auth login
fi

# 2) dmg 있는지 확인 (없으면 빌드)
if [ ! -f "$DMG" ]; then
  echo "▶ dmg 가 없어서 먼저 빌드합니다…"
  npx electron-builder -m
fi
[ -f "$DMG" ] || { echo "❌ 빌드 결과물이 없습니다: $DMG"; exit 1; }

USER=$(gh api user --jq .login)
REPO="$USER/$REPO_NAME"

# 3) 저장소 없으면 생성 (private)
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  echo "▶ private 저장소 생성: $REPO"
  gh repo create "$REPO" --private --description "모렝이 일정위젯 배포" >/dev/null
fi

# 3-1) 릴리스는 빈 저장소에 못 붙음 → 커밋이 있는지 확인, 없으면 README 로 초기화
HAS_COMMIT=$(gh api "repos/$REPO/commits?per_page=1" --jq 'length' 2>/dev/null || echo 0)
if [ "$HAS_COMMIT" != "1" ]; then
  echo "▶ 빈 저장소 초기화 (첫 커밋 생성)…"
  README_B64=$(printf '# 모렝이 일정위젯\n\n사내 배포용. 다운로드는 Releases 를 확인하세요.\n' | base64)
  DEFBRANCH=$(gh api "repos/$REPO" --jq '.default_branch' 2>/dev/null || echo main)
  gh api -X PUT "repos/$REPO/contents/README.md" \
    -f message="초기 커밋" \
    -f content="$README_B64" \
    -f branch="$DEFBRANCH" >/dev/null
  echo "  • 첫 커밋 생성 완료, 반영 대기…"
  # 커밋이 실제로 잡힐 때까지 대기 (최대 ~15초)
  for i in $(seq 1 15); do
    sleep 1
    C=$(gh api "repos/$REPO/commits?per_page=1" --jq 'length' 2>/dev/null || echo 0)
    [ "$C" = "1" ] && { echo "  • 확인됨"; break; }
  done
fi

# 4) 릴리스 생성 + dmg 업로드 (기존 태그 있으면 파일만 교체)
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "▶ 기존 릴리스 $TAG 에 dmg 교체 업로드…"
  gh release upload "$TAG" "$DMG" -R "$REPO" --clobber
else
  echo "▶ 릴리스 $TAG 생성 + dmg 업로드…"
  gh release create "$TAG" "$DMG" -R "$REPO" --title "모렝이 일정위젯 $TAG" --notes "사내 배포용 · 맥(Apple Silicon)"
fi

# 5) 다운로드 URL 조립 + 랜딩 페이지에 채우기
DMG_BASENAME=$(basename "$DMG")
# URL 인코딩(공백 등) — dmg 이름엔 공백이 없지만 안전하게
MAC_URL="https://github.com/$REPO/releases/download/$TAG/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$DMG_BASENAME")"

python3 - "$MAC_URL" <<'PY'
import re,sys
url=sys.argv[1]
p='landing/index.html'; s=open(p,encoding='utf-8').read()
s=re.sub(r'var MAC_URL = "[^"]*";', 'var MAC_URL = "%s";'%url, s)
open(p,'w',encoding='utf-8').write(s)
print("  • 랜딩 MAC_URL 채움:", url)
PY

echo ""
echo "✅ GitHub 릴리스 완료!"
echo "   저장소:   https://github.com/$REPO"
echo "   다운로드: $MAC_URL"
echo ""
echo "다음: 랜딩 페이지 배포"
echo "   cd landing && npx vercel --prod"
