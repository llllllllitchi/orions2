/* Orions 2 — battle archive.
 *
 * Every finished duel is stored locally so the opponent AI can be re-trained
 * from real games. Records are plain JSON: they can be exported one by one (or
 * all at once) and imported back on another device, then fed to AITrainer.
 */
(function () {
  'use strict';

  const KEY = 'orions2.records.v1';
  const MAX_RECORDS = 100;
  const MAX_LOGS = 900;

  // One duel is roughly 25–80 KB, so 100 duels can bump into the ~5 MB
  // localStorage quota. Before dropping whole records we shrink the per-record
  // log detail (keep every structural line plus the last N lines), which keeps
  // the training data intact and only loses flavour text.
  function trimLogsOf(rec, keepTail) {
    const logs = rec.logs || [];
    if (logs.length <= keepTail) return rec;
    const structural = l => l.kind === 'turn' || l.kind === 'card' ||
      l.kind === 'spell' || l.kind === 'win' || l.kind === 'transform';
    const keep = [];
    for (let i = 0; i < logs.length; i++) {
      if (i >= logs.length - keepTail || structural(logs[i])) keep.push(logs[i]);
    }
    return Object.assign({}, rec, { logs: keep });
  }

  function compactAll(arr) {
    return arr.map(r => trimLogsOf(r, 120));
  }

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeAll(list) {
    let arr = list.slice();
    let compacted = false;
    while (arr.length) {
      try {
        localStorage.setItem(KEY, JSON.stringify(arr));
        return true;
      } catch (e) {
        // 1) 先压缩日志细节，保留全部对局与训练数据。
        if (!compacted) { arr = compactAll(arr); compacted = true; continue; }
        // 2) 仍然超限：从最旧的一局开始，按 10% 递减。
        if (arr.length <= 1) {
          try { localStorage.removeItem(KEY); } catch (e2) {}
          return false;
        }
        arr = arr.slice(Math.max(1, Math.ceil(arr.length * 0.1)));
      }
    }
    return false;
  }

  function compactLogs(logs) {
    const list = (logs || []).map(l => ({
      turn: l.turn, kind: l.kind, seq: l.seq, who: l.who, tag: l.tag, text: l.text
    }));
    if (list.length <= MAX_LOGS) return list;
    // Keep the newest lines and every structural line (turns / cards / spells).
    const keep = [];
    const structural = l => l.kind === 'turn' || l.kind === 'card' || l.kind === 'spell' || l.kind === 'win';
    for (let i = 0; i < list.length; i++) {
      if (i >= list.length - MAX_LOGS || structural(list[i])) keep.push(list[i]);
    }
    return keep;
  }

  function makeRecord(g, extra) {
    extra = extra || {};
    const players = g.players.map((p, i) => ({
      name: p.name,
      hp: p.hp,
      maxHp: p.maxHp,
      played: p.stats ? p.stats.played : 0,
      damage: p.stats ? p.stats.damage : 0,
      kills: p.stats ? p.stats.kills : 0,
      deck: (p.deck || []).map(d => d.card.id)
    }));
    const now = new Date();
    return {
      id: 'r' + now.getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      savedAt: now.toISOString(),
      version: 1,
      meta: {
        mode: extra.mode || 'single',
        difficulty: g.difficulty,
        challenge: g.challenge,
        deckMode: extra.deckMode || 'random',
        deckMode2: extra.deckMode2 || 'random',
        winner: g.winner,
        turns: g.turn,
        players,
        totalKills: g.totalKills,
        cardStats: g.cardStats || {}
      },
      logs: compactLogs(g.logs),
      decisions: (g.aiDecisions || []).slice(0, 400)
    };
  }

  function save(g, extra) {
    if (!g) return null;
    const rec = makeRecord(g, extra);
    const list = readAll();
    list.push(rec);
    while (list.length > MAX_RECORDS) list.shift();
    const ok = writeAll(list);
    return ok ? rec : null;
  }

  function list() {
    return readAll().slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  function get(id) {
    return readAll().find(r => r.id === id) || null;
  }

  function remove(id) {
    writeAll(readAll().filter(r => r.id !== id));
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  // 轻提示（#toast 由 UI 创建，这里只借用，不依赖 UI 的私有状态）
  function flash(text) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    // 页面容器对文本做了 uppercase，路径会变成全大写，这里临时还原。
    t.style.textTransform = 'none';
    t.classList.add('show');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function download(name, text) {
    // Android 版的 WebView 不处理 blob: 下载，点了「导出」什么都不会发生。
    // 原生侧注入了 Orions2Bridge.saveFile()，由它把文本写进「下载/Orions2」。
    const bridge = window.Orions2Bridge;
    if (bridge && typeof bridge.saveFile === 'function') {
      let res = '';
      try {
        res = String(bridge.saveFile(name, text) || '');
      } catch (e) {
        res = 'ERROR:' + e.message;
      }
      if (res.indexOf('ERROR') === 0) {
        flash('保存失败：' + res.replace(/^ERROR:?/, ''));
      } else {
        flash('已保存：' + res.replace(/^Download\//, '下载/').replace(/^\/storage\/emulated\/0\//, ''));
      }
      return;
    }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    flash('已导出 ' + name);
  }

  function exportRecord(rec) {
    if (!rec) return;
    download('orions2-duel-' + rec.id + '.json', JSON.stringify(rec, null, 2));
  }

  function exportAll() {
    const all = list();
    download('orions2-records-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ schema: 'orions2-records/v1', exportedAt: new Date().toISOString(), records: all }, null, 2));
    return all.length;
  }

  function normalizeRecord(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.schema === 'orions2-records/v1' && Array.isArray(obj.records)) return null; // handled by caller
    const meta = obj.meta || (obj.players ? obj : null);
    if (!meta) return null;
    return {
      id: obj.id || ('r' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)),
      savedAt: obj.savedAt || new Date().toISOString(),
      version: obj.version || 1,
      meta: {
        mode: meta.mode || 'single',
        difficulty: meta.difficulty || 'normal',
        challenge: meta.challenge || 'none',
        deckMode: meta.deckMode || 'random',
        deckMode2: meta.deckMode2 || 'random',
        winner: meta.winner == null ? null : meta.winner,
        turns: meta.turns || obj.turn || 0,
        players: meta.players || [],
        totalKills: meta.totalKills || 0,
        cardStats: meta.cardStats || {}
      },
      logs: Array.isArray(obj.logs) ? obj.logs.slice(0, MAX_LOGS) : [],
      decisions: Array.isArray(obj.decisions) ? obj.decisions.slice(0, 400) : []
    };
  }

  function importObjects(objs) {
    const current = readAll();
    const ids = new Set(current.map(r => r.id));
    let added = 0;
    let skipped = 0;
    for (const obj of objs) {
      const rec = normalizeRecord(obj);
      if (!rec) { skipped++; continue; }
      if (ids.has(rec.id)) { skipped++; continue; }
      ids.add(rec.id);
      current.push(rec);
      added++;
    }
    current.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    while (current.length > MAX_RECORDS) current.shift();
    writeAll(current);
    return { added, skipped };
  }

  function parseJSON(text) {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.records)) return data.records;
    return [data];
  }

  async function importFiles(files) {
    let added = 0;
    let skipped = 0;
    for (const file of Array.from(files || [])) {
      try {
        const text = await file.text();
        const res = importObjects(parseJSON(text));
        added += res.added;
        skipped += res.skipped;
      } catch (e) { skipped++; }
    }
    return { added, skipped };
  }

  function totalDecisions() {
    return list().reduce((n, r) => n + (r.decisions ? r.decisions.length : 0), 0);
  }

  window.BattleRecords = {
    KEY, MAX_RECORDS, save, list, get, remove, clear,
    exportRecord, exportAll, importFiles, importObjects, parseJSON,
    totalDecisions
  };
})();
