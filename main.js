// main.js — Electron 메인 프로세스: 항상 위에 떠있는 투명 위젯 창 + 캘린더 IPC
const { app, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const calendar = require('./calendar');

let win = null;
let tray = null;
// 기본 창은 캐릭터 + 말풍선이 모두 들어갈 만큼 넉넉하게.
// (말풍선 뜰 때마다 창 크기를 바꾸면 화면이 튀어서, 크기는 패널 열 때만 바뀝니다)
const COLLAPSED = { w: 380, h: 400 };

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
ipcMain.on('move-by', (e, d) => {
  if (!win || !d) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x + Math.round(d.dx), y: b.y + Math.round(d.dy), width: b.width, height: b.height });
});

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
  // 맥은 흑백 템플릿 아이콘(메뉴바 자동 대응), 윈도우는 컬러 아이콘이 잘 보임
  const iconFile = isMac ? 'tray.png' : 'tray-win.png';
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', iconFile));
  if (!img.isEmpty()) img = img.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('모렝이 일정위젯');
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
