# 머랭이 일정위젯

데스크톱 구석에 캐릭터가 떠 있으면서 —

- **캐릭터 클릭** → 오늘 구글 캘린더 일정 보기 (날짜 이동 · 할 일 탭)
- **회의 10분 전 / 5분 전 / 시작 시각** → 말풍선 알림 (직접 닫을 때까지 안 사라짐)
- 화상회의 링크가 있으면 말풍선에서 **바로 참여**

동료 배포용 안내문은 `설치안내.md`, 다운로드 페이지는 `landing/index.html` 입니다.

---

## 개발용 실행

```bash
npm install
npm start
```

코드를 고치면 앱을 껐다 켜기만 하면 반영돼요.

---

## 사내 배포용 빌드

### 맥 (.dmg)

```bash
npm run dist:mac
```

→ `dist/Moreng-0.1.0-arm64.dmg` (앱 번들은 `dist/mac-arm64/Moreng.app`)

빌드 중 `afterPack` 훅이 **애드혹 서명**을 자동으로 겁니다 (`scripts/sign-mac.sh`).
로그에 아래 두 줄이 보이면 정상이에요:

```
• ✅ 서명 유효
• ✅ JIT entitlements 적용됨
```

인텔 맥도 지원하려면 `package.json` 의 `build.mac.target[0].arch` 에 `"x64"` 를 추가하세요.

### 윈도우 (.exe)

**윈도우 PC에서** 실행하는 게 확실해요:

```bash
npm run dist:win
```

→ `dist/Moreng Setup 0.1.0.exe`

맥에서 만들려면 `wine` 이 필요해 실패할 수 있어요. 윈도우 장비가 없다면 GitHub Actions 로 두 OS 빌드를 자동화하는 방법이 있습니다.

### 배포

GitHub Releases 나 사내 드라이브에 `.dmg` / `.exe` 를 올리고,
`landing/index.html` 의 `MAC_URL` / `WIN_URL` 에 그 주소를 넣어 페이지를 함께 공유하면 됩니다.

---

## ⚠️ 건드리면 안 되는 것

### 앱 이름은 반드시 영문 (`Moreng`)

`productName` 이나 `CFBundleName` 을 **한글로 바꾸면 앱이 실행 즉시 죽습니다.**

```
FATAL: Unable to find helper app
```

Electron 은 `CFBundleName` 값으로 헬퍼 앱 경로(`{CFBundleName} Helper.app`)를 조립하는데,
macOS 파일시스템은 한글을 NFD(자모 분리)로 저장하고 Info.plist 는 NFC 로 저장해서
같은 글자인데 문자열이 일치하지 않아 헬퍼를 못 찾습니다.

Finder 에 보이는 이름은 `CFBundleDisplayName` 으로만 한글 처리하세요. (현재 그렇게 설정돼 있음)

### 서명은 dmg 를 만들기 "전에"

`afterPack` 훅에서 서명하는 이유예요. dmg 를 먼저 만들면 서명 안 된 앱이 dmg 안에 들어갑니다.

### 인증서 없이 배포하므로 첫 실행 시 경고

맥은 **우클릭 → 열기**, 윈도우는 **추가 정보 → 실행** 로 넘어갑니다 (안내문에 포함).

### 캐릭터는 원티드 IP

**사내용으로만** 사용하세요.

---

## 구글 캘린더 연결

1. 구글 캘린더(웹) → 오른쪽 위 **⚙ 설정**
2. 왼쪽 아래 **"내 캘린더의 설정"** 에서 캘린더 선택
3. **"캘린더 통합"** → **비공개 주소(iCal)** 의 `...basic.ics` 복사
4. 위젯 캐릭터 클릭 → **⚙ 설정** → 붙여넣고 저장

> 비공개 주소는 비밀번호나 마찬가지예요. 위젯에서는 가려져 보이고 👁 로만 확인됩니다.

---

## 캐릭터

`renderer/characters/` 안에 있어요. 기본은 `moreng.webp`.

- 기본 8종: 머랭이 · 고미 · 마그넘 · 콜리 (각 3D / 2D)
- **히든 2종**: ⚙ 설정에서 **"캐릭터" 글자를 5번 연속 클릭**하면 지구 · 현상수배가 나타납니다 (팀 이스터에그)
- 캐릭터를 고르면 위젯 색 테마도 함께 바뀝니다

새 캐릭터를 넣으려면 `renderer/characters/` 에 **배경 투명 PNG** 를 넣고,
`renderer/index.html` 의 `CHARS` 와 `THEMES` 에 항목을 추가하세요.

---

## 구조

| 파일 | 역할 |
|---|---|
| `main.js` | Electron 메인 — 창 · 트레이 · IPC · 클릭 통과 |
| `preload.js` | 렌더러에 노출하는 안전한 API |
| `calendar.js` | iCal 파싱 · 오늘 일정 추출 · 회의 링크 탐지 |
| `renderer/index.html` | 위젯 UI 전체 (단일 파일) |
| `scripts/after-pack.js` | 빌드 직후 서명 훅 |
| `scripts/sign-mac.sh` | 애드혹 서명 |
| `build/entitlements.mac.plist` | JIT 권한 (없으면 실행 즉시 종료) |
| `landing/` | 사내 다운로드 페이지 |

---

## 다음에 해볼 만한 것

- 구글 로그인(OAuth) 연동 → iCal 주소 없이 자동 연결
- 캐릭터 표정 전환 (알림 시 놀란 표정 등) — 표정별 이미지가 있으면 가능
- Apple Developer 인증서($99/년)로 공증 → 첫 실행 경고 제거
