// calendar.js — 구글 캘린더 iCal 파싱 & 오늘 일정 추출 (Electron과 독립적으로 테스트 가능)
const ical = require('node-ical');

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function endOfDay(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

function isAllDay(ev) {
  // node-ical marks all-day starts with .dateOnly
  return !!(ev.start && ev.start.dateOnly);
}

// 일정 안에서 화상회의 링크 추출 (location / url / description 순으로 탐색)
function meetingLink(ev) {
  const fields = [ev.location, ev.url, ev.description]
    .filter(Boolean)
    .map((v) => (typeof v === 'string' ? v : (v && v.val) || String(v)));
  const text = fields.join(' \n ');
  const urls = text.match(/https?:\/\/[^\s<>"'\)\]]+/g) || [];
  const known = /(meet\.google\.com|zoom\.us|teams\.microsoft|teams\.live|webex\.com|whereby\.com|meet\.jit\.si|around\.co|gather\.town|hangouts\.google)/i;
  for (const u of urls) { if (known.test(u)) return u; }
  if (ev.location && /^https?:\/\//.test(String(ev.location).trim())) return String(ev.location).trim();
  return urls[0] || '';
}

// data: node-ical 파싱 결과 객체. now 기준 '오늘' 일정만 뽑아 정렬해서 반환.
function expandToday(data, now = new Date()) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const out = [];

  for (const key in data) {
    const ev = data[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;

    const durationMs = (ev.end && ev.start) ? (ev.end - ev.start) : 30 * 60 * 1000;

    if (ev.rrule) {
      // 반복 일정: 오늘 범위 안의 발생을 계산
      let dates = [];
      try { dates = ev.rrule.between(dayStart, dayEnd, true); } catch (e) { dates = []; }

      // 이 반복에서 개별 수정된 회차(override) 처리
      const recur = ev.recurrences || {};
      const ex = ev.exdate || {};

      for (const dt of dates) {
        const dayKey = toDateKey(dt);

        // 삭제된 회차(exdate) 건너뛰기
        if (matchesAny(ex, dt)) continue;

        // 수정된 회차가 있으면 그걸로 대체
        if (recur[dayKey]) {
          const r = recur[dayKey];
          if (r.start >= dayStart && r.start <= dayEnd) {
            out.push(makeItem(r, r.end ? (r.end - r.start) : durationMs));
          }
          continue;
        }
        out.push({
          summary: ev.summary || '(제목 없음)',
          start: new Date(dt),
          end: new Date(new Date(dt).getTime() + durationMs),
          location: ev.location || '',
          link: meetingLink(ev),
          allDay: isAllDay(ev),
        });
      }
    } else {
      // 단발 일정
      if (ev.start >= dayStart && ev.start <= dayEnd) {
        out.push(makeItem(ev, durationMs));
      } else if (isAllDay(ev) && sameDate(ev.start, now)) {
        out.push(makeItem(ev, durationMs));
      }
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

function makeItem(ev, durationMs) {
  return {
    summary: ev.summary || '(제목 없음)',
    start: new Date(ev.start),
    end: ev.end ? new Date(ev.end) : new Date(new Date(ev.start).getTime() + durationMs),
    location: ev.location || '',
    link: meetingLink(ev),
    allDay: isAllDay(ev),
  };
}

function toDateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function matchesAny(exMap, dt) {
  for (const k in exMap) {
    const exd = exMap[k];
    if (exd && Math.abs(exd - dt) < 12 * 3600 * 1000 && sameDate(exd, dt)) return true;
  }
  return false;
}

// 알림 대상 계산: 각 일정에 대해 (시작 preMin분 전) 또는 (정시)에 걸리는 것 반환.
// firedKeys: 이미 알린 키 Set. 반환된 항목들의 key를 호출측에서 firedKeys에 넣어야 함.
function dueAlerts(events, now, firedKeys, preMin = 5) {
  const due = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const startMs = ev.start.getTime();
    const nowMs = now.getTime();

    const preKey = keyOf(ev, 'pre');
    const preAt = startMs - preMin * 60000;
    if (!firedKeys.has(preKey) && nowMs >= preAt && nowMs < startMs) {
      due.push({ type: 'pre', event: ev, key: preKey, minsLeft: Math.max(1, Math.round((startMs - nowMs) / 60000)) });
    }

    const startKey = keyOf(ev, 'start');
    if (!firedKeys.has(startKey) && nowMs >= startMs && nowMs < startMs + 60000) {
      due.push({ type: 'start', event: ev, key: startKey, minsLeft: 0 });
    }
  }
  return due;
}

function keyOf(ev, kind) {
  return kind + '|' + ev.summary + '|' + ev.start.toISOString();
}

async function fetchData(url) {
  return await ical.async.fromURL(url);
}

async function fetchTodayEvents(url, now = new Date()) {
  const data = await ical.async.fromURL(url);
  return expandToday(data, now);
}

async function parseTodayEvents(icsString, now = new Date()) {
  const data = await ical.async.parseICS(icsString);
  return expandToday(data, now);
}

// 할 일 피드(Todoist/Asana/Jira 등)에서 오늘 마감 + 지난(밀린) 할 일 추출
function extractTasks(data, now = new Date()) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const out = [];
  for (const k in data) {
    const ev = data[k];
    if (!ev || (ev.type !== 'VEVENT' && ev.type !== 'VTODO')) continue;
    if (ev.status && String(ev.status).toUpperCase() === 'COMPLETED') continue;
    const due = ev.due || ev.start;
    if (!due) continue;
    const dueDate = new Date(due);
    if (dueDate > dayEnd) continue; // 미래 마감은 제외 (오늘 + 지난 것만)
    out.push({
      summary: ev.summary || '(제목 없음)',
      due: dueDate,
      overdue: dueDate < dayStart,
      allDay: isAllDay(ev) || !!(ev.due && ev.due.dateOnly),
    });
  }
  out.sort((a, b) => a.due - b.due);
  return out;
}

async function fetchTasks(url, now = new Date()) {
  const data = await ical.async.fromURL(url);
  return extractTasks(data, now);
}

async function parseTasks(icsString, now = new Date()) {
  const data = await ical.async.parseICS(icsString);
  return extractTasks(data, now);
}

module.exports = { expandToday, dueAlerts, keyOf, fetchData, fetchTodayEvents, parseTodayEvents, extractTasks, fetchTasks, parseTasks };
