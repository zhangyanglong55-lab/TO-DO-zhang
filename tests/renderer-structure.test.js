const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');


test('todo P0 is a two-tab work board rather than a renameable 课程 header', () => {
  const p0 = html.match(/<section class="quadrant tile work-board"[\s\S]*?<section class="quadrant tile" data-priority="P1">/)?.[0] || '';
  assert.match(p0, /data-work-bucket="daily"/);
  assert.match(p0, /data-work-bucket="weekly"/);
  assert.doesNotMatch(p0, /今天还没有日报/);
  assert.doesNotMatch(p0, /本周还没有周报/);
  assert.doesNotMatch(p0, /class="todo-category-name" data-category="P0"/);
  assert.match(appJs, /TODO_CATEGORY_DEFAULTS = \{[\s\S]*P0: '每日工作'/);
  assert.match(workspaceJs, /function startLinkInbox\(/);
});

test('empty work report is hidden so the todo list can use the space', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.work-report\.is-empty[\s\S]*?display:\s*none/);
  assert.match(css, /\.work-board \.todo-list \{[\s\S]*?flex:\s*1 1 0/);
  assert.match(appJs, /reportEl\.hidden = true/);
});



test('mirror tile can be dragged even though the stage is a button', () => {
  const homeMirror = html.match(/<section class="tile home-mirror"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeMirror, /id="mirror-stage"[\s\S]*data-home-drag-surface/);
  assert.match(appJs, /button:not\(\[data-home-drag-surface\]\)/);
});

test('todo tab work board fills the card and pomodoro resize handle stays on top', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /#tab-todo \.todo-list,[\s\S]*?flex:\s*1 1 0/);
  assert.match(css, /#tab-todo \.work-board \{[\s\S]*?grid-row:\s*1 \/ -1/);
  assert.match(css, /\.home-pomodoro > \.widget-size-control[\s\S]*?top:\s*8px/);
  assert.match(css, /\.home-pomodoro > \.widget-resize-handle[\s\S]*?z-index:\s*30/);
});

test('homepage widgets can be resized from all edges and locked in place', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(html, /id="home-layout-lock"/);
  assert.match(appJs, /HOME_LAYOUT_LOCK_KEY/);
  assert.match(appJs, /dataset\.widgetResizeEdge/);
  assert.match(appJs, /resizeHomeWidgetFromEdge/);
  assert.match(appJs, /\['n', '向上调整高度'\]/);
  assert.match(css, /\.widget-resize-handle-n \{/);
  assert.match(css, /\.widget-resize-handle-w \{/);
  assert.match(css, /\.home-bento\[data-layout-locked='true'\]/);
});

test('recorder controls stay in flow so mini tiles do not clip their labels', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.home-recorder \.recorder-controls,[\s\S]*?position:\s*static !important/);
  assert.match(css, /data-layout-variant='mini'\] #home-open-recordings-folder/);
});

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home scratch note can save and start a new note', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.match(homeNote, /id="note-new-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
  assert.match(appJs, /function startFreshHomeNote\(/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(html, /id="recording-open-folder"/);
  assert.match(html, /id="home-open-recordings-folder"/);
  assert.match(workspaceJs, /openRecordingsFolder/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('quick recording offers a choice between audio and screen capture', () => {
  assert.match(html, /id="home-recorder-mode"/);
  assert.match(html, /id="recording-tab-mode"/);
  assert.match(html, /data-record-mode="audio"/);
  assert.match(html, /data-record-mode="screen"/);
  assert.match(workspaceJs, /function setRecordingMode\(/);
  assert.match(workspaceJs, /acquireScreenStream/);
  assert.match(workspaceJs, /ensureScreenRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.match(appJs, /stopMirror\(\)/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'recorder', 'windows', 'mirror', 'note', 'commands',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});
