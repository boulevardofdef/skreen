/**
 * Skreen — Google Apps Script backend.
 *
 * Runs under your own Google account and hands the wall display a small JSON
 * feed of your calendar, a Google Tasks list, and (optionally) photos from a
 * Google Drive folder. Because it runs as you, there are no OAuth tokens on the
 * tablet that expire overnight.
 *
 * Setup: open the Skreen app → ⚙ Settings → Setup guide.
 */

// ─── Settings ────────────────────────────────────────────────────────────────

const CONFIG = {
  // Any long random phrase. The dashboard must send the same value.
  SECRET: 'change-me-to-something-long-and-random',

  // Calendars to show. Leave empty to show every calendar that is checked
  // ("visible") in the Google Calendar sidebar.
  CALENDAR_IDS: [],

  // Calendar names to hide even if they're visible (e.g. work or sports).
  EXCLUDE_CALENDAR_NAMES: [],

  // How many days ahead to load.
  DAYS_AHEAD: 7,

  // Google Tasks list used as the household to-do list. Created if missing.
  TASK_LIST_NAME: 'Household',

  // Optional: ID of a Google Drive folder full of photos for the background.
  // It's the last part of the folder's URL: drive.google.com/drive/folders/<ID>
  PHOTOS_FOLDER_ID: '',
};

// ─── Web endpoint ────────────────────────────────────────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.key !== CONFIG.SECRET) return json_({ error: 'unauthorized' });
    switch (p.action) {
      case 'dashboard':
        return json_({ events: getEvents_(), tasks: getTasks_(), photos: !!CONFIG.PHOTOS_FOLDER_ID });
      case 'addTask':
        return json_({ task: addTask_(String(p.title || '').trim()) });
      case 'completeTask':
        return json_({ ok: true, result: setTaskDone_(p.id, true) });
      case 'uncompleteTask':
        return json_({ ok: true, result: setTaskDone_(p.id, false) });
      case 'photo':
        return json_(getPhoto_());
      default:
        return json_({ ok: true, hello: 'Skreen backend is running.' });
    }
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function getEvents_() {
  const tz = CalendarApp.getDefaultCalendar().getTimeZone();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + CONFIG.DAYS_AHEAD * 86400000);

  let calendars = CONFIG.CALENDAR_IDS.length
    ? CONFIG.CALENDAR_IDS.map((id) => CalendarApp.getCalendarById(id)).filter(Boolean)
    : CalendarApp.getAllCalendars().filter((c) => c.isSelected() && !c.isHidden());
  const excluded = CONFIG.EXCLUDE_CALENDAR_NAMES.map((n) => n.toLowerCase());
  calendars = calendars.filter((c) => excluded.indexOf(c.getName().toLowerCase()) === -1);

  const out = [];
  const seen = {};
  calendars.forEach((cal) => {
    cal.getEvents(start, end).forEach((ev) => {
      // Skip invitations you've declined.
      try {
        if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return;
      } catch (_) {}

      const allDay = ev.isAllDayEvent();
      const item = {
        id: ev.getId(),
        title: ev.getTitle() || '(No title)',
        location: ev.getLocation() || '',
        calendar: cal.getName(),
        color: cal.getColor(),
        allDay: allDay,
      };
      if (allDay) {
        item.start = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
        item.end = Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd'); // exclusive
      } else {
        item.start = ev.getStartTime().toISOString();
        item.end = ev.getEndTime().toISOString();
      }
      // The same event can appear on several shared calendars.
      const dedupeKey = item.id + '|' + item.start;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = true;
      out.push(item);
    });
  });
  return out;
}

// ─── Tasks (requires the "Google Tasks API" service — see the Setup guide) ───

function taskListId_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('taskListId');
  if (cached) return cached;

  let id = null;
  let pageToken;
  do {
    const res = Tasks.Tasklists.list({ maxResults: 100, pageToken: pageToken });
    (res.items || []).forEach((l) => {
      if (!id && l.title.toLowerCase() === CONFIG.TASK_LIST_NAME.toLowerCase()) id = l.id;
    });
    pageToken = res.nextPageToken;
  } while (!id && pageToken);

  if (!id) id = Tasks.Tasklists.insert({ title: CONFIG.TASK_LIST_NAME }).id;
  cache.put('taskListId', id, 21600);
  return id;
}

function getTasks_() {
  const listId = taskListId_();
  const out = [];

  // Open items, in the order they appear in Google Tasks.
  let pageToken;
  do {
    const res = Tasks.Tasks.list(listId, { showCompleted: false, showHidden: false, maxResults: 100, pageToken: pageToken });
    (res.items || []).forEach((t) => {
      if (t.title && !t.parent) out.push({ id: t.id, title: t.title, position: t.position, done: false });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  out.sort((a, b) => (a.position < b.position ? -1 : 1));

  // Items checked off in the last 24 hours stay on the wall (struck through), then drop off.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const done = [];
  pageToken = undefined;
  do {
    const res = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, completedMin: since, maxResults: 100, pageToken: pageToken });
    (res.items || []).forEach((t) => {
      if (t.title && !t.parent && t.status === 'completed' && t.completed) {
        done.push({ id: t.id, title: t.title, done: true, completed: t.completed });
      }
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  done.sort((a, b) => (a.completed < b.completed ? 1 : -1)); // newest first

  return out.concat(done);
}

function addTask_(title) {
  if (!title) throw new Error('Empty title');
  const t = Tasks.Tasks.insert({ title: title.slice(0, 500) }, taskListId_());
  return { id: t.id, title: t.title, position: t.position, done: false };
}

function setTaskDone_(id, done) {
  if (!id) throw new Error('Missing id');
  Tasks.Tasks.patch(done ? { status: 'completed' } : { status: 'needsAction', completed: null }, taskListId_(), id);
  return done ? { completed: new Date().toISOString() } : true;
}

// ─── Photos from a Drive folder ──────────────────────────────────────────────

function photoIds_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('photoIds');
  if (cached) return JSON.parse(cached);

  const ids = [];
  const files = DriveApp.getFolderById(CONFIG.PHOTOS_FOLDER_ID).getFiles();
  while (files.hasNext() && ids.length < 2000) {
    const f = files.next();
    if (/^image\//.test(f.getMimeType())) ids.push(f.getId());
  }
  try { cache.put('photoIds', JSON.stringify(ids), 3600); } catch (_) {}
  return ids;
}

function getPhoto_() {
  if (!CONFIG.PHOTOS_FOLDER_ID) return { error: 'no photos folder configured' };
  const ids = photoIds_();
  if (!ids.length) return { error: 'folder has no images' };
  const id = ids[Math.floor(Math.random() * ids.length)];
  const token = ScriptApp.getOAuthToken();

  // Ask Drive for a screen-sized rendition instead of the full original.
  const meta = JSON.parse(UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink',
    { headers: { Authorization: 'Bearer ' + token } }
  ).getContentText());

  let blob;
  if (meta.thumbnailLink) {
    const url = meta.thumbnailLink.replace(/=s\d+$/, '=s1920');
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) blob = res.getBlob();
  }
  if (!blob) blob = DriveApp.getFileById(id).getBlob();

  return { id: id, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

// Run this once from the editor to grant permissions and check everything works.
function testSetup() {
  Logger.log('Events: ' + JSON.stringify(getEvents_().slice(0, 5), null, 2));
  Logger.log('Tasks: ' + JSON.stringify(getTasks_(), null, 2));
  if (CONFIG.PHOTOS_FOLDER_ID) Logger.log('Photos found: ' + photoIds_().length);
}
