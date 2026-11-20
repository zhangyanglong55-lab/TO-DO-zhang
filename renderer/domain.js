(function exposeNotchDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotchDomain() {
  const CATEGORY_RULES = [
    ['开发', /github|gitlab|gitee|stackoverflow|developer|docs\.|npmjs|vercel|cloudflare|code|openai|anthropic/i],
    ['工作', /feishu|larksuite|notion|slack|trello|asana|figma|miro|office|docs\.google/i],
    ['学习', /wikipedia|coursera|udemy|edx|medium|juejin|zhihu|yuque|book|learn/i],
    ['影音', /bilibili|youtube|youku|iqiyi|netflix|spotify|music|video/i],
    ['社交', /weibo|twitter|x\.com|facebook|instagram|reddit|discord|wechat/i],
    ['购物', /taobao|tmall|jd\.com|amazon|shop|mall/i],
  ];
  const NESTED_PUBLIC_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'com.cn', 'net.cn', 'org.cn', 'com.au', 'net.au',
    'co.jp', 'co.kr', 'co.nz', 'github.io', 'gitlab.io', 'vercel.app', 'pages.dev',
    'netlify.app', 'notion.site',
  ]);

  function isLocalHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return true;
    }
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }

  function normalizeHttpUrl(value) {
    const input = String(value || '').trim();
    if (!input) return null;
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || isLocalHostname(url.hostname)) return null;
      url.username = '';
      url.password = '';
      return url.toString();
    } catch (error) {
      return null;
    }
  }

  function classifyLink(url, title) {
    const haystack = `${url || ''} ${title || ''}`;
    const matched = CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack));
    return matched ? matched[0] : '其他';
  }

  function addLinkToGroups(groups, link, category) {
    const source = Array.isArray(groups) ? groups : [];
    const groupName = String(category || '').trim() || '其他';
    const index = source.findIndex((group) => group && group.name === groupName);
    if (index >= 0) {
      return source.map((group, groupIndex) => groupIndex === index
        ? { ...group, links: [...(Array.isArray(group.links) ? group.links : []), link] }
        : group);
    }
    return [...source, {
      id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: groupName,
      collapsed: false,
      links: [link],
    }];
  }

  function linkHostname(value) {
    try {
      return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  function relatedHostnames(left, right) {
    const siteRoot = (hostname) => {
      const parts = String(hostname || '').split('.').filter(Boolean);
      if (parts.length < 2) return parts[0] || '';
      const suffix = parts.slice(-2).join('.');
      return NESTED_PUBLIC_SUFFIXES.has(suffix) && parts.length > 2
        ? parts.slice(-3).join('.')
        : suffix;
    };
    return Boolean(left && right && (
      left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
      || siteRoot(left) === siteRoot(right)
    ));
  }

  function preferredLinkGroupId(groups, url) {
    const hostname = linkHostname(url);
    if (!hostname) return '';
    const group = (Array.isArray(groups) ? groups : []).find((item) => (
      item && Array.isArray(item.links) && item.links.some((link) => (
        relatedHostnames(hostname, linkHostname(link && link.url))
      ))
    ));
    return group ? String(group.id || '') : '';
  }

  function cloneLinkGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map((group) => ({
      ...group,
      links: [...(Array.isArray(group.links) ? group.links : [])],
    }));
  }

  // 把链接放到目标分组的指定位置。targetIndex 为 null 时追加到末尾。
  // 组内调顺序和跨组搬运走的是同一条路径，区别只在 targetGroupId 是否等于原分组。
  // targetIndex 按「移动前」目标分组的下标来算，调用方直接用界面上看到的行序即可。
  function moveLinkToPosition(groups, linkId, targetGroupId, targetIndex = null) {
    const source = Array.isArray(groups) ? groups : [];
    const id = String(linkId || '');
    const targetId = String(targetGroupId || '');
    let sourceGroupId = '';
    source.some((group) => {
      const found = group && Array.isArray(group.links)
        ? group.links.find((link) => link && String(link.id) === id)
        : null;
      if (!found) return false;
      sourceGroupId = String(group.id || '');
      return true;
    });
    if (!sourceGroupId || !targetId
      || !source.some((group) => group && String(group.id) === targetId)) {
      return cloneLinkGroups(source);
    }

    const next = cloneLinkGroups(source);
    const from = next.find((group) => String(group.id) === sourceGroupId);
    const fromIndex = from.links.findIndex((link) => String(link && link.id) === id);
    const [movingLink] = from.links.splice(fromIndex, 1);
    const target = next.find((group) => String(group.id) === targetId);

    let insertAt = target.links.length;
    if (targetIndex !== null && Number.isFinite(Number(targetIndex))) {
      insertAt = Number(targetIndex);
      // 同组内先摘后插，落点在原位置之后时下标要减一，否则会多跳一格。
      if (sourceGroupId === targetId && insertAt > fromIndex) insertAt -= 1;
      insertAt = Math.max(0, Math.min(target.links.length, insertAt));
    }
    target.links.splice(insertAt, 0, movingLink);
    return next;
  }

  // 只负责「整条丢到目标分组末尾」，同组视为无操作（拖到折叠分组的标题上就是这个语义）。
  function moveLinkToGroup(groups, linkId, targetGroupId) {
    const source = Array.isArray(groups) ? groups : [];
    const id = String(linkId || '');
    const sourceGroup = source.find((group) => group && Array.isArray(group.links)
      && group.links.some((link) => link && String(link.id) === id));
    if (sourceGroup && String(sourceGroup.id) === String(targetGroupId || '')) {
      return cloneLinkGroups(source);
    }
    return moveLinkToPosition(groups, linkId, targetGroupId, null);
  }

  function renameGroup(groups, groupId, name) {
    const nextName = String(name || '').trim();
    return (Array.isArray(groups) ? groups : []).map((group) => (
      group && group.id === groupId && nextName ? { ...group, name: nextName } : group
    ));
  }

  function prependClipboardHistory(history, entry, maxEntries = 100) {
    const limit = Math.max(1, Math.floor(Number(maxEntries) || 100));
    const next = [entry, ...(Array.isArray(history) ? history : [])];
    return {
      history: next.slice(0, limit),
      evicted: next.slice(limit),
    };
  }

  function createCommand(text, id, createdAt) {
    const normalized = String(text || '').trim();
    if (!normalized) return null;
    return {
      id: String(id || `command-${Date.now().toString(36)}`),
      text: normalized,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    };
  }

  function createExclusiveAsyncTask(onPendingChange) {
    const notify = typeof onPendingChange === 'function' ? onPendingChange : () => {};
    let pending = null;
    return {
      run(task) {
        if (pending) return pending;
        if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
        let resolveWork;
        let rejectWork;
        const work = new Promise((resolve, reject) => {
          resolveWork = resolve;
          rejectWork = reject;
        });
        const tracked = work.finally(() => {
          if (pending !== tracked) return;
          pending = null;
          notify(false);
        });
        pending = tracked;
        notify(true);
        try {
          Promise.resolve(task()).then(resolveWork, rejectWork);
        } catch (error) {
          rejectWork(error);
        }
        return tracked;
      },
      isPending() {
        return pending !== null;
      },
    };
  }

  function createRecording(value) {
    if (!value || typeof value !== 'object') return null;
    const transcript = String(value.transcript || '').trim();
    const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const fallbackTitle = new Date(createdAt).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType : 'audio/webm';
    const kind = value.kind === 'screen' || value.kind === 'audio'
      ? value.kind
      : (String(mimeType).toLowerCase().startsWith('video/') ? 'screen' : 'audio');
    return {
      id: String(value.id || `recording-${Date.now().toString(36)}`),
      createdAt,
      durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)),
      transcript,
      audioPath: typeof value.audioPath === 'string' ? value.audioPath : '',
      mimeType,
      kind,
      title: String(value.title || fallbackTitle).trim(),
      category: String(value.category || '未分类').replace(/\s+/g, ' ').trim().slice(0, 24),
    };
  }

  function isScreenRecording(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.kind === 'screen' || value.kind === 'audio') return value.kind === 'screen';
    return String(value.mimeType || '').toLowerCase().startsWith('video/');
  }

  function removeRecordingState(recordings, recordingId, selection, selectedId) {
    const rows = Array.isArray(recordings) ? recordings : [];
    const id = String(recordingId || '');
    const index = rows.findIndex((recording) => recording && String(recording.id) === id);
    if (index < 0) {
      return {
        recordings: rows.slice(),
        selection: Array.isArray(selection) ? selection.slice() : [],
        selectedId: String(selectedId || ''),
      };
    }
    const nextRows = rows.filter((recording) => String(recording && recording.id) !== id);
    const currentSelectedId = String(selectedId || '');
    const nextSelectedId = currentSelectedId !== id && nextRows.some((recording) => String(recording.id) === currentSelectedId)
      ? currentSelectedId
      : String(nextRows[Math.min(index, nextRows.length - 1)]?.id || '');
    return {
      recordings: nextRows,
      selection: (Array.isArray(selection) ? selection : []).filter((selected) => String(selected) !== id),
      selectedId: nextSelectedId,
    };
  }

  function calculateRecordingDuration(value) {
    const startedAt = Number(value && value.startedAt) || 0;
    if (!startedAt) return 0;
    const pausedAt = Number(value && value.pausedAt) || 0;
    const now = Number(value && value.now) || Date.now();
    const end = value && value.status === 'paused' && pausedAt ? pausedAt : now;
    const pausedTotalMs = Math.max(0, Number(value && value.pausedTotalMs) || 0);
    return Math.max(0, Math.round(end - startedAt - pausedTotalMs));
  }

  function completionMatchesWindow(completion, windowInfo) {
    const project = String(completion && completion.project || '').trim().toLocaleLowerCase();
    const title = String(windowInfo && windowInfo.title || '').trim().toLocaleLowerCase();
    if (!project || !title) return false;
    return title.includes(project);
  }

  function deriveWindowDisplayName(item) {
    const appName = String(item && item.appName || '').replace(/\s+/g, ' ').trim() || '应用';
    const title = String(item && item.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return appName;

    const editorPattern = /(?:visual studio code|\bcode\b|cursor|vscodium|windsurf)/i;
    const titleLooksLikeEditor = /(?:—|-|\|)\s*(?:visual studio code|cursor|vscodium|windsurf)\s*$/i.test(title);
    const pieces = title
      .split(/\s+(?:—|–|\|)\s+/)
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (editorPattern.test(appName) || titleLooksLikeEditor) {
      const editorPieces = pieces.filter((piece) => !/^(?:visual studio code|cursor|vscodium|windsurf)$/i.test(piece));
      if (!editorPieces.length) return appName;
      if (editorPieces.length === 1) return editorPieces[0].slice(0, 44);
      return editorPieces[editorPieces.length - 1].slice(0, 44);
    }

    const appKey = appName.toLocaleLowerCase();
    if (pieces.length > 1 && pieces[pieces.length - 1].toLocaleLowerCase() === appKey) {
      return pieces.slice(0, -1).join(' — ').slice(0, 44) || appName;
    }
    return title.toLocaleLowerCase() === appKey ? appName : title.slice(0, 44);
  }

  function numberWindowLabels(items) {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    const totals = new Map();
    rows.forEach((item) => {
      const key = deriveWindowDisplayName(item).toLocaleLowerCase();
      if (key) totals.set(key, (totals.get(key) || 0) + 1);
    });
    const indexes = new Map();
    return rows.map((item) => {
      const label = deriveWindowDisplayName(item);
      const key = label.toLocaleLowerCase();
      const index = (indexes.get(key) || 0) + 1;
      indexes.set(key, index);
      return {
        ...item,
        displayName: (totals.get(key) || 0) > 1 ? `${label} · ${index}` : label,
      };
    });
  }

  function createTodo(text, deadline, id, createdAt) {
    const normalizedText = String(text || '').trim();
    const deadlineMs = Date.parse(String(deadline || '').trim());
    if (!normalizedText || !Number.isFinite(deadlineMs)) return null;
    return {
      id: String(id || `todo-${Date.now().toString(36)}`),
      text: normalizedText,
      done: false,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      deadline: new Date(deadlineMs).toISOString(),
      remindedAt: 0,
    };
  }

  function updateTodo(todo, text, deadline) {
    if (!todo || typeof todo !== 'object') return null;
    const normalized = createTodo(text, deadline, todo.id, todo.createdAt);
    if (!normalized) return null;
    return {
      ...todo,
      ...normalized,
      done: todo.done === true,
      remindedAt: Date.parse(String(todo.deadline || '')) === Date.parse(normalized.deadline)
        ? Math.max(0, Number(todo.remindedAt) || 0)
        : 0,
    };
  }

  function sortTodosForDisplay(items) {
    return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
      const doneDifference = Number(left && left.done === true) - Number(right && right.done === true);
      if (doneDifference) return doneDifference;
      const leftDeadline = Date.parse(String(left && left.deadline || ''));
      const rightDeadline = Date.parse(String(right && right.deadline || ''));
      const safeLeftDeadline = Number.isFinite(leftDeadline) ? leftDeadline : Number.POSITIVE_INFINITY;
      const safeRightDeadline = Number.isFinite(rightDeadline) ? rightDeadline : Number.POSITIVE_INFINITY;
      if (safeLeftDeadline !== safeRightDeadline) return safeLeftDeadline - safeRightDeadline;
      const leftCreatedAt = Number(left && left.createdAt);
      const rightCreatedAt = Number(right && right.createdAt);
      const safeLeftCreatedAt = Number.isFinite(leftCreatedAt) ? leftCreatedAt : Number.POSITIVE_INFINITY;
      const safeRightCreatedAt = Number.isFinite(rightCreatedAt) ? rightCreatedAt : Number.POSITIVE_INFINITY;
      if (safeLeftCreatedAt !== safeRightCreatedAt) return safeLeftCreatedAt - safeRightCreatedAt;
      return String(left && left.id || '').localeCompare(String(right && right.id || ''));
    });
  }

  function filterCredentials(items, query) {
    const rows = Array.isArray(items) ? items : [];
    const keyword = String(query || '').trim().toLocaleLowerCase();
    if (!keyword) return [...rows];
    return rows.filter((item) => (
      `${String(item && item.service || '')}\n${String(item && item.account || '')}`
        .toLocaleLowerCase()
        .includes(keyword)
    ));
  }

  function credentialRowAction(options = {}) {
    if (options.requestedAction === 'delete') {
      return { type: 'delete', label: '删除', ariaLabel: '删除密钥' };
    }
    if (options.copyField === 'account' || options.copyField === 'password') {
      return { type: 'copy', field: options.copyField };
    }
    if (options.rowBody && !options.shiftKey && !options.selected) return { type: 'edit' };
    return { type: 'select' };
  }

  function visiblePanelTabs(allTabs, features) {
    const tabs = Array.isArray(allTabs) ? allTabs : [];
    const state = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
    const visible = tabs.filter((name) => (
      name !== 'settings' && (name === 'home' || state[name] !== false)
    ));
    if (tabs.includes('settings')) visible.push('settings');
    return visible;
  }

  function resolveDefaultPanelTab(preferredTab, visibleTabs) {
    const tabs = Array.isArray(visibleTabs) ? visibleTabs : [];
    if (typeof preferredTab === 'string' && tabs.includes(preferredTab)) return preferredTab;
    if (tabs.includes('home')) return 'home';
    return tabs[0] || 'home';
  }

  function normalizeNoteArchive(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const id = String(item.id || '').trim();
        const content = item.content == null ? '' : String(item.content);
        if (!id) return null;
        const title = Array.from(String(item.title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
        const titleSource = ['model', 'user'].includes(item.titleSource) ? item.titleSource : '';
        const createdAt = Math.max(0, Number(item.createdAt) || Date.now());
        const updatedAt = Math.max(createdAt, Number(item.updatedAt) || createdAt);
        return { id, title, titleSource, content, createdAt, updatedAt };
      })
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function updateNoteInArchive(notes, noteId, content, updatedAt = Date.now()) {
    const id = String(noteId || '').trim();
    const timestamp = Math.max(0, Number(updatedAt) || Date.now());
    let found = false;
    const next = normalizeNoteArchive(notes).map((note) => {
      if (note.id !== id) return note;
      found = true;
      return {
        ...note,
        content: content == null ? '' : String(content),
        updatedAt: Math.max(note.createdAt, timestamp),
      };
    });
    return found ? normalizeNoteArchive(next) : next;
  }

  function filterNotes(notes, query) {
    const rows = Array.isArray(notes) ? notes : [];
    const keyword = String(query || '').trim().toLocaleLowerCase();
    if (!keyword) return rows.slice();
    return rows.filter((note) => (
      `${String(note && note.title || '')}\n${String(note && note.content || '')}`
        .toLocaleLowerCase()
        .includes(keyword)
    ));
  }

  function updateNoteTitle(notes, noteId, title, updatedAt = Date.now()) {
    const id = String(noteId || '').trim();
    const nextTitle = Array.from(String(title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
    const timestamp = Math.max(0, Number(updatedAt) || Date.now());
    let found = false;
    const next = normalizeNoteArchive(notes).map((note) => {
      if (note.id !== id) return note;
      found = true;
      return {
        ...note,
        title: nextTitle,
        titleSource: 'user',
        updatedAt: Math.max(note.createdAt, timestamp),
      };
    });
    return found ? normalizeNoteArchive(next) : next;
  }

  function applyGeneratedNoteTitle(notes, noteId, title, expectedContent) {
    const id = String(noteId || '').trim();
    const nextTitle = Array.from(String(title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
    if (!id || !nextTitle) return normalizeNoteArchive(notes);
    return normalizeNoteArchive(notes).map((note) => {
      if (
        note.id !== id
        || note.titleSource === 'user'
        || note.title
        || note.content !== String(expectedContent == null ? '' : expectedContent)
      ) return note;
      return { ...note, title: nextTitle, titleSource: 'model' };
    });
  }

  function apiCredentialStatuses(config) {
    const value = config && typeof config === 'object' ? config : {};
    const status = (configured, needsReentry) => {
      if (configured) return { label: '已安全保存', state: 'saved' };
      if (needsReentry) return { label: '需重新输入', state: 'warning' };
      return { label: '未配置', state: 'empty' };
    };
    return {
      transcription: status(Boolean(value.configured), Boolean(value.asrNeedsReentry)),
      llm: status(Boolean(value.llmConfigured), Boolean(value.llmNeedsReentry)),
    };
  }

  function settingsSummary(input = {}) {
    const appSettings = input.appSettings && typeof input.appSettings === 'object' ? input.appSettings : {};
    const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
    const statuses = apiCredentialStatuses(input.transcription);
    return {
      shortcut: String(appSettings.shortcut || 'Space'),
      defaultTab: String(appSettings.defaultTab || 'home'),
      autoLaunch: appSettings.autoLaunch === true,
      workspacePath: String(workspace.path || ''),
      workspaceLabel: workspace.portable ? '自定义文件夹' : '默认文件夹',
      transcription: statuses.transcription,
      llm: statuses.llm,
    };
  }

  function calendarDeadline(parts) {
    const year = Math.round(Number(parts && parts.year));
    const month = Math.round(Number(parts && parts.month));
    const day = Math.round(Number(parts && parts.day));
    const hour = Math.round(Number(parts && parts.hour));
    const minute = Math.round(Number(parts && parts.minute));
    if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 0 || month > 11
      || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const deadline = new Date(year, month, day, hour, minute, 0, 0);
    if (deadline.getFullYear() !== year || deadline.getMonth() !== month || deadline.getDate() !== day) return null;
    return deadline.toISOString();
  }

  function shiftCalendarMonth(value, offset) {
    const year = Math.round(Number(value && value.year));
    const month = Math.round(Number(value && value.month));
    const step = Math.round(Number(offset));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(step)) return null;
    const shifted = new Date(year, month + step, 1, 12, 0, 0, 0);
    return { year: shifted.getFullYear(), month: shifted.getMonth() };
  }

  function currentMonthDeadline(parts, now = new Date()) {
    const base = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(base.getTime())) return null;
    return calendarDeadline({
      ...parts,
      year: base.getFullYear(),
      month: base.getMonth(),
    });
  }

  function defaultTodoDeadline(now = new Date()) {
    const base = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (!Number.isFinite(base.getTime())) return null;
    const deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 30, 0, 0);
    return deadline.toISOString();
  }

  function todoTimeBattery(todo, now = Date.now()) {
    if (!todo || todo.done === true) return null;
    const createdAt = Number(todo.createdAt);
    const deadline = Date.parse(String(todo.deadline || ''));
    const current = Number(now);
    const total = deadline - createdAt;
    if (!Number.isFinite(current)) return null;
    if (!Number.isFinite(deadline) || !Number.isFinite(createdAt) || total <= 0) {
      return { percent: 0, tone: 'red', overdue: false, label: '待补充有效截止时间' };
    }
    // 逾期必须与「剩余 0%」分开：后者只是取整落到 0，前者已经欠账。
    // 逾期项的电量条改为整条填满 + 白色感叹号，不能再显示成一条空槽。
    const overdue = current >= deadline;
    const percent = Math.round(Math.max(0, Math.min(1, (deadline - current) / total)) * 100);
    const tone = percent >= 80 ? 'green' : percent >= 50 ? 'yellow' : percent > 30 ? 'orange' : 'red';
    return {
      percent,
      tone,
      overdue,
      label: overdue ? '已逾期' : `剩余 ${percent}%`,
    };
  }

  // ============ 待办外部导入（todo-inbox） ============
  // 外部脚本写入的文件只能追加新待办：已有条目原样保留，同一 id 只收一次。
  const TODO_IMPORT_CATEGORIES = ['P0', 'P1', 'P2', 'P3'];
  const TODO_IMPORT_TEXT_LIMIT = 80;
  const TODO_IMPORT_MAX_ITEMS = 200;
  const TODO_IMPORT_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
  const TODO_IMPORT_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
  const TODO_IMPORT_MIN_MS = Date.UTC(2000, 0, 1);
  const TODO_IMPORT_MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

  // 周期键按本机日历计算；周为 ISO 周（周一为周起始），格式 YYYY-Www。
  const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/i;
  const WORK_REPORT_BODY_LIMIT = 100000;
  const WORK_REPORT_TITLE_LIMIT = 120;
  const LINK_IMPORT_MAX_ITEMS = 200;
  const LINK_IMPORT_TITLE_LIMIT = 200;
  const LINK_IMPORT_CATEGORY_LIMIT = 40;
  const LINK_IMPORT_SUMMARY_LIMIT = 240;
  const WORK_CATEGORY_ALIASES = [
    ['课程', { category: 'P0', workBucket: 'daily' }],
    ['每日工作', { category: 'P0', workBucket: 'daily' }],
    ['daily', { category: 'P0', workBucket: 'daily' }],
    ['每日', { category: 'P0', workBucket: 'daily' }],
    ['日报', { category: 'P0', workBucket: 'daily' }],
    ['每周工作', { category: 'P0', workBucket: 'weekly' }],
    ['weekly', { category: 'P0', workBucket: 'weekly' }],
    ['每周', { category: 'P0', workBucket: 'weekly' }],
    ['周报', { category: 'P0', workBucket: 'weekly' }],
  ];

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(value.getTime())) return null;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  function isoWeekKey(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(value.getTime())) return null;
    const local = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const isoDay = (local.getDay() + 6) % 7 + 1;
    const thursday = new Date(local);
    thursday.setDate(local.getDate() - isoDay + 4);
    const weekYear = thursday.getFullYear();
    const jan4 = new Date(weekYear, 0, 4);
    const jan4IsoDay = (jan4.getDay() + 6) % 7 + 1;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - jan4IsoDay + 1);
    const week = 1 + Math.round((thursday.getTime() - week1Monday.getTime()) / 604800000);
    return `${weekYear}-W${pad2(week)}`;
  }

  function isValidDateKey(value) {
    const match = DATE_KEY_RE.exec(String(value || '').trim());
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate();
  }

  function dateKeyToLocalDate(dateKey) {
    const match = DATE_KEY_RE.exec(String(dateKey || '').trim());
    if (!match || !isValidDateKey(dateKey)) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }

  function normalizeIsoWeekKey(value) {
    const raw = String(value || '').trim().toUpperCase();
    const match = WEEK_KEY_RE.exec(raw);
    if (!match) return null;
    const weekYear = Number(match[1]);
    const weekNum = Number(match[2]);
    if (weekNum < 1 || weekNum > 53) return null;
    const jan4 = new Date(weekYear, 0, 4);
    const jan4IsoDay = (jan4.getDay() + 6) % 7 + 1;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - jan4IsoDay + 1);
    const monday = new Date(week1Monday);
    monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
    const thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);
    if (thursday.getFullYear() !== weekYear) return null;
    return `${weekYear}-W${pad2(weekNum)}`;
  }

  function normalizeWorkBucket(value) {
    const label = String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (['daily', '每日', '每日工作', '日报'].includes(label)) return 'daily';
    if (['weekly', '每周', '每周工作', '周报'].includes(label)) return 'weekly';
    return null;
  }

  function resolveWorkCategoryAlias(label) {
    const key = normalizeTodoImportLabel(label).toLocaleLowerCase();
    const found = WORK_CATEGORY_ALIASES.find(([name]) => name.toLocaleLowerCase() === key);
    return found ? { ...found[1] } : null;
  }

  function workPeriodFromInstant(ms, bucket) {
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return null;
    return bucket === 'weekly' ? isoWeekKey(date) : localDateKey(date);
  }

  function resolveWorkPeriod(value, bucket, deadlineIso, now) {
    if (value !== undefined && value !== null && value !== '') {
      const raw = String(value).trim();
      if (bucket === 'weekly') {
        const week = normalizeIsoWeekKey(raw) || (isValidDateKey(raw) ? isoWeekKey(dateKeyToLocalDate(raw)) : null);
        if (!week) return { error: 'workPeriod 必须是 ISO 周（如 2026-W46）或可换算的日期' };
        return { value: week };
      }
      if (!isValidDateKey(raw)) return { error: 'workPeriod 必须是 YYYY-MM-DD' };
      return { value: raw };
    }
    const fromDeadline = workPeriodFromInstant(Date.parse(String(deadlineIso || '')), bucket);
    if (fromDeadline) return { value: fromDeadline };
    const fromNow = workPeriodFromInstant(now, bucket);
    return fromNow ? { value: fromNow } : { error: '无法确定 workPeriod' };
  }

  function matchesWorkTab(item, bucket, periodKey) {
    const itemBucket = item && item.workBucket;
    const period = String(item && item.workPeriod || '').trim();
    if (bucket === 'daily') {
      if (itemBucket && itemBucket !== 'daily') return false;
      return !period || period === periodKey;
    }
    if (bucket === 'weekly') {
      if (itemBucket !== 'weekly') return false;
      return !period || period === periodKey;
    }
    return false;
  }

  function filterTodosForWorkTab(items, bucket, periodKey) {
    return (Array.isArray(items) ? items : []).filter((item) => matchesWorkTab(item, bucket, periodKey));
  }

  function normalizeWorkReportKind(value) {
    const label = String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (['daily', '每日', '日报', '每日工作'].includes(label)) return 'daily';
    if (['weekly', '每周', '周报', '每周工作'].includes(label)) return 'weekly';
    return null;
  }

  function parseWorkReportEntry(entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { index, error: '条目必须是对象' };
    }
    const reasons = [];
    const kind = normalizeWorkReportKind(entry.kind);
    if (!kind) reasons.push('kind 必须是 daily / weekly（也可用 日报、每日、周报、每周）');
    let period = null;
    if (kind === 'daily') {
      const date = String(entry.date || '').trim();
      if (!isValidDateKey(date)) reasons.push('日报必须提供有效的 date（YYYY-MM-DD）');
      else period = date;
    } else if (kind === 'weekly') {
      if (entry.week != null && entry.week !== '') {
        period = normalizeIsoWeekKey(entry.week);
        if (!period) reasons.push('week 必须是 ISO 周，如 2026-W46');
      } else {
        const seed = String(entry.weekStart || entry.date || '').trim();
        if (isValidDateKey(seed)) period = isoWeekKey(dateKeyToLocalDate(seed));
        else reasons.push('周报必须提供 week（YYYY-Www），或 date / weekStart（YYYY-MM-DD）');
      }
    }
    const bodyText = typeof entry.body === 'string' ? entry.body.replace(/^\uFEFF/, '').trim() : '';
    if (!bodyText) reasons.push(typeof entry.body === 'string' || entry.body == null ? '缺少 body' : 'body 必须是字符串');
    else if (bodyText.length > WORK_REPORT_BODY_LIMIT) reasons.push(`body 超过 ${WORK_REPORT_BODY_LIMIT} 个字符`);
    let title = '';
    if (entry.title != null && entry.title !== '') {
      if (typeof entry.title !== 'string') reasons.push('title 必须是字符串');
      else title = entry.title.replace(/\s+/g, ' ').trim().slice(0, WORK_REPORT_TITLE_LIMIT);
    }
    if (reasons.length) return { index, error: reasons.join('；') };
    const report = { kind, title, body: bodyText, period };
    if (kind === 'daily') report.date = period;
    else report.week = period;
    return { index, report };
  }

  // 工作报告按 kind+period 覆盖展示，不是追加列表。同一文件里后出现的同周期报告会覆盖先前的。
  function parseWorkInboxPayload(payload) {
    const result = { reports: [], skipped: [], warnings: [] };
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.todos) && payload.todos.length) {
      result.warnings.push({ message: '工作收件箱不导入待办，请把待办 JSON 放到 todo-inbox/' });
    }
    let entries;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.reports)) {
      entries = payload.reports;
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload) && (payload.kind != null || payload.body != null || payload.date != null || payload.week != null)) {
      entries = [payload];
    } else if (Array.isArray(payload)) {
      entries = payload;
    } else {
      result.error = '文件顶层必须是日报/周报对象，或包含 reports 数组的对象';
      return result;
    }
    const byKey = new Map();
    entries.forEach((entry, index) => {
      const parsed = parseWorkReportEntry(entry, index);
      if (parsed.error) {
        result.skipped.push({ index, reason: parsed.error });
        return;
      }
      const key = `${parsed.report.kind}:${parsed.report.period}`;
      if (byKey.has(key)) {
        result.warnings.push({ index, message: `同一文件中 ${parsed.report.kind} ${parsed.report.period} 出现多次，后者将覆盖前者` });
      }
      byKey.set(key, parsed.report);
    });
    result.reports = Array.from(byKey.values());
    return result;
  }

  function collectLinkUrls(groups) {
    const urls = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (Array.isArray(group && group.links) ? group.links : []).forEach((link) => {
        const url = normalizeHttpUrl(link && link.url);
        if (url) urls.add(url);
      });
    });
    return urls;
  }

  function collectLinkIds(groups) {
    const ids = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      (Array.isArray(group && group.links) ? group.links : []).forEach((link) => {
        if (link && link.id != null && link.id !== '') ids.add(String(link.id));
      });
    });
    return ids;
  }

  function mergeLinkImport(groups, payload, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : LINK_IMPORT_MAX_ITEMS;
    const sourceId = /^[A-Za-z0-9]{1,32}$/.test(String(options.sourceId || ''))
      ? String(options.sourceId)
      : now.toString(36);
    let nextGroups = cloneLinkGroups(groups);
    const result = { groups: nextGroups, imported: [], skipped: [], warnings: [] };
    const entries = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray(payload.links) ? payload.links : null;
    if (!entries) {
      result.error = '文件顶层必须是数组，或包含 links 数组的对象';
      return result;
    }
    const knownUrls = collectLinkUrls(nextGroups);
    const knownIds = collectLinkIds(nextGroups);

    entries.slice(0, maxItems).forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        result.skipped.push({ index, reason: '条目必须是对象' });
        return;
      }
      const reasons = [];
      if (entry.url === undefined || entry.url === null || entry.url === '') reasons.push('缺少 url');
      const url = typeof entry.url === 'string' ? normalizeHttpUrl(entry.url) : null;
      if (!reasons.includes('缺少 url') && !url) reasons.push('url 必须是公开的 http/https 地址（不支持本机或内网）');
      let title = '';
      if (entry.title != null && entry.title !== '') {
        if (typeof entry.title !== 'string') reasons.push('title 必须是字符串');
        else title = entry.title.replace(/\s+/g, ' ').trim().slice(0, LINK_IMPORT_TITLE_LIMIT);
      }
      let category = '';
      if (entry.category != null && entry.category !== '') {
        if (typeof entry.category !== 'string') reasons.push('category 必须是字符串');
        else category = entry.category.replace(/\s+/g, ' ').trim().slice(0, LINK_IMPORT_CATEGORY_LIMIT);
      }
      let summary = '';
      if (entry.summary != null && entry.summary !== '') {
        if (typeof entry.summary !== 'string') reasons.push('summary 必须是字符串');
        else summary = entry.summary.replace(/\s+/g, ' ').trim().slice(0, LINK_IMPORT_SUMMARY_LIMIT);
      }
      const hasId = entry.id !== undefined && entry.id !== null && entry.id !== '';
      const rawId = typeof entry.id === 'number' && Number.isInteger(entry.id) ? String(entry.id) : entry.id;
      if (hasId && (typeof rawId !== 'string' || !TODO_IMPORT_ID_RE.test(rawId))) {
        reasons.push('id 只能包含字母、数字和 . _ : -，长度 1–128');
      }
      const id = hasId ? String(rawId) : `import-link-${sourceId}-${index}`;
      const skippedBase = hasId && typeof rawId === 'string' ? { index, id: rawId.slice(0, 128) } : { index };
      if (reasons.length) {
        result.skipped.push({ ...skippedBase, reason: reasons.join('；') });
        return;
      }
      if (knownIds.has(id)) {
        result.skipped.push({ ...skippedBase, reason: `id「${id}」已存在，未重复添加` });
        return;
      }
      if (knownUrls.has(url)) {
        result.skipped.push({ ...skippedBase, reason: '该网址已收藏，未重复添加' });
        return;
      }
      knownIds.add(id);
      knownUrls.add(url);
      const link = { id, url, title: title || '未命名', icon: '', createdAt: now, ...(summary ? { summary } : {}) };
      const inspectTitle = !title;
      let groupName = category;
      if (!groupName) {
        const preferredId = preferredLinkGroupId(nextGroups, url);
        const preferred = nextGroups.find((group) => group && group.id === preferredId);
        if (preferred) {
          nextGroups = nextGroups.map((group) => (group.id === preferred.id
            ? { ...group, collapsed: false, links: [...(group.links || []), link] }
            : group));
          result.groups = nextGroups;
          result.imported.push({
            index,
            category: preferred.name,
            link,
            inspectTitle,
            lockedCategory: false,
          });
          return;
        }
        groupName = classifyLink(url, title);
      }
      nextGroups = addLinkToGroups(nextGroups, link, groupName);
      result.groups = nextGroups;
      result.imported.push({
        index,
        category: groupName,
        link,
        inspectTitle,
        lockedCategory: Boolean(category),
      });
    });
    if (entries.length > maxItems) {
      result.skipped.push({
        index: maxItems,
        reason: `单个文件最多导入 ${maxItems} 条，第 ${maxItems + 1}–${entries.length} 条未导入`,
      });
    }
    return result;
  }


  function normalizeTodoImportLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function resolveTodoImportCategory(value, categoryNames, categories = TODO_IMPORT_CATEGORIES) {
    if (typeof value !== 'string' || !normalizeTodoImportLabel(value)) return { error: '缺少 category' };
    const label = normalizeTodoImportLabel(value);
    // 内部键优先：即使某个分类被改名成「P1」，P1 仍指向内部键 P1。
    const byKey = categories.find((category) => category.toLowerCase() === label.toLowerCase());
    if (byKey) return { category: byKey };
    // 每日工作 / 每周工作 / 课程 等别名固定落到 P0，优先于用户自定义显示名。
    const alias = resolveWorkCategoryAlias(label);
    if (alias && categories.includes(alias.category)) return alias;
    const names = categoryNames && typeof categoryNames === 'object' ? categoryNames : {};
    const matches = categories.filter((category) => (
      normalizeTodoImportLabel(names[category]).toLocaleLowerCase() === label.toLocaleLowerCase()
    ));
    if (matches.length === 1) return { category: matches[0] };
    if (matches.length > 1) return { error: `category「${label}」同时匹配 ${matches.join('、')}，请改用 P0–P3` };
    const available = categories.map((category) => `${category}（${normalizeTodoImportLabel(names[category]) || category}）`);
    return { error: `未知 category「${label}」，可用：${available.join('、')}` };
  }

  function parseTodoImportDeadline(value, now = Date.now()) {
    if (value === undefined || value === null || value === '') {
      return { deadline: defaultTodoDeadline(new Date(now)), defaulted: true };
    }
    let ms;
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) return { error: 'deadline 毫秒时间戳必须是整数' };
      if (value > 0 && value < 1e11) return { error: 'deadline 看起来是秒级时间戳，请改用毫秒' };
      ms = value;
    } else if (typeof value === 'string') {
      const match = TODO_IMPORT_ISO_RE.exec(value.trim());
      if (!match) return { error: 'deadline 必须是 ISO 8601 字符串（如 2026-10-01T18:00:00+08:00）或毫秒时间戳' };
      const [, y, mo, d, h, mi, s, fraction, zone] = match;
      const year = Number(y);
      const month = Number(mo);
      const day = Number(d);
      // Date.parse 会把 2 月 30 日顺延到 3 月，这里按日历严格校验。
      if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
        return { error: `deadline 日期不存在：${y}-${mo}-${d}` };
      }
      if (h === undefined) {
        // 只写日期时与手动新建一致，落在当天 23:30（本机时区）。
        ms = new Date(year, month - 1, day, 23, 30, 0, 0).getTime();
      } else {
        const hour = Number(h);
        const minute = Number(mi);
        const second = Number(s || 0);
        const millis = Number(String(fraction || '0').padEnd(3, '0').slice(0, 3));
        if (hour > 23 || minute > 59 || second > 59) return { error: `deadline 时间不存在：${value.trim()}` };
        if (!zone) {
          ms = new Date(year, month - 1, day, hour, minute, second, millis).getTime();
        } else {
          let offsetMinutes = 0;
          if (zone.toUpperCase() !== 'Z') {
            const digits = zone.slice(1).replace(':', '');
            const offsetHours = Number(digits.slice(0, 2));
            const offsetRest = Number(digits.slice(2) || 0);
            if (offsetHours > 14 || offsetRest > 59) return { error: `deadline 时区偏移无效：${zone}` };
            offsetMinutes = (offsetHours * 60 + offsetRest) * (zone[0] === '-' ? -1 : 1);
          }
          ms = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60 * 1000;
        }
      }
    } else {
      return { error: 'deadline 必须是 ISO 8601 字符串或毫秒时间戳' };
    }
    if (!Number.isFinite(ms) || ms < TODO_IMPORT_MIN_MS || ms > TODO_IMPORT_MAX_MS) {
      return { error: 'deadline 超出可用范围（2000–9999 年）' };
    }
    return { deadline: new Date(ms).toISOString() };
  }

  function mergeTodoImport(data, payload, options = {}) {
    const categories = Array.isArray(options.categories) && options.categories.length
      ? options.categories
      : TODO_IMPORT_CATEGORIES;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0 ? options.maxItems : TODO_IMPORT_MAX_ITEMS;
    const sourceId = /^[A-Za-z0-9]{1,32}$/.test(String(options.sourceId || ''))
      ? String(options.sourceId)
      : now.toString(36);
    const existing = Object.fromEntries(categories.map((category) => [
      category,
      Array.isArray(data && data[category]) ? data[category] : [],
    ]));
    const result = {
      data: Object.fromEntries(categories.map((category) => [category, [...existing[category]]])),
      imported: [],
      skipped: [],
      warnings: [],
    };
    const entries = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray(payload.todos) ? payload.todos : null;
    if (!entries) {
      result.error = '文件顶层必须是数组，或包含 todos 数组的对象';
      return result;
    }
    const knownIds = new Set();
    categories.forEach((category) => existing[category].forEach((item) => {
      if (item && item.id != null) knownIds.add(String(item.id));
    }));

    entries.slice(0, maxItems).forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        result.skipped.push({ index, reason: '条目必须是对象' });
        return;
      }
      const reasons = [];
      const text = typeof entry.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim() : '';
      if (!text) reasons.push(typeof entry.text === 'string' || entry.text == null ? '缺少 text' : 'text 必须是字符串');
      else if (text.length > TODO_IMPORT_TEXT_LIMIT) reasons.push(`text 超过 ${TODO_IMPORT_TEXT_LIMIT} 个字符`);
      const category = resolveTodoImportCategory(entry.category, options.categoryNames, categories);
      if (category.error) reasons.push(category.error);
      const deadline = parseTodoImportDeadline(entry.deadline, now);
      if (deadline.error) reasons.push(deadline.error);
      const hasId = entry.id !== undefined && entry.id !== null && entry.id !== '';
      const rawId = typeof entry.id === 'number' && Number.isInteger(entry.id) ? String(entry.id) : entry.id;
      if (hasId && (typeof rawId !== 'string' || !TODO_IMPORT_ID_RE.test(rawId))) {
        reasons.push('id 只能包含字母、数字和 . _ : -，长度 1–128');
      }
      // 未写 id 时按「文件内容 + 序号」生成稳定 id：同一份文件重放也只会命中重复。
      const id = hasId ? String(rawId) : `import-${sourceId}-${index}`;
      const skippedBase = hasId && typeof rawId === 'string' ? { index, id: rawId.slice(0, 128) } : { index };
      if (reasons.length) {
        result.skipped.push({ ...skippedBase, reason: reasons.join('；') });
        return;
      }
      if (knownIds.has(id)) {
        result.skipped.push({ ...skippedBase, reason: `id「${id}」已存在，未重复添加` });
        return;
      }
      knownIds.add(id);
      const todo = { id, text, done: false, createdAt: now, deadline: deadline.deadline, remindedAt: 0 };
      if (category.category === 'P0') {
        const bucket = normalizeWorkBucket(entry.workBucket) || category.workBucket || 'daily';
        const period = resolveWorkPeriod(entry.workPeriod, bucket, '', now);
        if (period.error) {
          knownIds.delete(id);
          result.skipped.push({ ...skippedBase, reason: period.error });
          return;
        }
        todo.workBucket = bucket;
        todo.workPeriod = period.value;
      }
      if (Date.parse(todo.deadline) <= now) {
        result.warnings.push({ index, id, message: deadline.defaulted ? '未写 deadline，默认的当天 23:30 已过' : 'deadline 早于导入时间' });
      }
      result.data[category.category].push(todo);
      result.imported.push({ index, category: category.category, todo });
    });
    if (entries.length > maxItems) {
      result.skipped.push({
        index: maxItems,
        reason: `单个文件最多导入 ${maxItems} 条，第 ${maxItems + 1}–${entries.length} 条未导入`,
      });
    }
    return result;
  }

  function updateRangeSelection(ids, selectedIds, clickedId, anchorId, shiftKey, toggleSelected = false) {
    const ordered = Array.isArray(ids) ? ids.map(String) : [];
    const clicked = String(clickedId || '');
    const anchor = String(anchorId || '');
    if (!clicked || !ordered.includes(clicked)) {
      return { selected: [...new Set((selectedIds || []).map(String))], anchor: anchor || null };
    }
    const existing = new Set((selectedIds || []).map(String));
    if (!shiftKey || !anchor || !ordered.includes(anchor)) {
      if (toggleSelected && existing.size === 1 && existing.has(clicked)) {
        return { selected: [], anchor: null };
      }
      return { selected: [clicked], anchor: clicked };
    }
    const start = ordered.indexOf(anchor);
    const end = ordered.indexOf(clicked);
    const range = ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
    range.forEach((id) => existing.add(id));
    return { selected: ordered.filter((id) => existing.has(id)), anchor };
  }

  function normalizeHomeLayout(layout, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const keys = Object.keys(fallback);
    if (!layout || typeof layout !== 'object') return fallback;
    const slots = keys.map((key) => layout[key]);
    const validSlots = new Set(Object.values(fallback));
    if (
      slots.length !== validSlots.size ||
      new Set(slots).size !== validSlots.size ||
      slots.some((slot) => !validSlots.has(slot))
    ) {
      return fallback;
    }
    return Object.fromEntries(keys.map((key) => [key, layout[key]]));
  }

  function swapHomeLayoutSlots(layout, sourceId, targetId) {
    if (!layout || typeof layout !== 'object' || sourceId === targetId) return { ...(layout || {}) };
    if (!Object.prototype.hasOwnProperty.call(layout, sourceId) || !Object.prototype.hasOwnProperty.call(layout, targetId)) {
      return { ...layout };
    }
    return {
      ...layout,
      [sourceId]: layout[targetId],
      [targetId]: layout[sourceId],
    };
  }

  function normalizeTodoCategoryNames(value, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(fallback).map(([key, defaultName]) => {
      const candidate = String(source[key] || '').replace(/\s+/g, ' ').trim();
      return [key, candidate ? candidate.slice(0, 24) : defaultName];
    }));
  }

  function normalizeHomeWidgetSizes(value, defaults, preferredId, capacity = Infinity) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const allowed = new Set(['mini', 'small', 'medium', 'large']);
    const source = value && typeof value === 'object' ? value : {};
    if (Object.keys(source).some((key) => key in fallback && !allowed.has(source[key]))) {
      return fallback;
    }
    const sizes = Object.fromEntries(Object.entries(fallback).map(([key, defaultSize]) => (
      [key, allowed.has(source[key]) ? source[key] : defaultSize]
    )));
    const area = { mini: 2, small: 4, medium: 8, large: 16 };
    const totalArea = () => Object.values(sizes).reduce((total, size) => total + area[size], 0);
    const siblings = Object.keys(sizes).filter((key) => key !== preferredId);

    while (totalArea() > capacity) {
      const excess = totalArea() - capacity;
      const candidate = siblings
        .map((key) => ({ key, reduction: sizes[key] === 'large' ? 8 : sizes[key] === 'medium' ? 4 : sizes[key] === 'small' ? 2 : 0 }))
        .filter((item) => item.reduction > 0 && item.reduction <= excess)
        .sort((a, b) => b.reduction - a.reduction)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'large' ? 'medium' : sizes[candidate.key] === 'medium' ? 'small' : 'mini';
    }

    while (Number.isFinite(capacity) && totalArea() < capacity) {
      const remaining = capacity - totalArea();
      const candidate = siblings
        .map((key) => ({ key, increase: sizes[key] === 'mini' ? 2 : sizes[key] === 'small' ? 4 : sizes[key] === 'medium' ? 8 : 0 }))
        .filter((item) => item.increase > 0 && item.increase <= remaining)
        .sort((a, b) => b.increase - a.increase)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'mini' ? 'small' : sizes[candidate.key] === 'small' ? 'medium' : 'large';
    }
    return sizes;
  }

  function packHomeWidgetLayout(order, sizes, columns = 12, rows = 4) {
    const ids = Array.isArray(order) ? order.filter((id) => Object.prototype.hasOwnProperty.call(sizes || {}, id)) : [];
    if (!ids.length || columns < 1 || rows < 1) return null;
    const dimensions = {
      mini: { width: 2, height: 1 },
      small: { width: 2, height: 2 },
      medium: { width: 4, height: 2 },
      large: { width: 4, height: 4 },
    };
    const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
    const placements = {};

    function fits(column, row, width, height) {
      if (column + width > columns || row + height > rows) return false;
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) {
          if (occupied[y][x]) return false;
        }
      }
      return true;
    }

    function mark(column, row, width, height, value) {
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) occupied[y][x] = value;
      }
    }

    function place(index) {
      if (index >= ids.length) return occupied.every((row) => row.every(Boolean));
      const id = ids[index];
      const dimension = dimensions[sizes[id]] || dimensions.small;
      for (let row = 0; row <= rows - dimension.height; row += 1) {
        for (let column = 0; column <= columns - dimension.width; column += 1) {
          if (!fits(column, row, dimension.width, dimension.height)) continue;
          mark(column, row, dimension.width, dimension.height, true);
          placements[id] = { column, row, ...dimension };
          if (place(index + 1)) return true;
          delete placements[id];
          mark(column, row, dimension.width, dimension.height, false);
        }
      }
      return false;
    }

    return place(0) ? placements : null;
  }

  const HOME_GAPLESS_TEMPLATES = {
    1: [{ column: 0, row: 0, width: 12, height: 4 }],
    2: [
      { column: 0, row: 0, width: 6, height: 4 },
      { column: 6, row: 0, width: 6, height: 4 },
    ],
    3: [
      { column: 0, row: 0, width: 4, height: 4 },
      { column: 4, row: 0, width: 4, height: 4 },
      { column: 8, row: 0, width: 4, height: 4 },
    ],
    4: [
      { column: 0, row: 0, width: 6, height: 2 },
      { column: 6, row: 0, width: 6, height: 2 },
      { column: 0, row: 2, width: 6, height: 2 },
      { column: 6, row: 2, width: 6, height: 2 },
    ],
    5: [
      { column: 0, row: 0, width: 4, height: 4 },
      { column: 4, row: 0, width: 4, height: 2 },
      { column: 8, row: 0, width: 4, height: 2 },
      { column: 4, row: 2, width: 4, height: 2 },
      { column: 8, row: 2, width: 4, height: 2 },
    ],
    6: [
      { column: 0, row: 0, width: 4, height: 2 },
      { column: 4, row: 0, width: 4, height: 2 },
      { column: 8, row: 0, width: 4, height: 2 },
      { column: 0, row: 2, width: 4, height: 2 },
      { column: 4, row: 2, width: 4, height: 2 },
      { column: 8, row: 2, width: 4, height: 2 },
    ],
  };

  function normalizeHiddenHomeModules(value, moduleIds) {
    const ids = Array.isArray(moduleIds)
      ? [...new Set(moduleIds.map((id) => String(id)))]
      : [];
    if (!ids.length || !Array.isArray(value)) return [];
    const requested = new Set(value.map((id) => String(id)));
    const hiddenIds = ids.filter((id) => requested.has(id));
    return hiddenIds.length === ids.length ? [] : hiddenIds;
  }

  function updateHomeModuleVisibility(hiddenIds, moduleIds, moduleId, visible) {
    const ids = Array.isArray(moduleIds)
      ? [...new Set(moduleIds.map((id) => String(id)))]
      : [];
    const current = normalizeHiddenHomeModules(hiddenIds, ids);
    const id = String(moduleId || '');
    if (!ids.includes(id) || typeof visible !== 'boolean') {
      return { ok: false, error: 'invalid_module', hiddenIds: current };
    }
    const next = new Set(current);
    if (visible) next.delete(id);
    else next.add(id);
    if (next.size >= ids.length) {
      return { ok: false, error: 'at_least_one_required', hiddenIds: current };
    }
    return { ok: true, hiddenIds: ids.filter((candidate) => next.has(candidate)) };
  }

  function placementsOverlap(a, b) {
    return a.column < b.column + b.width
      && a.column + a.width > b.column
      && a.row < b.row + b.height
      && a.row + a.height > b.row;
  }

  function clampHomePlacement(placement, columns, rows) {
    const width = Math.min(Math.max(1, Number(placement.width) || 1), columns);
    const height = Math.min(Math.max(1, Number(placement.height) || 1), rows);
    const column = Math.min(Math.max(0, Number(placement.column) || 0), columns - width);
    const row = Math.min(Math.max(0, Number(placement.row) || 0), rows - height);
    return { column, row, width, height };
  }

  function findFreeHomeSlot(placements, width, height, columns, rows, preferred) {
    if (preferred) {
      const preferredSlot = clampHomePlacement({ ...preferred, width, height }, columns, rows);
      const blocked = Object.values(placements).some((item) => placementsOverlap(preferredSlot, item));
      if (!blocked) return preferredSlot;
    }
    let best = null;
    let bestDist = Infinity;
    const preferredColumn = Number.isInteger(preferred?.column) ? preferred.column : 0;
    const preferredRow = Number.isInteger(preferred?.row) ? preferred.row : 0;
    for (let row = 0; row <= rows - height; row += 1) {
      for (let column = 0; column <= columns - width; column += 1) {
        const slot = { column, row, width, height };
        if (Object.values(placements).some((item) => placementsOverlap(slot, item))) continue;
        const dist = Math.abs(column - preferredColumn) + Math.abs(row - preferredRow);
        if (dist < bestDist) {
          best = slot;
          bestDist = dist;
        }
      }
    }
    return best;
  }

  function arrangeHomePlacements(basePlacements, lockedIds, columns, rows) {
    const locked = new Set(lockedIds);
    const next = {};
    for (const id of locked) {
      if (!basePlacements[id]) return null;
      next[id] = clampHomePlacement(basePlacements[id], columns, rows);
    }
    const lockedList = [...locked];
    for (let i = 0; i < lockedList.length; i += 1) {
      for (let j = i + 1; j < lockedList.length; j += 1) {
        if (placementsOverlap(next[lockedList[i]], next[lockedList[j]])) return null;
      }
    }
    const movable = Object.keys(basePlacements).filter((id) => !locked.has(id))
      .sort((left, right) => {
        const a = basePlacements[left];
        const b = basePlacements[right];
        return (b.width * b.height) - (a.width * a.height) || a.row - b.row || a.column - b.column;
      });
    for (const id of movable) {
      const current = basePlacements[id];
      const slot = findFreeHomeSlot(next, current.width, current.height, columns, rows, current);
      if (!slot) return null;
      next[id] = slot;
    }
    return next;
  }

  function commitHomePlacements(placements, columns, rows) {
    const visibleOrder = Object.keys(placements).sort((left, right) => {
      const a = placements[left];
      const b = placements[right];
      return a.row - b.row || a.column - b.column || left.localeCompare(right);
    });
    const result = layoutFromHomePlacements(visibleOrder, placements);
    return validateHomeWidgetLayout(result, visibleOrder, columns, rows) ? result : null;
  }

  function layoutVariantForPlacement(placement) {
    const width = Number(placement?.width) || 0;
    const height = Number(placement?.height) || 0;
    if (width <= 2 && height <= 1) return 'mini';
    if (width <= 2 && height <= 2) return 'compact';
    if (height <= 2) return 'wide';
    if (width >= 6 && height >= 4) return 'full';
    return 'tall';
  }

  function validateHomeWidgetLayout(layout, visibleIds, columns = 12, rows = 4) {
    if (!layout || !layout.placements || columns < 1 || rows < 1) return false;
    const expected = [...new Set(Array.isArray(visibleIds) ? visibleIds.map(String) : [])].sort();
    const entries = Object.entries(layout.placements);
    if (!expected.length || entries.length !== expected.length) return false;
    if (JSON.stringify(entries.map(([id]) => id).sort()) !== JSON.stringify(expected)) return false;
    const cells = Array(columns * rows).fill(0);
    for (const [, item] of entries) {
      const values = [item?.column, item?.row, item?.width, item?.height];
      if (!values.every(Number.isInteger) || item.width < 1 || item.height < 1) return false;
      if (item.column < 0 || item.row < 0
        || item.column + item.width > columns || item.row + item.height > rows) return false;
      for (let row = item.row; row < item.row + item.height; row += 1) {
        for (let column = item.column; column < item.column + item.width; column += 1) {
          const index = row * columns + column;
          cells[index] += 1;
          if (cells[index] > 1) return false;
        }
      }
    }
    // 允许留空，只要不重叠、不越界，板块就能停在用户放下的位置。
    return cells.every((count) => count <= 1);
  }

  function sizeNameForPlacement(placement) {
    const variant = layoutVariantForPlacement(placement);
    if (variant === 'mini') return 'mini';
    if (variant === 'compact') return 'small';
    if (variant === 'wide') return 'medium';
    return 'large';
  }

  function findHomeWidgetAtCell(placements, column, row) {
    if (!placements || typeof placements !== 'object') return null;
    if (!Number.isInteger(column) || !Number.isInteger(row)) return null;
    for (const [id, item] of Object.entries(placements)) {
      if (!item || !Number.isInteger(item.column) || !Number.isInteger(item.row)) continue;
      if (column >= item.column && column < item.column + item.width
        && row >= item.row && row < item.row + item.height) {
        return { id, placement: { ...item } };
      }
    }
    return null;
  }

  function cloneHomePlacements(placements) {
    return Object.fromEntries(Object.entries(placements || {}).map(([id, item]) => (
      [id, { column: item.column, row: item.row, width: item.width, height: item.height }]
    )));
  }

  function layoutFromHomePlacements(visibleOrder, placements) {
    const nextPlacements = cloneHomePlacements(placements);
    return {
      visibleOrder: [...visibleOrder],
      placements: nextPlacements,
      variants: Object.fromEntries(Object.entries(nextPlacements).map(([id, item]) => (
        [id, layoutVariantForPlacement(item)]
      ))),
      sizes: Object.fromEntries(Object.entries(nextPlacements).map(([id, item]) => (
        [id, sizeNameForPlacement(item)]
      ))),
    };
  }

  // 把板块的左上角放到目标格子，保持原来的宽高；挡路的板块会被挪到最近的空位，但不会被改掉大小。
  function moveHomeWidgetToCell(layout, sourceId, column, row, columns = 12, rows = 4) {
    const placements = layout && layout.placements;
    const source = String(sourceId || '');
    if (!placements || !placements[source]) return null;
    if (!Number.isInteger(column) || !Number.isInteger(row)) return null;
    const current = placements[source];
    const nextSource = clampHomePlacement({
      column,
      row,
      width: current.width,
      height: current.height,
    }, columns, rows);
    if (nextSource.column === current.column && nextSource.row === current.row) return null;
    const trial = cloneHomePlacements(placements);
    trial[source] = nextSource;
    const arranged = arrangeHomePlacements(trial, [source], columns, rows);
    return arranged ? commitHomePlacements(arranged, columns, rows) : null;
  }

  function resizeHomeWidget(layout, sourceId, width, height, columns = 12, rows = 4) {
    const placements = layout && layout.placements;
    const source = String(sourceId || '');
    if (!placements || !placements[source]) return null;
    const current = placements[source];
    return resizeHomeWidgetRect(layout, sourceId, {
      column: current.column,
      row: current.row,
      width,
      height,
    }, columns, rows);
  }

  function placementFromResizeEdge(start, edge, pointerColumn, pointerRow, columns = 12, rows = 4, minWidth = 2, minHeight = 1) {
    if (!start || !edge) return null;
    if (!Number.isInteger(pointerColumn) || !Number.isInteger(pointerRow)) return null;
    const right = start.column + start.width;
    const bottom = start.row + start.height;
    let column = start.column;
    let row = start.row;
    let width = start.width;
    let height = start.height;
    if (String(edge).includes('e')) {
      width = Math.max(minWidth, Math.min(columns - start.column, pointerColumn - start.column + 1));
      column = start.column;
    }
    if (String(edge).includes('w')) {
      column = Math.max(0, Math.min(pointerColumn, right - minWidth));
      width = right - column;
    }
    if (String(edge).includes('s')) {
      height = Math.max(minHeight, Math.min(rows - start.row, pointerRow - start.row + 1));
      row = start.row;
    }
    if (String(edge).includes('n')) {
      row = Math.max(0, Math.min(pointerRow, bottom - minHeight));
      height = bottom - row;
    }
    return clampHomePlacement({ column, row, width, height }, columns, rows);
  }

  function resizeHomeWidgetRect(layout, sourceId, nextRect, columns = 12, rows = 4) {
    const placements = layout && layout.placements;
    const source = String(sourceId || '');
    if (!placements || !placements[source] || !nextRect) return null;
    if (!Number.isInteger(nextRect.width) || !Number.isInteger(nextRect.height) || nextRect.width < 1 || nextRect.height < 1) return null;
    const current = placements[source];
    const nextSource = clampHomePlacement({
      column: nextRect.column,
      row: nextRect.row,
      width: nextRect.width,
      height: nextRect.height,
    }, columns, rows);
    if (nextSource.width === current.width && nextSource.height === current.height
      && nextSource.column === current.column && nextSource.row === current.row) {
      return null;
    }
    const trial = cloneHomePlacements(placements);
    trial[source] = nextSource;
    const arranged = arrangeHomePlacements(trial, [source], columns, rows);
    return arranged ? commitHomePlacements(arranged, columns, rows) : null;
  }

  function resizeHomeWidgetFromEdge(layout, sourceId, edge, pointerColumn, pointerRow, columns = 12, rows = 4) {
    const placements = layout && layout.placements;
    const source = String(sourceId || '');
    if (!placements || !placements[source]) return null;
    const nextRect = placementFromResizeEdge(placements[source], edge, pointerColumn, pointerRow, columns, rows);
    if (!nextRect) return null;
    return resizeHomeWidgetRect(layout, sourceId, nextRect, columns, rows);
  }

  function resolveHomeWidgetLayout(order, sizes, hiddenIds, columns = 12, rows = 4, preferredPlacements) {
    if (columns !== 12 || rows !== 4 || !sizes || typeof sizes !== 'object') return null;
    const ids = Array.isArray(order)
      ? [...new Set(order.map(String))].filter((id) => Object.prototype.hasOwnProperty.call(sizes, id))
      : [];
    if (!ids.length) return null;
    const hidden = new Set(normalizeHiddenHomeModules(hiddenIds, ids));
    const visibleOrder = ids.filter((id) => !hidden.has(id));
    if (!visibleOrder.length) return null;

    if (preferredPlacements && typeof preferredPlacements === 'object' && !Array.isArray(preferredPlacements)) {
      const sizeDimensions = {
        mini: { width: 2, height: 1 },
        small: { width: 2, height: 2 },
        medium: { width: 4, height: 2 },
        large: { width: 4, height: 4 },
      };
      const kept = {};
      for (const id of visibleOrder) {
        const preferred = preferredPlacements[id];
        if (!preferred || typeof preferred !== 'object') continue;
        const values = [preferred.column, preferred.row, preferred.width, preferred.height];
        if (!values.every(Number.isInteger)) continue;
        const slot = clampHomePlacement(preferred, columns, rows);
        if (Object.values(kept).some((item) => placementsOverlap(slot, item))) continue;
        kept[id] = slot;
      }
      let adopted = true;
      for (const id of visibleOrder.filter((item) => !kept[item])) {
        const dimension = sizeDimensions[sizes[id]] || sizeDimensions.small;
        const slot = findFreeHomeSlot(kept, dimension.width, dimension.height, columns, rows, preferredPlacements[id] || null);
        if (!slot) {
          adopted = false;
          break;
        }
        kept[id] = slot;
      }
      if (adopted) {
        const preferredLayout = layoutFromHomePlacements(visibleOrder, kept);
        if (validateHomeWidgetLayout(preferredLayout, visibleOrder, columns, rows)) {
          return preferredLayout;
        }
      }
    }

    let placements;
    if (visibleOrder.length === 7) {
      placements = packHomeWidgetLayout(visibleOrder, sizes, columns, rows);
    } else {
      const template = HOME_GAPLESS_TEMPLATES[visibleOrder.length];
      if (!template) return null;
      let slotOrder = [...visibleOrder];
      if (visibleOrder.length === 5) {
        const rank = { mini: 0, small: 1, medium: 2, large: 3 };
        const primary = [...visibleOrder].sort((left, right) => (
          (rank[sizes[right]] ?? 0) - (rank[sizes[left]] ?? 0)
          || visibleOrder.indexOf(left) - visibleOrder.indexOf(right)
        ))[0];
        slotOrder = [primary, ...visibleOrder.filter((id) => id !== primary)];
      }
      placements = Object.fromEntries(slotOrder.map((id, index) => [id, { ...template[index] }]));
    }
    if (!placements) return null;
    const result = {
      visibleOrder: [...visibleOrder],
      placements: Object.fromEntries(Object.entries(placements).map(([id, item]) => [id, { ...item }])),
      variants: Object.fromEntries(Object.entries(placements).map(([id, item]) => (
        [id, layoutVariantForPlacement(item)]
      ))),
    };
    return validateHomeWidgetLayout(result, visibleOrder, columns, rows) ? result : null;
  }

  function calculateAudioLevel(samples) {
    const values = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    if (!values.length) return 0;
    let sumSquares = 0;
    for (const sample of values) {
      const clamped = Math.max(-1, Math.min(1, Number(sample) || 0));
      sumSquares += clamped * clamped;
    }
    return Math.round(Math.sqrt(sumSquares / values.length) * 1000) / 1000;
  }

  function resampleFloat32ToPcm16(samples, inputRate, outputRate = 16000) {
    const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    const fromRate = Math.max(1, Number(inputRate) || outputRate);
    const toRate = Math.max(1, Number(outputRate) || 16000);
    if (!source.length) return new Int16Array();
    const ratio = fromRate / toRate;
    const outputLength = Math.max(1, Math.round(source.length / ratio));
    const output = new Int16Array(outputLength);
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.max(start + 1, Math.min(source.length, Math.floor((outputIndex + 1) * ratio)));
      let sum = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex++) sum += source[sourceIndex];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output[outputIndex] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    return output;
  }

  function shouldTogglePanelForSpace(event) {
    if (!event || (event.key !== ' ' && event.key !== 'Spacebar' && event.code !== 'Space')) return false;
    return !event.repeat
      && !event.isComposing
      && !event.editable
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey;
  }

  function shouldHandleMirrorPinch(event) {
    return Boolean(event && event.live === true && event.ctrlKey === true);
  }

  function adjustMirrorZoom(currentZoom, deltaY, minZoom = 1, maxZoom = 2.6) {
    const min = Number.isFinite(minZoom) ? minZoom : 1;
    const max = Number.isFinite(maxZoom) && maxZoom >= min ? maxZoom : 2.6;
    const current = Number.isFinite(currentZoom) ? currentZoom : min;
    const delta = Number.isFinite(deltaY) ? deltaY : 0;
    const next = Math.max(min, Math.min(max, current - delta * 0.002));
    return Math.round(next * 100) / 100;
  }

  // 镜子要照真人：Mac 上所有摄像头都不报告朝向，不指定设备时 Chromium 会按枚举顺序
  // 选到排在最前的虚拟摄像头，而宿主 App 没开时它能打开却永远不出帧。
  // 自带相机 → 外接实体相机 → iPhone 连续互通（会唤醒手机）→ 虚拟摄像头垫底。
  const BUILTIN_CAMERA_PATTERN = /facetime|macbook|imac|built-?in|integrated|内建|内置/i;
  const CONTINUITY_CAMERA_PATTERN = /iphone|ipad|continuity|连续互通/i;
  const VIRTUAL_CAMERA_PATTERN = /virtual|虚拟|filteronme|尚镜|snap camera|mmhmm|manycam|xsplit|camo\b|camtwist|ecamm|nvidia broadcast/i;

  function mirrorCameraTier(label) {
    if (VIRTUAL_CAMERA_PATTERN.test(label)) return 3;
    if (BUILTIN_CAMERA_PATTERN.test(label)) return 0;
    if (CONTINUITY_CAMERA_PATTERN.test(label)) return 2;
    return 1;
  }

  function rankMirrorCameras(devices) {
    return (Array.isArray(devices) ? devices : [])
      .filter((device) => device && device.kind === 'videoinput' && device.deviceId)
      .map((device, index) => ({ id: device.deviceId, tier: mirrorCameraTier(String(device.label || '')), index }))
      .sort((a, b) => a.tier - b.tier || a.index - b.index)
      .map((entry) => entry.id);
  }

  return {
    normalizeHttpUrl,
    classifyLink,
    addLinkToGroups,
    preferredLinkGroupId,
    moveLinkToGroup,
    moveLinkToPosition,
    renameGroup,
    prependClipboardHistory,
    createExclusiveAsyncTask,
    createCommand,
    createRecording,
    isScreenRecording,
    removeRecordingState,
    calculateRecordingDuration,
    completionMatchesWindow,
    deriveWindowDisplayName,
    numberWindowLabels,
    createTodo,
    updateTodo,
    sortTodosForDisplay,
    filterCredentials,
    credentialRowAction,
    visiblePanelTabs,
    resolveDefaultPanelTab,
    normalizeNoteArchive,
    filterNotes,
    updateNoteInArchive,
    updateNoteTitle,
    applyGeneratedNoteTitle,
    apiCredentialStatuses,
    settingsSummary,
    currentMonthDeadline,
    calendarDeadline,
    shiftCalendarMonth,
    defaultTodoDeadline,
    todoTimeBattery,
    resolveTodoImportCategory,
    parseTodoImportDeadline,
    mergeTodoImport,
    localDateKey,
    isoWeekKey,
    isValidDateKey,
    normalizeIsoWeekKey,
    normalizeWorkBucket,
    resolveWorkPeriod,
    matchesWorkTab,
    filterTodosForWorkTab,
    parseWorkInboxPayload,
    mergeLinkImport,
    updateRangeSelection,
    normalizeHomeLayout,
    swapHomeLayoutSlots,
    normalizeTodoCategoryNames,
    normalizeHomeWidgetSizes,
    packHomeWidgetLayout,
    normalizeHiddenHomeModules,
    updateHomeModuleVisibility,
    resolveHomeWidgetLayout,
    validateHomeWidgetLayout,
    layoutVariantForPlacement,
    sizeNameForPlacement,
    findHomeWidgetAtCell,
    moveHomeWidgetToCell,
    resizeHomeWidget,
    placementFromResizeEdge,
    resizeHomeWidgetRect,
    resizeHomeWidgetFromEdge,
    calculateAudioLevel,
    resampleFloat32ToPcm16,
    shouldTogglePanelForSpace,
    shouldHandleMirrorPinch,
    adjustMirrorZoom,
    rankMirrorCameras,
  };
});
