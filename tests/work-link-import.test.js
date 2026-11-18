const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTodoImportCategory,
  mergeTodoImport,
  localDateKey,
  isoWeekKey,
  isValidDateKey,
  normalizeIsoWeekKey,
  resolveWorkPeriod,
  matchesWorkTab,
  filterTodosForWorkTab,
  parseWorkInboxPayload,
  mergeLinkImport,
  normalizeHttpUrl,
} = require('../renderer/domain');
const {
  buildWorkInboxReport,
  buildLinkInboxReport,
} = require('../main-services');

const NAMES = { P0: 'Teacher', P1: 'Writer', P2: 'Coder', P3: 'Me.' };
const NOW = Date.UTC(2026, 10, 12, 4, 0, 0); // 2026-11-12 12:00 +08

test('localDateKey and isoWeekKey use the local calendar with Monday-start ISO weeks', () => {
  assert.equal(localDateKey(new Date(2026, 10, 12, 9, 0, 0)), '2026-11-12');
  assert.equal(isoWeekKey(new Date(2026, 10, 12, 9, 0, 0)), '2026-W46');
  // 2026-01-01 is Thursday, still week 1; previous Monday is 2025-12-29 → 2026-W01
  assert.equal(isoWeekKey(new Date(2026, 0, 1, 12, 0, 0)), '2026-W01');
  assert.equal(isoWeekKey(new Date(2025, 11, 29, 12, 0, 0)), '2026-W01');
  assert.equal(isoWeekKey(new Date(2026, 11, 31, 12, 0, 0)), '2026-W53');
  assert.equal(isValidDateKey('2026-11-12'), true);
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(normalizeIsoWeekKey('2026-W46'), '2026-W46');
  assert.equal(normalizeIsoWeekKey('2026-w01'), '2026-W01');
  assert.equal(normalizeIsoWeekKey('2026-W99'), null);
  assert.equal(normalizeIsoWeekKey('2026-W53'), '2026-W53'); // 2026 has week 53
  assert.equal(normalizeIsoWeekKey('2025-W53'), null); // 2025 does not
});

test('resolveTodoImportCategory maps work aliases to P0 daily/weekly', () => {
  assert.deepEqual(resolveTodoImportCategory('每日工作', NAMES), { category: 'P0', workBucket: 'daily' });
  assert.deepEqual(resolveTodoImportCategory('daily', NAMES), { category: 'P0', workBucket: 'daily' });
  assert.deepEqual(resolveTodoImportCategory('课程', NAMES), { category: 'P0', workBucket: 'daily' });
  assert.deepEqual(resolveTodoImportCategory('P0', NAMES), { category: 'P0' });
  assert.deepEqual(resolveTodoImportCategory('每周工作', NAMES), { category: 'P0', workBucket: 'weekly' });
  assert.deepEqual(resolveTodoImportCategory('weekly', NAMES), { category: 'P0', workBucket: 'weekly' });
  assert.deepEqual(resolveTodoImportCategory('日报', NAMES), { category: 'P0', workBucket: 'daily' });
  assert.deepEqual(resolveTodoImportCategory('周报', NAMES), { category: 'P0', workBucket: 'weekly' });
  // Internal keys still win over a display name that happens to be an alias.
  assert.deepEqual(resolveTodoImportCategory('P1', { ...NAMES, P1: '每日工作' }), { category: 'P1' });
  // Alias wins over a custom display name on another board.
  assert.deepEqual(resolveTodoImportCategory('每日工作', { ...NAMES, P1: '每日工作' }), { category: 'P0', workBucket: 'daily' });
});

test('mergeTodoImport tags P0 work todos and treats 课程/P0 as daily', () => {
  const result = mergeTodoImport({ P0: [], P1: [], P2: [], P3: [] }, {
    todos: [
      { text: '写日报待办', category: '每日工作', id: 'd1', deadline: '2026-11-12T18:00:00+08:00' },
      { text: '写周报待办', category: '每周工作', id: 'w1', deadline: '2026-11-14' },
      { text: '旧课程别名', category: '课程', id: 'c1', deadline: '2026-11-12' },
      { text: 'P0 默认当日', category: 'P0', id: 'p0-1', deadline: '2026-11-12T23:30:00+08:00' },
      { text: '显式周期', category: 'weekly', id: 'w2', workPeriod: '2026-W46' },
    ],
  }, { categoryNames: NAMES, now: NOW, sourceId: 'work1' });

  assert.equal(result.skipped.length, 0);
  assert.deepEqual(result.data.P0.map((todo) => [todo.id, todo.workBucket, todo.workPeriod]), [
    ['d1', 'daily', localDateKey(new Date(NOW))],
    ['w1', 'weekly', isoWeekKey(new Date(NOW))],
    ['c1', 'daily', localDateKey(new Date(NOW))],
    ['p0-1', 'daily', localDateKey(new Date(NOW))],
    ['w2', 'weekly', '2026-W46'],
  ]);
});

test('legacy and period filters keep untagged P0 items on the daily tab', () => {
  const today = '2026-11-12';
  const week = '2026-W46';
  const items = [
    { id: 'legacy', text: '旧课程' },
    { id: 'daily-today', text: '今日', workBucket: 'daily', workPeriod: today },
    { id: 'daily-empty', text: '未标日期', workBucket: 'daily', workPeriod: '' },
    { id: 'daily-old', text: '昨天', workBucket: 'daily', workPeriod: '2026-11-11' },
    { id: 'weekly-now', text: '本周', workBucket: 'weekly', workPeriod: week },
    { id: 'weekly-empty', text: '未标周', workBucket: 'weekly', workPeriod: '' },
    { id: 'weekly-old', text: '上周', workBucket: 'weekly', workPeriod: '2026-W45' },
  ];
  assert.deepEqual(filterTodosForWorkTab(items, 'daily', today).map((item) => item.id), [
    'legacy', 'daily-today', 'daily-empty',
  ]);
  assert.deepEqual(filterTodosForWorkTab(items, 'weekly', week).map((item) => item.id), [
    'weekly-now', 'weekly-empty',
  ]);
  assert.equal(matchesWorkTab(items[0], 'weekly', week), false);
});

test('parseWorkInboxPayload accepts aliases, derives ISO week, and replaces the same period', () => {
  const first = parseWorkInboxPayload({
    kind: '日报',
    date: '2026-11-12',
    title: '11月12日工作日报',
    body: '第一版日报',
  });
  assert.deepEqual(first.reports, [{
    kind: 'daily',
    title: '11月12日工作日报',
    body: '第一版日报',
    period: '2026-11-12',
    date: '2026-11-12',
  }]);

  const weekFromDate = parseWorkInboxPayload({
    kind: '周报',
    date: '2026-11-12',
    body: '由日期换算的周报',
  });
  assert.equal(weekFromDate.reports[0].kind, 'weekly');
  assert.equal(weekFromDate.reports[0].week, '2026-W46');

  const weekFromStart = parseWorkInboxPayload({
    kind: 'weekly',
    weekStart: '2026-11-09',
    body: '由周起始换算',
  });
  assert.equal(weekFromStart.reports[0].week, '2026-W46');

  const replaced = parseWorkInboxPayload({
    reports: [
      { kind: 'daily', date: '2026-11-12', body: '旧正文' },
      { kind: 'daily', date: '2026-11-12', body: '新正文', title: '覆盖' },
      { kind: 'weekly', week: '2026-W46', body: '本周' },
    ],
  });
  assert.equal(replaced.reports.length, 2);
  assert.equal(replaced.reports.find((row) => row.kind === 'daily').body, '新正文');
  assert.equal(replaced.reports.find((row) => row.kind === 'daily').title, '覆盖');
  assert.equal(replaced.warnings.some((row) => /覆盖/.test(row.message)), true);

  const warned = parseWorkInboxPayload({
    kind: 'daily',
    date: '2026-11-12',
    body: '日报',
    todos: [{ text: '不该从这里进', category: 'P0' }],
  });
  assert.equal(warned.reports.length, 1);
  assert.match(warned.warnings[0].message, /todo-inbox/);

  const skipped = parseWorkInboxPayload({ kind: 'daily', date: '2026-11-12' });
  assert.equal(skipped.reports.length, 0);
  assert.match(skipped.skipped[0].reason, /缺少 body/);

  const rejected = parseWorkInboxPayload({ hello: true });
  assert.match(rejected.error, /reports/);
});

test('mergeLinkImport classifies, dedups by normalized URL, and rejects non-public URLs', () => {
  const existing = [{
    id: 'group-dev',
    name: '开发',
    collapsed: false,
    links: [{ id: 'keep-1', url: 'https://github.com/openai', title: 'OpenAI', icon: '', createdAt: 1 }],
  }];
  const result = mergeLinkImport(existing, {
    links: [
      { url: 'https://www.feishu.cn/', title: '飞书文档', category: '工作' },
      { url: 'https://github.com/openai', title: '重复仓库' },
      { url: 'http://localhost:3000', title: '本机' },
      { url: 'https://192.168.1.8/admin', title: '内网' },
      { url: 'ftp://example.com/a', title: '非 http' },
      { url: 'https://www.bilibili.com/video/1' },
      { url: 'https://example.com/docs', title: '指定分组', category: '工作' },
    ],
  }, { now: NOW, sourceId: 'link1' });

  assert.equal(result.error, undefined);
  assert.equal(result.imported.length, 3);
  assert.deepEqual(result.imported.map((row) => [row.link.url, row.category, row.inspectTitle]), [
    ['https://www.feishu.cn/', '工作', false],
    [normalizeHttpUrl('https://www.bilibili.com/video/1'), '影音', true],
    ['https://example.com/docs', '工作', false],
  ]);
  assert.equal(result.groups.find((group) => group.name === '工作').links.length, 2);
  assert.equal(result.groups.find((group) => group.name === '影音').links[0].title, '未命名');
  assert.equal(existing[0].links.length, 1, 'existing groups are not mutated');
  const skippedReasons = result.skipped.map((row) => row.reason).join('\n');
  assert.match(skippedReasons, /已收藏/);
  assert.match(skippedReasons, /公开的 http/);
  assert.equal(result.skipped.length, 4);

  const replay = mergeLinkImport(result.groups, {
    links: [{ url: 'https://www.feishu.cn/', title: '再放一次' }],
  }, { now: NOW + 1, sourceId: 'link2' });

  assert.equal(replay.imported.length, 0);
  assert.match(replay.skipped[0].reason, /已收藏/);
});

test('mergeLinkImport keeps an optional summary next to the link', () => {
  const result = mergeLinkImport([], {
    links: [
      {
        url: 'https://mp.weixin.qq.com/s/FOgMWOGhRqUzX8pyBTuZLQ',
        title: 'AI以88:12赢下250名三甲医生',
        category: '阅读',
        summary: '  未来医生 MedGPT 对250名三甲医生盲测以88:12取胜。  ',
      },
      { url: 'https://example.com/plain', title: '无摘要' },
      { url: 'https://example.com/bad', title: '坏摘要', summary: 12 },
    ],
  }, { now: 1, sourceId: 'sum1' });
  const kept = result.imported.find((row) => row.link.url.includes('mp.weixin.qq.com'));
  assert.equal(kept.category, '阅读');
  assert.equal(kept.link.summary, '未来医生 MedGPT 对250名三甲医生盲测以88:12取胜。');
  const plain = result.imported.find((row) => row.link.url === 'https://example.com/plain');
  assert.equal(plain.link.summary, undefined);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /summary 必须是字符串/);
});

test('buildWorkInboxReport and buildLinkInboxReport summarize status', () => {
  const processedAt = Date.UTC(2026, 10, 12, 8, 0);
  const work = buildWorkInboxReport({
    fileName: 'daily.json',
    processedAt,
    result: {
      imported: [{ index: 0, kind: 'daily', period: '2026-11-12', title: '日报', extra: 'drop' }],
      skipped: [],
      warnings: [{ message: '工作收件箱不导入待办，请把待办 JSON 放到 todo-inbox/' }],
    },
  });
  assert.equal(work.status, 'imported');
  assert.deepEqual(work.imported, [{ index: 0, kind: 'daily', period: '2026-11-12', title: '日报' }]);
  assert.equal(work.warnings.length, 1);

  const links = buildLinkInboxReport({
    fileName: 'links.json',
    processedAt,
    result: {
      imported: [{ index: 0, id: 'a', url: 'https://example.com/', title: 'Example', category: '其他' }],
      skipped: [{ index: 1, reason: 'url 必须是公开的 http/https 地址（不支持本机或内网）' }],
    },
  });
  assert.equal(links.status, 'partial');
  assert.equal(links.imported[0].url, 'https://example.com/');
});

test('resolveWorkPeriod infers from deadline or now', () => {
  assert.deepEqual(
    resolveWorkPeriod(undefined, 'daily', '', NOW),
    { value: localDateKey(new Date(NOW)) }
  );
  assert.deepEqual(resolveWorkPeriod('2026-W46', 'weekly', '', NOW), { value: '2026-W46' });
  assert.deepEqual(resolveWorkPeriod('2026-11-12', 'weekly', '', NOW), { value: '2026-W46' });
  assert.match(resolveWorkPeriod('not-a-date', 'daily', '', NOW).error, /YYYY-MM-DD/);
});
