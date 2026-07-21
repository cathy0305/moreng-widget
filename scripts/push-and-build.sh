#!/bin/bash
# 소스를 GitHub 에 올리고 버전 태그를 밀어 → GitHub Actions 가 맥+윈도우 빌드를 자동 생성.
# 사용: bash scripts/push-and-build.sh [저장소이름]
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

REPO_NAME="${1:-moreng-widget}"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

# 0) gh 확인
command -v gh >/dev/null 2>&1 || { echo "❌ GitHub CLI(gh) 필요: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login
gh auth setup-git >/dev/null 2>&1 || true

USER=$(gh api user --jq .login)
REPO="$USER/$REPO_NAME"

# 1) 저장소 없으면 생성
gh repo view "$REPO" >/dev/null 2>&1 || {
  echo "▶ private 저장소 생성: $REPO"
  gh repo create "$REPO" --private --description "모렝이 일정위젯" >/dev/null
}

# 2) git 초기화 + 커밋
[ -d .git ] || git init -b main >/dev/null
git config user.name  >/dev/null 2>&1 || git config user.name  "$USER"
git config user.email >/dev/null 2>&1 || git config user.email "$USER@users.noreply.github.com"
git add -A
git commit -m "release $TAG" >/dev/null 2>&1 || git commit --allow-empty -m "release $TAG" >/dev/null

# 3) 원격 연결 + 푸시 (새 배포 저장소라 강제 푸시)
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "https://github.com/$REPO.git" \
  || git remote add origin "https://github.com/$REPO.git"
echo "▶ 소스 푸시…"
git push -u origin main --force

# 4) 태그 푸시 → Actions 빌드 트리거
echo "▶ 태그 $TAG 푸시 → 자동 빌드 시작…"
git tag -f "$TAG"
git push -f origin "$TAG"

echo ""
echo "✅ 푸시 완료! GitHub Actions 가 맥 + 윈도우 빌드를 만들고 있어요."
echo "   진행 상황:  https://github.com/$REPO/actions"
echo "   완료되면:   https://github.com/$REPO/releases/tag/$TAG"
echo ""
echo "빌드는 보통 5~10분 걸려요. 끝나면 릴리스에 .dmg 와 .exe 가 함께 올라옵니다."
echo "그다음 랜딩 링크 채우기: bash scripts/fill-landing-urls.sh"
