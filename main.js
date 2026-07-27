// main.js — Electron 메인 프로세스: 항상 위에 떠있는 투명 위젯 창 + 캘린더 IPC
const { app, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const calendar = require('./calendar');

let win = null;
let tray = null;
// 기본 창은 캐릭터 + 말풍선이 모두 들어갈 만큼 넉넉하게.
// (말풍선 뜰 때마다 창 크기를 바꾸면 화면이 튀어서, 크기는 패널 열 때만 바뀝니다)
// 평소(말풍선/패널 없음)엔 캐릭터 크기만큼만. 말풍선·패널 뜰 때만 렌더러가 창을 키운다.
// (이렇게 해야 캐릭터를 화면 최상단까지 끌어올릴 수 있음 — 위쪽 빈 공간이 천장에 먼저 안 닿음)
const COLLAPSED = { w: 190, h: 186 };

function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch (e) { return { icalUrl: '' }; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch (e) {}
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - COLLAPSED.w - 24;
  const y = workArea.y + workArea.height - COLLAPSED.h - 24;

  win = new BrowserWindow({
    width: COLLAPSED.w, height: COLLAPSED.h, x, y,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(true);
  }
  // 기본은 클릭이 뒤로 통과되게. 캐릭터/패널 위에 마우스가 오면 렌더러가 꺼줍니다.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// 투명한 빈 영역에서는 클릭이 뒤 앱으로 통과되도록 토글
ipcMain.on('set-ignore', (e, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// 리사이즈 시 우하단 코너 고정 (렌더러가 원하는 w,h 전달)
ipcMain.on('resize', (e, size) => {
  if (!win || !size) return;
  const b = win.getBounds();
  const work = screen.getDisplayMatching(b).workArea;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  const h = Math.min(Math.round(size.h), work.height); // 화면보다 크지 않게
  win.setBounds({
    x: Math.round(right - size.w),
    y: Math.max(work.y, Math.round(bottom - h)),        // 화면 위로 넘어가지 않게
    width: Math.round(size.w), height: h,
  });
});

// 캐릭터 드래그로 창 이동
// (멀티모니터 + 서로 다른 배율에서 렌더러의 screenX 델타는 좌표계가 어긋나므로,
//  main 프로세스의 커서 좌표(getCursorScreenPoint)로 절대 위치를 계산한다. 둘 다 DIP라 안 어긋남)
let dragOffset = null;
ipcMain.on('drag-start', () => {
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragOffset = { x: c.x - b.x, y: c.y - b.y };
});
ipcMain.on('drag-move', () => {
  if (!win || !dragOffset) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const work = screen.getDisplayNearestPoint(c).workArea; // 커서가 있는 모니터 기준
  let x = c.x - dragOffset.x;
  let y = c.y - dragOffset.y;
  // 창이 화면 밖으로 완전히 벗어나지 않게 클램프 (한가운데서 멈추던 문제 방지)
  x = Math.max(work.x, Math.min(x, work.x + work.width - b.width));
  y = Math.max(work.y, Math.min(y, work.y + work.height - b.height));
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
});
ipcMain.on('drag-end', () => { dragOffset = null; });

ipcMain.handle('get-config', () => loadConfig());
// 부분 저장도 안전하도록 기존 설정과 병합
ipcMain.handle('save-config', (e, cfg) => { saveConfig(Object.assign(loadConfig(), cfg || {})); return true; });


// 파싱 결과 캐시 (날짜 이동을 빠르게)
let icsCache = { url: null, at: 0, data: null };
async function getIcsData(url, force) {
  const now = Date.now();
  if (!force && icsCache.url === url && icsCache.data && now - icsCache.at < 5 * 60 * 1000) return icsCache.data;
  const data = await calendar.fetchData(url);
  icsCache = { url, at: now, data };
  return data;
}

ipcMain.handle('fetch-events', async (e, opts) => {
  const { offset = 0, force = false } = opts || {};
  const cfg = loadConfig();
  if (!cfg.icalUrl && !cfg.tasksUrl) return { ok: false, error: 'no-url', events: [], tasks: [] };
  const out = { ok: true, events: [], tasks: [] };
  const target = new Date();
  target.setDate(target.getDate() + offset);
  if (cfg.icalUrl) {
    try {
      const data = await getIcsData(cfg.icalUrl, force);
      out.events = calendar.expandToday(data, target).map(serialize);
    } catch (err) { out.ok = false; out.error = String(err.message || err); }
  }
  if (cfg.tasksUrl) {
    try { out.tasks = (await calendar.fetchTasks(cfg.tasksUrl, target)).map(serializeTask); }
    catch (err) { /* 할 일 피드 실패는 무시하고 일정은 그대로 표시 */ }
  }
  return out;
});

// 투두리스트 (로컬 저장)
function todosPath() { return path.join(app.getPath('userData'), 'todos.json'); }
ipcMain.handle('get-todos', () => {
  try { return JSON.parse(fs.readFileSync(todosPath(), 'utf8')); } catch (e) { return []; }
});
ipcMain.handle('save-todos', (e, list) => {
  try { fs.writeFileSync(todosPath(), JSON.stringify(list || [], null, 2)); } catch (err) {}
  return true;
});

ipcMain.on('notify', (e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

// 외부 링크(화상회의)를 기본 브라우저로 열기
ipcMain.on('open-link', (e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// 메뉴바(트레이) 아이콘
function createTray() {
  const isMac = process.platform === 'darwin';
  let img;
  if (isMac) {
    // 맥은 흑백 템플릿 아이콘(메뉴바 라이트/다크 자동 대응)
    img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
    img.setTemplateImage(true);
  } else {
    // 윈도우는 멀티사이즈 .ico 를 그대로 넘긴다 — 트레이가 DPI에 맞는 크기를 골라 선명하게 표시.
    // (예전엔 32px PNG 한 장을 16px로 줄여 써서 작은 트레이에서 뭉개졌음)
    img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-win.ico'));
    if (img.isEmpty()) { // 혹시 .ico 로드 실패 시 PNG 폴백
      img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-win.png'));
      if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
    }
  }
  tray = new Tray(img);
  tray.setToolTip('머랭이 일정위젯');
  tray.on('click', () => tray.popUpContextMenu());
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: '위젯 보이기 / 숨기기', click: () => { if (!win) return; win.isVisible() ? win.hide() : win.show(); } },
    { label: '오늘 일정 새로고침', click: () => { if (win) win.webContents.send('refresh'); } },
    { type: 'separator' },
    {
      label: '로그인 시 자동 실행', type: 'checkbox', checked: openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshTrayMenu(); },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function serialize(ev) {
  return {
    summary: ev.summary, location: ev.location, link: ev.link || '', allDay: ev.allDay,
    start: ev.start.toISOString(), end: ev.end.toISOString(),
  };
}

function serializeTask(t) {
  return { summary: t.summary, due: t.due.toISOString(), overdue: t.overdue, allDay: t.allDay };
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// 트레이 앱이므로 창을 숨겨도 종료하지 않음 (트레이 > 종료 로만 끝냄)
app.on('window-all-closed', () => {});
