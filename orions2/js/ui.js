/* Orions web duel — presentation layer. */
(function () {
  'use strict';

  const ELEMENTS = window.ELEMENTS;
  const LABEL = { fire: '火', water: '水', air: '风', earth: '土', life: '生', death: '死' };
  const DECK_SLOTS = 6;
  const DECK_MAX_PER_ELEMENT = 5;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = ms => UI.fast ? Promise.resolve() : sleep(ms);

  const UI = {
    g: null,
    mode: 'single',
    me: 0,
    avatars: ['assets/ui/avatar-life-1.png', 'assets/ui/avatar-death-1.png'],
    passPending: false,
    diff: 'normal',
    lanSide: 0,
    lan: { role: '', code: '', peer: false, pending: false, resolve: null, started: false },
    challenge: 'none',
    deckMode: 'random',
    deckMode2: 'random',
    customDecks: [],
    deckSlot: 0,
    deckSlot2: 1,
    editingSlot: 0,
    editingPlayer: 0,
    deckDraft: [],
    pickerEl: null,
    el: 'fire',
    sel: null,
    targets: [],
    busy: false,
    sound: true,
    volume: 0.35,
    started: false,
    statsRecorded: false,
    firstChoice: '0',
    logSeq: 0,
    blFilter: 'all',
    blTab: 'log',
    recordView: null,
    recordSaved: false,
    codexFilter: 'all',
    codexScroll: 0,
    codexAnchor: null,
    modalReturn: null,
    modalMode: 'card'
  };
  window.UI = UI;

  /* ------------------------------------------------------------ fx scaling */
  // 手机横屏时一个棋格大约 100px，此时系数为 1；平板棋格更大，
  // 特效按同比例放大，避免“手机上刚好、平板上小得看不见”。
  let FXS = 1;
  let fxScaleQueued = false;
  function computeFxScale() {
    fxScaleQueued = false;
    const board = $('#board');
    const slot = board && board.querySelector('.slot');
    if (!slot) return FXS;
    const r = slot.getBoundingClientRect();
    const base = Math.min(r.width, r.height);
    if (!base) return FXS;
    const next = Math.max(1, Math.min(2.4, base / 104));
    if (Math.abs(next - FXS) > 0.01) {
      FXS = next;
      document.documentElement.style.setProperty('--fxs', FXS.toFixed(3));
    }
    return FXS;
  }
  function scheduleFxScale() {
    if (fxScaleQueued) return;
    fxScaleQueued = true;
    requestAnimationFrame(computeFxScale);
  }

  /* --------------------------------------------------------------- sound */
  const SFX = {};
  const SFX_BASE = { attack: 0.32, cast: 0.32, cast2: 0.32, die: 0.28, spell: 0.32 };
  ['attack', 'cast', 'cast2', 'die', 'spell'].forEach(k => {
    const a = new Audio('assets/sfx/' + k + '.wav');
    a.volume = SFX_BASE[k] * UI.volume;
    SFX[k] = a;
  });
  function applyVolume() {
    for (const k of Object.keys(SFX)) SFX[k].volume = SFX_BASE[k] * UI.volume;
  }
  function setVolume(v, persist) {
    v = Number(v);
    if (!Number.isFinite(v)) return;
    UI.volume = Math.max(0, Math.min(1, v));
    applyVolume();
    const range = $('#volume');
    if (range) range.value = String(Math.round(UI.volume * 100));
    if (persist) { try { localStorage.setItem('orions2volume', String(UI.volume)); } catch (e) {} }
  }
  function loadVolume() {
    try {
      const raw = localStorage.getItem('orions2volume');
      if (raw != null && raw !== '') { setVolume(parseFloat(raw), false); return; }
    } catch (e) {}
    setVolume(UI.volume, false);
  }
  function play(k) {
    if (!UI.sound) return;
    const a = SFX[k];
    if (!a) return;
    try { a.currentTime = 0; a.volume = SFX_BASE[k] * UI.volume; a.play().catch(() => {}); } catch (e) {}
  }

  /* --------------------------------------------------------------- helpers */
  function h(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function fmt(n) {
    n = Number(n);
    return Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : '0';
  }
  function cardById(id) { return window.CARD_BY_ID[id]; }
  function zhA(card) { return (window.CARD_ZH && window.CARD_ZH[card.id] && window.CARD_ZH[card.id].a) || card.ability || ''; }
  function zhS(card) { return (window.CARD_ZH && window.CARD_ZH[card.id] && window.CARD_ZH[card.id].s) || card.spell || ''; }
  function meId() {
    if (UI.mode === 'lan') return UI.lanSide;
    return UI.mode === 'duo' && UI.g ? UI.g.active : 0;
  }
  function player() { return UI.g.player(meId()); }
  function isMyTurn() {
    return !!UI.g && UI.g.winner == null && UI.g.phase === 'play' && !UI.busy && !UI.passPending
      && ((UI.mode === 'duo' || UI.mode === 'lan') ? UI.g.active === meId() : UI.g.active === 0);
  }

  function sideIdx(side) { return side === 'own' ? meId() : 1 - meId(); }
  function slotEl(side, slot) {
    return $('.slot[data-side="' + side + '"][data-slot="' + slot + '"]');
  }
  function rectOf(node) { return node ? node.getBoundingClientRect() : null; }

  function requestLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(UI._toastT);
    UI._toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }

  /* --------------------------------------------------------------- hover tip */
  let tipTimer = null;
  let tipAnchor = null;
  function tipTarget(target) {
    const el = target && target.closest ? target.closest('.card, .codex-cell, .deck-cell, .picker-cell, .draft-cell') : null;
    if (!el) return null;
    const id = el.dataset.cardId || el.dataset.id;
    const card = cardById(id);
    if (!card) return null;
    let creature = null;
    if (el.classList.contains('card') && el.dataset.side != null && UI.g) {
      creature = UI.g.creatureAt(parseInt(el.dataset.side, 10), parseInt(el.dataset.slot, 10));
    }
    return { el, card, creature };
  }
  function hideCardTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tipAnchor = null;
    const tip = $('#card-tip');
    if (tip) tip.classList.add('hidden');
  }
  function castCostText(card) {
    const amount = card.castCost || 0;
    const el = (card.castElement && card.castElement !== 0) ? card.castElement : card.element;
    if (!amount) return '免费';
    if (el === 'all') return '每系 ' + amount + ' 点';
    return amount + ' ' + LABEL[el];
  }
  function showCardTip(anchor, card, creature) {
    const tip = $('#card-tip');
    if (!tip) return;
    const type = card.type === 'MONSTER' ? '生物' : '法术';
    const atk = creature ? UI.g.attackValue(creature) : (card.atkVar ? '变动' : card.atk);
    const hp = creature ? fmt(creature.hp) : (card.hpVar ? '变动' : card.hp);
    const maxHp = creature ? creature.maxHp : (card.hpVar ? '变动' : card.hp);
    let html = '<div class="tip-head"><b>' + card.name + '</b><span>' +
      LABEL[card.element] + ' · ' + type + ' · 费用 ' + card.level + '</span></div>';
    if (card.type === 'MONSTER') {
      html += '<div class="tip-stats">攻击 ' + atk + ' · 生命 ' + hp +
        (maxHp && String(maxHp) !== String(hp) ? ' / ' + maxHp : '') + '</div>';
    } else {
      html += '<div class="tip-stats">法术 · 费用 ' + card.level + ' ' + LABEL[card.element] + '</div>';
    }
    html += '<div class="tip-label">能力</div><div class="tip-text">' + zhA(card) + '</div>';
    if (card.caster && zhS(card)) {
      html += '<div class="tip-cast"><b>施法 · ' + (card.spellName || '法术') + '</b><br>' +
        castCostText(card) + '<br>' + zhS(card) + '</div>';
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    tip.style.visibility = 'hidden';
    const r = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
    let top = r.top - th - 10;
    if (top < 8) top = r.bottom + 10;
    if (top + th > window.innerHeight - 8) top = Math.max(8, window.innerHeight - th - 8);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.visibility = '';
    tipAnchor = anchor;
  }

  function floatText(x, y, text, cls, big) {
    const n = h('div', 'float-num ' + (cls || '') + (big ? ' big' : ''), text);
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 1700);
  }

  // Short full-screen jolt. 1 = light tap, 2 = solid hit, 3 = heavy blow.
  let shakeTimer = null;
  function fxScreenShake(power) {
    const app = $('#app');
    if (!app) return;
    const p = Math.min(3, Math.max(1, power || 1));
    app.classList.remove('shake-1', 'shake-2', 'shake-3');
    void app.offsetWidth;
    app.classList.add('shake-' + p);
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => {
      app.classList.remove('shake-1', 'shake-2', 'shake-3');
    }, 520);
  }

  // White cross-burst at the point of contact.
  function fxImpactAt(x, y) {
    const n = h('div', 'fx-impact');
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 400);
  }

  // Splinters flying out of a dying creature.
  function fxShatterAt(x, y, count) {
    const total = count || 9;
    for (let i = 0; i < total; i++) {
      const p = h('div', 'fx-shatter');
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const dist = (40 + Math.random() * 70) * FXS;
      const size = (6 + Math.random() * 7) * FXS;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.width = p.style.height = size + 'px';
      p.style.margin = (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px';
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      p.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      $('#fx-layer').appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }
  function burstAt(x, y) {
    const n = h('div', 'slash');
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 450);
  }

  const ELC = {
    fire: '#ff7a45', water: '#55c9ff', air: '#a9e8ff',
    earth: '#c3d96f', life: '#ffe08a', death: '#b58cff'
  };
  function elColor(el) { return ELC[el] || '#f3d999'; }
  function centerOf(node) {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function fxRingAt(x, y, color, size) {
    const n = h('div', 'fx-ring');
    const s = (size || 76) * FXS;
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    n.style.width = n.style.height = s + 'px';
    n.style.margin = (-s / 2) + 'px 0 0 ' + (-s / 2) + 'px';
    n.style.borderColor = color;
    n.style.boxShadow = '0 0 ' + (22 * FXS) + 'px ' + color + '88, inset 0 0 ' + (22 * FXS) + 'px ' + color + '55';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 720);
  }
  function fxBurstAt(x, y, color, count) {
    const n = count || 8;
    for (let i = 0; i < n; i++) {
      const p = h('div', 'fx-spark');
      const ang = Math.random() * Math.PI * 2;
      const dist = (26 + Math.random() * 54) * FXS;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = color;
      p.style.boxShadow = '0 0 ' + (8 * FXS) + 'px ' + color;
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      $('#fx-layer').appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }
  function fxBeam(from, to, color) {
    const a = centerOf(from), b = centerOf(to);
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const n = h('div', 'fx-beam');
    n.style.left = a.x + 'px';
    n.style.top = a.y + 'px';
    n.style.width = len + 'px';
    n.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
    n.style.background = 'linear-gradient(90deg, transparent, ' + color + ', #fff, ' + color + ', transparent)';
    n.style.boxShadow = '0 0 12px ' + color;
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 420);
  }
  function fxFlash(color, alpha) {
    const n = h('div', 'fx-flash');
    n.style.background = 'radial-gradient(circle at 50% 48%, ' + color + ', transparent 62%)';
    n.style.opacity = alpha == null ? 0.18 : alpha;
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 480);
  }
  function fxLabelAt(x, y, text, color) {
    const n = h('div', 'fx-label', text);
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    n.style.color = color || '#f3d999';
    n.style.textShadow = '0 1px 3px #000, 0 0 14px ' + (color || '#f3d999') + '99';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 1600);
  }

  /* ------------------------------------------------------------ 治疗：金色 */
  // 金光晕 + 两道错开的金环 + 向上的光粒，整体随 FXS 等比放大。
  function fxHealAt(x, y, size, motes) {
    const r = (size || 58) * FXS;
    const glow = h('div', 'fx-heal-glow');
    glow.style.left = x + 'px';
    glow.style.top = y + 'px';
    glow.style.width = glow.style.height = (r * 3.2) + 'px';
    glow.style.margin = (-r * 1.6) + 'px 0 0 ' + (-r * 1.6) + 'px';
    $('#fx-layer').appendChild(glow);
    setTimeout(() => glow.remove(), 900);

    [0, 130].forEach(delay => {
      setTimeout(() => {
        const n = h('div', 'fx-heal-ring');
        n.style.left = x + 'px';
        n.style.top = y + 'px';
        n.style.width = n.style.height = (r * 2) + 'px';
        n.style.margin = (-r) + 'px 0 0 ' + (-r) + 'px';
        $('#fx-layer').appendChild(n);
        setTimeout(() => n.remove(), 900);
      }, delay);
    });

    const total = motes || 12;
    for (let i = 0; i < total; i++) {
      const m = h('div', 'fx-mote');
      const w = (3 + Math.random() * 3.5) * FXS;
      m.style.left = (x + (Math.random() - 0.5) * r * 1.5) + 'px';
      m.style.top = (y + (Math.random() - 0.5) * r * 0.7) + 'px';
      m.style.width = w + 'px';
      m.style.height = (w * 2.6) + 'px';
      m.style.animationDelay = (Math.random() * 0.24).toFixed(2) + 's';
      m.style.setProperty('--dx', ((Math.random() - 0.5) * r * 1.1).toFixed(1) + 'px');
      m.style.setProperty('--dy', (-(r * 1.3 + Math.random() * r * 1.3)).toFixed(1) + 'px');
      $('#fx-layer').appendChild(m);
      setTimeout(() => m.remove(), 1500);
    }
  }

  /* ------------------------------------------------------------ 胜负：全屏 */
  function fxVictory(win) {
    const color = win ? '#f3d999' : '#c9645a';
    const wrap = h('div', 'fx-victory');
    wrap.style.setProperty('--vc', color);
    wrap.innerHTML =
      '<div class="fx-victory-rays"></div>' +
      '<div class="fx-victory-halo"></div>' +
      '<div class="fx-victory-title">' + (win ? '胜 利' : '败 北') + '</div>' +
      '<div class="fx-victory-sub">' + (win ? 'VICTORY' : 'DEFEAT') + '</div>';
    $('#fx-layer').appendChild(wrap);
    setTimeout(() => wrap.remove(), 1950);
  }
  function targetNode(side, slot) {
    const el = slotEl(side, slot);
    return el ? el.querySelector('.card') : null;
  }
  function targetForEvent(basePlayer, target) {
    if (!target) return null;
    if (target.player) {
      const pid = target.side === 'own' ? basePlayer : 1 - basePlayer;
      return barFor(pid).querySelector('.hp-track');
    }
    const side = target.side === 'own' ? basePlayer : 1 - basePlayer;
    return targetNode(side, target.slot);
  }

  /* --------------------------------------------------------------- setup */
  function buildBoard() {
    const board = $('#board');
    board.innerHTML = '';
    for (let s = 0; s < 5; s++) {
      for (const side of [1, 0]) {
        const slot = h('div', 'slot');
        slot.dataset.side = side;
        slot.dataset.slot = s;
        slot.style.gridColumn = (s + 1);
        slot.style.gridRow = side === 1 ? '1' : '2';
        board.appendChild(slot);
      }
    }
  }

  function buildTabs() {
    const wrap = $('#element-tabs');
    wrap.innerHTML = '';
    for (const el of ELEMENTS) {
      const b = h('button', 'etab');
      b.dataset.el = el;
      b.innerHTML = '<img src="assets/ui/element-' + el + '.png" alt=""><b>0</b><i>0</i>';
      b.addEventListener('click', () => {
        UI.el = el;
        if (isMobile()) { openMobilePicker(el); return; }
        UI.sel = null;
        render();
      });
      wrap.appendChild(b);
    }
  }

  function isMobile() {
    if (!window.matchMedia) return false;
    return window.matchMedia('(max-width: 700px)').matches
      || window.matchMedia('(max-height: 520px) and (orientation: landscape)').matches;
  }

  function cardCostNow(p, card) {
    return card.type === 'SPELL' ? UI.g.spellCost(p, card) : card.level;
  }

  function entryState(p, entry) {
    const card = entry.card;
    const cost = cardCostNow(p, card);
    if (UI.busy) return { ok: false, cost, reason: '正在结算，请稍候' };
    if (!isMyTurn()) return { ok: false, cost, reason: UI.mode === 'duo' ? '还没轮到你' : '敌方回合' };
    if (p.cardPlayed) return { ok: false, cost, reason: '本回合已经打出过卡牌' };
    if (p.mana[card.element] < cost) return { ok: false, cost, reason: '需要 ' + cost + ' 点' + LABEL[card.element] };
    if (card.type === 'MONSTER' && !UI.g.freeSlots(meId()).length) return { ok: false, cost, reason: '没有空槽' };
    if (card.type === 'SPELL') {
      const spec = UI.g.getSpellSpec(p, card);
      if (spec.type !== 'none' && !UI.g.validTargets(p, spec).length) return { ok: false, cost, reason: '没有合法目标' };
    }
    return { ok: true, cost, reason: '' };
  }

  function openMobilePicker(el) {
    if (!UI.g || !isMobile()) return;
    UI.pickerEl = el;
    UI.el = el;
    UI.sel = null;
    hideCardTip();
    render();
    renderMobilePicker();
    $('#mobile-picker').classList.remove('hidden');
  }

  function closeMobilePicker() {
    const picker = $('#mobile-picker');
    if (picker) picker.classList.add('hidden');
  }

  function renderMobilePicker() {
    if (!$('#picker-grid')) return;
    const p = player();
    const el = UI.pickerEl || UI.el;
    const entries = p.deck.filter(d => d.card.element === el);
    const states = entries.map(entry => ({ entry, state: entryState(p, entry) }));
    const playable = states.filter(x => x.state.ok);
    $('#picker-title').textContent = LABEL[el] + '元素';
    let sub;
    if (UI.busy) sub = '正在结算…';
    else if (!isMyTurn()) sub = UI.mode === 'duo' ? ('玩家 ' + (UI.g.active + 1) + ' 的回合') : '敌方回合';
    else if (p.cardPlayed) sub = '本回合已出牌，仍可使用施法能力';
    else sub = '可放置 ' + playable.length + ' / ' + entries.length + ' 张 · 亮色可点，暗色看原因';
    $('#picker-sub').textContent = sub;
    const elements = $('#picker-elements');
    elements.innerHTML = '';
    for (const e of ELEMENTS) {
      const list = p.deck.filter(d => d.card.element === e);
      const b = h('button', 'picker-el' + (e === el ? ' active' : '') + (list.length ? ' has' : ''));
      b.type = 'button';
      b.dataset.el = e;
      b.innerHTML = '<img src="assets/ui/element-' + e + '.png" alt=""><b>' + LABEL[e] + '</b><span>' + list.length + '</span>';
      b.addEventListener('click', () => {
        UI.pickerEl = e;
        UI.el = e;
        UI.sel = null;
        renderMobilePicker();
      });
      elements.appendChild(b);
    }
    const grid = $('#picker-grid');
    if (!states.length) {
      grid.innerHTML = '<div class="picker-empty">该元素没有卡牌。<br>点上方其他元素切换。</div>';
      return;
    }
    grid.innerHTML = '';
    for (const { entry, state } of states) {
      const card = entry.card;
      const cell = h('button', 'picker-cell' + (state.ok ? '' : ' disabled') +
        (UI.sel && UI.sel.card && UI.sel.card.id === card.id ? ' selected' : ''));
      cell.type = 'button';
      cell.dataset.id = card.id;
      cell.innerHTML = '<img src="' + card.img + '" alt="">' +
        '<span>' + card.name + '</span>' +
        '<b class="pcost">' + state.cost + '</b>' +
        '<em class="ptype">' + (card.type === 'MONSTER' ? '生物' : '法术') + '</em>';
      cell.addEventListener('click', () => {
        if (!state.ok) { toast(state.reason); return; }
        closeMobilePicker();
        onHandCard(card);
        setTimeout(() => {
          if (!UI.sel) return;
          if (card.type === 'SPELL') {
            const spec = UI.g.getSpellSpec(player(), card);
            if (spec.type === 'none') doCastSelected();
            else render();
          }
        }, 0);
      });
      grid.appendChild(cell);
    }
  }

  function buildDeckStrip() {
    const wrap = $('#deck-elements');
    wrap.innerHTML = '';
    for (const el of ELEMENTS) {
      const d = h('div', 'deck-el');
      d.dataset.el = el;
      d.innerHTML = '<img src="assets/ui/element-' + el + '.png" alt=""><b>4</b>';
      wrap.appendChild(d);
    }
  }

  function buildMana() {
    const wrap = $('#mana-pool');
    wrap.innerHTML = '';
    for (const el of ELEMENTS) {
      const m = h('div', 'mana');
      m.dataset.el = el;
      m.innerHTML = '<img src="assets/ui/element-' + el + '.png" alt=""><b>0</b>';
      m.title = LABEL[el];
      wrap.appendChild(m);
    }
    const ewrap = $('#enemy-mana');
    ewrap.innerHTML = '';
    for (const el of ELEMENTS) {
      const m = h('div', 'mana small');
      m.dataset.el = el;
      m.innerHTML = '<img src="assets/ui/element-' + el + '.png" alt=""><b>0</b>';
      m.style.width = '30px';
      m.style.height = '38px';
      m.querySelector('img').style.width = '21px';
      m.querySelector('img').style.height = '18px';
      ewrap.appendChild(m);
    }
  }

  function startArt() {
    const wrap = $('#start-art');
    if (wrap.dataset.done) return;
    wrap.dataset.done = '1';
    const ids = ['chimera', 'kraken', 'zeus', 'salamander', 'lich', 'avatar', 'kronos', 'hydra', 'banshee', 'moloch'];
    ids.forEach((id, i) => {
      const c = cardById(id);
      if (!c) return;
      const d = h('div', 'mini');
      d.style.left = (i * 9.3 + 2) + '%';
      d.style.top = ((i % 3) * 14 + 14) + 'px';
      d.style.transform = 'rotate(' + ((i % 2 ? 1 : -1) * (2 + i % 3)) + 'deg)';
      d.innerHTML = '<img src="' + c.img + '" alt="">';
      wrap.appendChild(d);
    });
  }

  /* --------------------------------------------------------------- card render */
  function statusPips(c) {
    let s = '';
    const add = (cls, icon, title) => { s += '<span class="st ' + cls + '" title="' + title + '">' + icon + '</span>'; };
    if (c.poison > 0) add('poison', '☠' + c.poison, '中毒 ' + c.poison + ' 层：每回合损失 ' + c.poison + ' 生命');
    if (c.stun > 0) add('stun', '✦', '眩晕：下次攻击被跳过');
    if (c.flags && c.flags.web) add('stun', '✳', '蛛网：下次攻击被跳过（会跟随生物移动）');
    if (c.flags && c.flags.aged) add('debuff', '⌛', '衰老：最大生命已减半，无法再次衰老');
    const atkDelta = (c.atkBonus || 0) + (c.tempAtk || 0);
    if (atkDelta !== 0) add(atkDelta > 0 ? 'buff' : 'debuff', atkDelta > 0 ? '⬆' : '⬇', '攻击 ' + (atkDelta > 0 ? '+' : '') + atkDelta);
    const hpDelta = (c.maxHp || 0) - (c.card.hp || 0);
    if (hpDelta > 0) add('buff', '♥', '最大生命 +' + hpDelta);
    else if (hpDelta < 0) add('debuff', '♥', '最大生命 ' + hpDelta);
    if (c.blessed) add('shield', '✚', '受祝福：被击中时回复 1');
    if (c.buffs && c.buffs.includes('airshield')) add('shield', '◈', '气盾：受到的伤害 -2');
    if (c.buffs && c.buffs.includes('stoneskin')) add('shield', '⬢', '石肤：受到的伤害 -1');
    if (c.buffs && c.buffs.includes('fireshield')) add('buff', '▲', '火盾');
    if (c.silenced) add('silence', '✕', '被沉默：不能施法');
    if (c.deathRage) add('rage', '✹', '死亡狂怒：本回合攻击翻倍，下回合受 10 伤害');
    if (c.flags && c.flags.magicLink) add('link', '⌁', 'Elementalist 的魔法链接');
    if (c.flags && c.flags.magicLinkSource) add('link', '⌁', '被 Elementalist 链接：受到同量伤害');
    if (c.flags && c.flags.rust) add('debuff', '≈', '锈蚀：受到的伤害 +2');
    if (c.flags && c.flags.petrified) add('shield', '◆', '石化：受到的伤害 -2');
    if (c.flags && c.flags.invincible) add('buff', '◉', '无敌');
    if (c.flags && c.flags.absolute) add('buff', '✧', '绝对防御：免疫攻击伤害');
    if (c.flags && c.flags.spellImmune) add('shield', '⌘', '免疫法术');
    if (c.flags && c.flags.protectSlot != null) add('shield', '⛨', '保护友方：替其承受伤害');
    if (c.flags && c.flags.pureHeart) add('buff', '❤', '纯净之心：对亡灵 +10 伤害');
    if (c.flags && c.flags.giftOfLife) add('buff', '✤', '生命之礼：死亡后满血复活');
    if (c.bloodlust) add('rage', '♦', '嗜血');
    return s ? '<div class="statuses">' + s + '</div>' : '';
  }

  function cardNode(card, opts) {
    opts = opts || {};
    const c = opts.creature || null;
    const kind = opts.kind || 'board';
    const el = card.element;
    const node = h('div', 'card el-' + el + (kind === 'hand' ? ' hand' : '') + (c && c.sick ? ' sick' : '') + (card.caster ? ' caster' : ''));
    if (opts.side != null) {
      node.dataset.side = opts.side;
      node.dataset.slot = opts.slot;
    }
    node.dataset.cardId = card.id;

    const art = (c ? c.card.img : card.img);
    if (card.fullart) {
      node.classList.add('full');
      let inner = '<div class="art"><img src="' + art + '" alt=""></div>';
      if ((kind === 'board' || kind === 'hand') && card.type === 'MONSTER') {
        inner += '<div class="atk badge">' + (c ? UI.g.attackValue(c) : (card.atkVar ? '变动' : card.atk)) + '</div>' +
                 '<div class="hp badge">' + (c ? fmt(c.hp) : (card.hpVar ? '变动' : card.hp)) + '</div>';
      }
      if (kind === 'board' && c && c.card.caster) {
        const spec = UI.g.getAbilitySpec(c);
        if (spec) {
          const mine = c.owner === meId();
          const cost = spec.cost;
          let afford = true;
          if (cost && cost.amount && c.id !== 'lich') {
            const cp = UI.g.player(c.owner);
            afford = cost.element === 'all'
              ? ELEMENTS.every(el => cp.mana[el] >= cost.amount)
              : cp.mana[cost.element] >= cost.amount;
          }
          const used = !!c.castUsed && !spec.repeatable;
          const hasTarget = spec.type === 'none' || UI.g.validTargets(UI.g.player(c.owner), spec, c).length > 0;
          const cloudTax = !!spec.surcharge && !afford;
          const enabled = mine && UI.g.active === c.owner && isMyTurn() && !used
            && (afford || cloudTax) && spec.canCast !== false && hasTarget;
          const cls = 'cast-btn' + (used ? ' used' : (!enabled ? ' disabled' : ''));
          const label = used ? '已用' : '施法';
          const title = used ? '本回合已经施法'
            : (spec.canCast === false ? spec.castReason
              : (cloudTax ? '元素不足：Astral Cloud 会让你受到 3 点伤害' : (afford ? '施放：' + (c.card.spellName || '能力') : '元素不足')));
          inner += '<button class="' + cls + '" type="button" data-side="' + opts.side + '" data-slot="' + opts.slot +
            '" title="' + title + '"' + (enabled ? '' : ' disabled') + '>' + label + '</button>';
        }
      }
      inner += (c ? statusPips(c) : '');
      node.innerHTML = inner;
    } else {
      node.innerHTML =
        '<div class="art"><img src="' + art + '" alt=""></div>' +
        '<div class="elem badge"><img src="assets/ui/element-' + el + '.png" alt=""></div>' +
        (kind === 'hand'
          ? '<div class="cost">' + opts.cost + '</div>'
          : '<div class="lvl badge">' + card.level + '</div>') +
        (card.type === 'MONSTER'
          ? '<div class="atk badge">' + (c ? UI.g.attackValue(c) : (card.atkVar ? '变动' : card.atk)) + '</div>' +
            '<div class="hp badge">' + (c ? fmt(c.hp) : (card.hpVar ? '变动' : card.hp)) + '</div>'
          : '') +
        (c && c.maxHp && c.hp < c.maxHp
          ? '<div class="hp-bar"><i style="width:' + Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) + '%"></i></div>'
          : '') +
        (c ? statusPips(c) : '') +
        '<div class="name">' + card.name + '</div>';
    }
    if (c && c.hp < c.maxHp) node.classList.add('damaged');
    return node;
  }

  /* --------------------------------------------------------------- render */
  function render() {
    if (!UI.g) return;
    hideCardTip();
    const g = UI.g;
    const me = meId();
    UI.me = me;
    const p = g.player(me);
    const e = g.player(1 - me);

    // wizard bars
    $('#player-name').textContent = p.name;
    $('#enemy-name').textContent = e.name;
    $('#player-portrait img').src = UI.avatars[me];
    $('#enemy-portrait img').src = UI.avatars[1 - me];
    $('#player-deck').textContent = p.deck.length + ' 张';
    $('#enemy-deck').textContent = e.deck.length + ' 张';
    const pMax = Math.max(fmt(p.maxHp) - 0, fmt(p.hp) - 0, 1);
    const eMax = Math.max(fmt(e.maxHp) - 0, fmt(e.hp) - 0, 1);
    const pPct = Math.max(0, p.hp / pMax * 100) + '%';
    const ePct = Math.max(0, e.hp / eMax * 100) + '%';
    $('#player-hp-fill').style.width = pPct;
    $('#enemy-hp-fill').style.width = ePct;
    // The lagging bar only ever trails the real one, so it reads as damage
    // that has just been taken instead of a second health bar.
    const pLag = $('#player-hp-lag');
    const eLag = $('#enemy-hp-lag');
    if (pLag) pLag.style.width = pPct;
    if (eLag) eLag.style.width = ePct;
    const pTxt = $('#player-hp-text');
    const eTxt = $('#enemy-hp-text');
    const pStr = fmt(p.hp);
    const eStr = fmt(e.hp);
    if (pTxt.textContent !== pStr) {
      pTxt.textContent = pStr;
      pTxt.classList.remove('bump'); void pTxt.offsetWidth; pTxt.classList.add('bump');
    }
    if (eTxt.textContent !== eStr) {
      eTxt.textContent = eStr;
      eTxt.classList.remove('bump'); void eTxt.offsetWidth; eTxt.classList.add('bump');
    }
    $('#player-bar').classList.toggle('low', p.hp <= pMax * 0.3);
    $('#enemy-bar').classList.toggle('low', e.hp <= eMax * 0.3);

    // mana
    for (const el of ELEMENTS) {
      const v = p.mana[el];
      const m = $('#mana-pool .mana[data-el="' + el + '"]');
      if (m) {
        m.querySelector('b').textContent = v;
        m.classList.toggle('zero', v === 0);
        m.classList.toggle('affordable', !!UI.sel && UI.sel.card && UI.sel.card.element === el);
      }
      const em = $('#enemy-mana .mana[data-el="' + el + '"]');
      if (em) { em.querySelector('b').textContent = e.mana[el]; em.classList.toggle('zero', e.mana[el] === 0); }
    }

    // round
    $('#round-number').textContent = g.turn || '—';
    const rt = $('#round-turn');
    if (g.winner != null) { rt.textContent = '决斗结束'; rt.className = 'round-turn'; }
    else if (g.phase === 'ending') { rt.textContent = '战斗结算'; rt.className = 'round-turn you'; }
    else if (UI.mode === 'duo') { rt.textContent = '玩家 ' + (g.active + 1) + ' 的回合'; rt.className = g.active === me ? 'round-turn you' : 'round-turn foe'; }
    else if (UI.mode === 'lan') { rt.textContent = g.active === me ? '你的回合' : '对方回合'; rt.className = g.active === me ? 'round-turn you' : 'round-turn foe'; }
    else if (g.active === 0) { rt.textContent = '你的回合'; rt.className = 'round-turn you'; }
    else { rt.textContent = '敌方回合'; rt.className = 'round-turn foe'; }
    $('#cards-left').textContent = p.deck.length;
    $('#round-number').title = '第 ' + g.turn + ' 回合';
    const status = $('#status-text');
    if (status) {
      status.textContent = (g.errors && g.errors.length)
        ? '检测到结算异常 · 可点“导出战报”反馈'
        : '一场奥里昂的决斗';
    }
    for (const el of ELEMENTS) {
      const chip = $('#deck-elements .deck-el[data-el="' + el + '"]');
      if (!chip) continue;
      const n = p.deck.filter(d => d.card.element === el).length;
      chip.querySelector('b').textContent = n;
      chip.classList.toggle('zero', n === 0);
    }

    // turn ribbon
    const rib = $('#turn-ribbon');
    if (g.winner != null) { rib.textContent = '决斗结束'; rib.className = 'vs-ribbon'; }
    else if (g.phase === 'ending') { rib.textContent = '战斗结算'; rib.className = 'vs-ribbon enemy-turn'; }
    else if (UI.mode === 'duo') { rib.textContent = '玩家 ' + (g.active + 1) + ' 的回合'; rib.className = 'vs-ribbon' + (g.active === me ? '' : ' enemy-turn'); }
    else if (g.active === 0) { rib.textContent = '你的回合'; rib.className = 'vs-ribbon'; }
    else { rib.textContent = '敌方回合'; rib.className = 'vs-ribbon enemy-turn'; }

    // board
    for (const side of [0, 1]) {
      for (let s = 0; s < 5; s++) {
        const slot = slotEl(side, s);
        if (!slot) continue;
        slot.style.gridRow = side === me ? '2' : '1';
        slot.className = 'slot';
        slot.innerHTML = '';
        const c = g.creatureAt(side, s);
        if (c) {
          slot.appendChild(cardNode(c.card, { creature: c, kind: 'board', side, slot: s }));
          slot.setAttribute('data-uid', c.uid);
        } else {
          slot.removeAttribute('data-uid');
        }
      }
    }

    // targets
    UI.targets = computeTargets();
    if (UI.sel) {
      if (UI.sel.kind === 'card' && UI.sel.card.type === 'MONSTER') {
        for (const s of g.freeSlots(me)) slotEl(me, s) && slotEl(me, s).classList.add('valid');
      } else {
        for (const t of UI.targets) {
          if (t.player) continue;
          const side = sideIdx(t.side);
          const slot = slotEl(side, t.slot);
          if (!slot) continue;
          slot.classList.add(t.side === 'own' ? 'friendly-target' : 'attack-target');
        }
        for (const t of UI.targets) {
          if (t.empty) slotEl(me, t.slot) && slotEl(me, t.slot).classList.add('valid');
        }
      }
    }

    // tabs + hand
    renderTabs();
    renderHand();

    // end turn
    const btn = $('#btn-end');
    btn.disabled = !isMyTurn() || UI.busy;
    btn.classList.toggle('ready', isMyTurn() && !UI.busy && p.cardPlayed);

    // hint
    const hint = $('#hand-hint');
    if (UI.busy) hint.textContent = (UI.mode === 'single' && g.active === 1) ? '对手正在思考…' : '结算中…';
    else if (!isMyTurn()) hint.textContent = UI.mode === 'duo' ? ('玩家 ' + (g.active + 1) + ' 的回合') : '敌方回合';
    else if (p.cardPlayed) hint.textContent = '已打出卡牌——仍可使用施法能力';
    else if (UI.sel && UI.sel.kind === 'card') {
      if (UI.sel.card.type === 'MONSTER') hint.textContent = '已选 ' + UI.sel.card.name + ' · 点击空槽放置';
      else if (UI.sel.spec && UI.sel.spec.type === 'none') hint.textContent = '已选 ' + UI.sel.card.name + ' · 点击施放';
      else hint.textContent = '已选 ' + UI.sel.card.name + ' · 选择目标';
    } else if (UI.sel && UI.sel.kind === 'ability') hint.textContent = '施法：' + UI.sel.name + ' · 选择目标';
    else hint.textContent = isMobile() ? '点击元素，选择可放置的卡牌。' : '选择元素，然后打出一张牌。';

    // cast prompt
    renderCastPrompt();
    syncLog();
    if (isMobile() && !$('#mobile-picker').classList.contains('hidden')) renderMobilePicker();
    scheduleFxScale();
  }

  function renderTabs() {
    const g = UI.g, p = g.player(meId());
    for (const el of ELEMENTS) {
      const tab = $('.etab[data-el="' + el + '"]');
      if (!tab) continue;
      const entries = p.deck.filter(d => d.card.element === el);
      const unused = entries.length;
      tab.querySelector('b').textContent = p.mana[el];
      tab.querySelector('i').textContent = unused + '/' + entries.length;
      tab.classList.toggle('active', UI.el === el);
      tab.classList.toggle('empty', unused === 0);
    }
  }

  /* ------------------------------------------------------------ 拖拽出牌 */
  // 拖动只负责“把牌扔到目标上”，点击选中那套流程完全保留。
  // 移动距离小于阈值时不算拖拽，交给原来的 click 处理。
  let dragState = null;
  let suppressCardClickUntil = 0;
  const DRAG_THRESHOLD = 9;

  function dragPlanFor(card) {
    const g = UI.g, me = meId(), p = g.player(me);
    if (!card) return null;
    if (card.type === 'MONSTER') {
      const slots = g.freeSlots(me).map(s => ({ side: me, slot: s }));
      return slots.length ? { kind: 'monster', slots } : null;
    }
    const spec = g.getSpellSpec(p, card);
    if (!spec || spec.type === 'none') return null;      // 无目标法术走“施放”按钮
    const targets = g.validTargets(p, spec);
    return targets.length ? { kind: 'spell', spec, targets } : null;
  }

  function planSlotMatches(plan, side, slot) {
    if (!plan) return false;
    if (plan.kind === 'monster') return plan.slots.some(x => x.side === side && x.slot === slot);
    return !!plan.targets.find(t => !t.player && sideIdx(t.side) === side && t.slot === slot);
  }

  function paintPlanSlots(plan, on) {
    if (!plan) return;
    const list = plan.kind === 'monster'
      ? plan.slots.map(x => ({ side: x.side, slot: x.slot }))
      : plan.targets.filter(t => !t.player).map(t => ({ side: sideIdx(t.side), slot: t.slot }));
    for (const it of list) {
      const el = slotEl(it.side, it.slot);
      if (!el) continue;
      el.classList.toggle('valid', on);
    }
  }

  function startCardDrag(ev, node, card) {
    if (UI.busy || dragState) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (!isMyTurn()) return;
    const p = player();
    const entry = p.deck.find(d => d.card.id === card.id);
    if (!entry) return;
    if (!entryState(p, entry).ok) return;      // 打不出去的牌不做拖拽
    const plan = dragPlanFor(card);
    if (!plan) return;

    // 上一张牌的选中态让位给这次拖拽（不 render，否则会重建正在拖的节点）
    UI.sel = null;
    dragState = {
      card, entry, plan, node,
      startX: ev.clientX, startY: ev.clientY,
      lastX: ev.clientX, lastY: ev.clientY,
      moved: false, ghost: null, hover: null
    };
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('pointercancel', onDragCancel);
  }

  function makeDragGhost() {
    const st = dragState;
    if (!st || st.ghost) return;
    const g = UI.g, p = player();
    const cost = st.card.type === 'SPELL' ? g.spellCost(p, st.card) : st.card.level;
    const r = st.node.getBoundingClientRect();
    const ghost = cardNode(st.card, { kind: 'hand', cost });
    ghost.classList.add('drag-ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.left = st.lastX + 'px';
    ghost.style.top = st.lastY + 'px';
    document.body.appendChild(ghost);
    st.ghost = ghost;
    st.node.classList.add('drag-source');
    paintPlanSlots(st.plan, true);
  }

  function clearDragHover() {
    if (!dragState || !dragState.hover) return;
    dragState.hover.classList.remove('drag-over', 'bad');
    dragState.hover = null;
  }

  function updateDragHover(x, y) {
    if (!dragState) return;
    const el = document.elementFromPoint(x, y);
    const slot = el && el.closest ? el.closest('.slot') : null;
    if (slot === dragState.hover) return;
    clearDragHover();
    if (!slot) return;
    const side = parseInt(slot.dataset.side, 10);
    const idx = parseInt(slot.dataset.slot, 10);
    slot.classList.add('drag-over');
    if (!planSlotMatches(dragState.plan, side, idx)) slot.classList.add('bad');
    dragState.hover = slot;
  }

  function onDragMove(ev) {
    const st = dragState;
    if (!st) return;
    st.lastX = ev.clientX;
    st.lastY = ev.clientY;
    if (!st.moved) {
      if (Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY) < DRAG_THRESHOLD) return;
      st.moved = true;
      makeDragGhost();
    }
    if (ev.cancelable) ev.preventDefault();
    if (st.ghost) {
      st.ghost.style.left = ev.clientX + 'px';
      st.ghost.style.top = ev.clientY + 'px';
    }
    updateDragHover(ev.clientX, ev.clientY);
  }

  function endDragListeners() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('pointercancel', onDragCancel);
  }

  function onDragCancel() {
    const st = dragState;
    if (!st) return;
    endDragListeners();
    clearDragHover();
    dragState = null;
    if (st.ghost) st.ghost.remove();
    paintPlanSlots(st.plan, false);
    render();
  }

  function onDragUp() {
    const st = dragState;
    if (!st) return;
    endDragListeners();
    dragState = null;

    if (!st.moved) return;                 // 没有移动：当成普通点击，让 click 继续走
    suppressCardClickUntil = Date.now() + 400;

    const hovered = st.hover;
    const plan = st.plan;
    const side = hovered ? parseInt(hovered.dataset.side, 10) : -1;
    const idx = hovered ? parseInt(hovered.dataset.slot, 10) : -1;
    const ok = !!hovered && planSlotMatches(plan, side, idx);

    clearDragHover();
    paintPlanSlots(plan, false);

    if (!ok) {
      // 没落到合法位置：飞回手牌
      const ghost = st.ghost;
      const r = st.node && st.node.isConnected ? st.node.getBoundingClientRect() : null;
      if (ghost && r && r.width) {
        ghost.style.transition = 'left .18s ease, top .18s ease, opacity .18s ease';
        ghost.style.left = (r.left + r.width / 2) + 'px';
        ghost.style.top = (r.top + r.height / 2) + 'px';
        ghost.style.opacity = '0';
        setTimeout(() => { ghost.remove(); render(); }, 200);
      } else {
        if (ghost) ghost.remove();
        render();
      }
      return;
    }

    if (st.ghost) st.ghost.remove();
    if (plan.kind === 'monster') {
      playMonster(st.card, idx);
      return;
    }
    const t = plan.targets.find(x => !x.player && sideIdx(x.side) === side && x.slot === idx);
    if (!t) { render(); return; }
    UI.sel = { kind: 'card', card: st.card, entry: st.entry, spec: plan.spec };
    resolveTarget(t);
  }

  /* --------------------------------------------------------------- hand */
  function renderHand() {
    const g = UI.g, p = g.player(meId());
    const row = $('#hand-row');
    row.innerHTML = '';
    const entries = p.deck.filter(d => d.card.element === UI.el);
    entries.sort((a, b) => a.card.level - b.card.level);
    if (!entries.length) {
      row.appendChild(h('div', 'hand-empty', '该元素没有卡牌。'));
      return;
    }
    for (const entry of entries) {
      const card = entry.card;
      const cost = card.type === 'SPELL' ? g.spellCost(p, card) : card.level;
      const node = cardNode(card, { kind: 'hand', cost });
      const unaffordable = p.mana[card.element] < cost;

      if (p.cardPlayed || !isMyTurn()) node.classList.add('locked');
      else if (unaffordable) node.classList.add('unaffordable');
      if (UI.sel && UI.sel.kind === 'card' && UI.sel.card.id === card.id) node.classList.add('selected');
      node.addEventListener('pointerdown', ev => startCardDrag(ev, node, card));
      node.addEventListener('click', () => onHandCard(card));
      row.appendChild(node);
    }
  }

  function renderCastPrompt() {
    const old = $('#cast-prompt');
    if (old) old.remove();
    if (!UI.sel || UI.sel.kind !== 'card' || UI.sel.card.type !== 'SPELL') return;
    const spec = UI.sel.spec;
    if (!spec || spec.type !== 'none') return;
    const prompt = h('div', 'cast-prompt');
    prompt.id = 'cast-prompt';
    prompt.innerHTML = '<span>' + UI.sel.card.name + '</span>' +
      '<button class="gold-btn small" id="btn-cast">施放</button>' +
      '<button class="ghost-btn" id="btn-cancel">取消</button>';
    $('#hand-area').appendChild(prompt);
    $('#btn-cast').addEventListener('click', () => doCastSelected());
    $('#btn-cancel').addEventListener('click', () => { UI.sel = null; render(); });
  }

  /* --------------------------------------------------------------- targets */
  function computeTargets() {
    if (!UI.sel || !UI.g) return [];
    const g = UI.g, p = g.player(meId());
    if (UI.sel.kind === 'card') {
      if (UI.sel.card.type === 'MONSTER') return [];
      const spec = g.getSpellSpec(p, UI.sel.card);
      if (spec.type === 'none') return [];
      return g.validTargets(p, spec);
    }
    if (UI.sel.kind === 'ability') {
      if (UI.sel.spec.type === 'none') return [];
      return g.validTargets(p, UI.sel.spec, UI.sel.creature);
    }
    return [];
  }

  function targetAt(side, slot) {
    return UI.targets.find(t => !t.player && sideIdx(t.side) === side && t.slot === slot && (!t.empty || !UI.g.creatureAt(side, slot)));
  }

  /* --------------------------------------------------------------- interactions */
  function onHandCard(card) {
    if (Date.now() < suppressCardClickUntil) return;   // 刚刚拖拽过，别把落点当成点击
    if (UI.busy) return;
    if (!isMyTurn()) { toast('还没轮到你'); return; }
    const p = player();
    if (p.cardPlayed) { toast('每回合只能打出一张卡'); return; }
    const entry = p.deck.find(d => d.card.id === card.id);
    if (!entry) { toast('这张卡不可用'); return; }
    const cost = card.type === 'SPELL' ? UI.g.spellCost(p, card) : card.level;
    if (p.mana[card.element] < cost) { toast(LABEL[card.element] + '元素不足'); return; }

    if (UI.sel && UI.sel.kind === 'card' && UI.sel.card.id === card.id) {
      if (card.type === 'SPELL') {
        const spec = UI.g.getSpellSpec(p, card);
        if (spec.type === 'none') { doCastSelected(); return; }
      }
      UI.sel = null; render(); return;
    }
    UI.sel = null;
    if (card.type === 'MONSTER') {
      UI.sel = { kind: 'card', card, entry };
      if (!UI.g.freeSlots(meId()).length) { toast('没有空槽'); UI.sel = null; }
      render();
    } else {
      const spec = UI.g.getSpellSpec(p, card);
      UI.sel = { kind: 'card', card, entry, spec };
      if (spec.type === 'none') { render(); return; }
      render();
      if (!UI.targets.length) toast('没有合法目标');
    }
  }

  async function doCastSelected() {
    if (!UI.sel || UI.sel.kind !== 'card' || UI.busy) return;
    const card = UI.sel.card;
    UI.sel = null;
    UI.busy = true;
    render();
    const res = await netPlayCard(card.id, null, null);
    if (!res.ok) toast(res.reason);
    UI.busy = false;
    render();
  }

  async function onSlotClick(side, slot) {
    if (UI.busy) return;
    const g = UI.g;
    const c = g.creatureAt(side, slot);

    // resolve a pending target
    if (UI.sel) {
      const t = targetAt(side, slot);
      if (UI.sel.kind === 'card' && UI.sel.card.type === 'MONSTER') {
        if (side === meId() && !c) {
          await playMonster(UI.sel.card, slot);
          return;
        }
      } else if (t) {
        await resolveTarget(t);
        return;
      }
    }
    if (c) openCardModal(c.card, c);
  }

  async function playMonster(card, slot) {
    UI.sel = null;
    UI.busy = true;
    render();
    const res = await netPlayCard(card.id, slot, null);
    if (!res.ok) toast(res.reason);
    UI.busy = false;
    render();
  }

  async function resolveTarget(t) {
    if (UI.busy) return;
    const sel = UI.sel;
    UI.sel = null;
    UI.busy = true;
    render();
    if (sel.kind === 'card') {
      const res = await netPlayCard(sel.card.id, null, t);
      if (!res.ok) toast(res.reason);
    } else if (sel.kind === 'ability') {
      const res = await netCastAbility(sel.creature.slot, t);
      if (!res.ok) toast(res.reason);
    }
    UI.busy = false;
    render();
  }

  async function startAbility(c, spec) {
    if (!c || c.owner !== meId() || !isMyTurn()) return;
    if (spec && spec.canCast === false) { toast(spec.castReason); return; }
    closeModal();
    const g = UI.g;
    if (spec.type === 'none') {
      UI.busy = true;
      render();
      const res = await netCastAbility(c.slot, null);
      if (!res.ok) toast(res.reason);
      UI.busy = false;
      render();
      return;
    }
    UI.sel = { kind: 'ability', creature: c, spec, name: c.card.spellName };
    render();
    if (!UI.targets.length) { toast('没有合法目标'); UI.sel = null; render(); }
  }

  async function endTurn() {
    if (UI.busy || !isMyTurn()) return;
    UI.sel = null;
    UI.busy = true;
    render();
    let passTo = null;
    try {
      await netEndTurn();
      if (UI.g.winner == null && UI.mode === 'single' && UI.g.active === 1) {
        await wait(420);
        await UI.g.aiPlay();
      } else if (UI.g.winner == null && UI.mode === 'duo') {
        passTo = UI.g.active;
      }
    } finally {
      UI.busy = false;
      render();
      if (passTo != null) showPass(passTo);
    }
  }

  function showPass(id) {
    closeMobilePicker();
    UI.passPending = true;
    UI.busy = false;
    $('#pass-title').textContent = '玩家 ' + (id + 1) + ' 的回合';
    $('#pass-sub').textContent = '请把设备交给玩家 ' + (id + 1);
    $('#pass-screen').classList.remove('hidden');
    render();
  }

  function barFor(playerId) {
    return playerId === meId() ? $('#player-bar') : $('#enemy-bar');
  }

  function exportBattle() {
    const g = UI.g;
    if (!g) { toast('还没有可以导出的对局'); return; }
    const cardInfo = c => c ? {
      id: c.card.id, name: c.card.name, element: c.card.element, type: c.card.type,
      level: c.card.level, hp: c.hp, maxHp: c.maxHp, atk: UI.g.attackValue(c),
      baseAtk: c.baseAtk, atkBonus: c.atkBonus, tempAtk: c.tempAtk,
      poison: c.poison, stun: c.stun, silenced: c.silenced, sick: c.sick,
      castUsed: c.castUsed, alive: c.alive, slot: c.slot
    } : null;
    const playerInfo = p => ({
      id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp, mana: Object.assign({}, p.mana),
      cardPlayed: p.cardPlayed,
      stats: Object.assign({}, p.stats),
      board: p.board.map(cardInfo),
      deck: p.deck.map(d => ({
        id: d.card.id, name: d.card.name, element: d.card.element,
        type: d.card.type, level: d.card.level
      }))
    });
    const eventInfo = e => {
      const out = { type: e.type };
      for (const k of ['player', 'slot', 'amount', 'hp', 'maxHp', 'element', 'delta', 'kind', 'name', 'reason']) {
        if (e[k] !== undefined) out[k] = e[k];
      }
      if (e.card) out.card = { id: e.card.id, name: e.card.name, element: e.card.element, type: e.card.type, level: e.card.level };
      if (e.creature) out.creature = { id: e.creature.card.id, name: e.creature.card.name, owner: e.creature.owner, slot: e.creature.slot, hp: e.creature.hp, maxHp: e.creature.maxHp };
      if (e.target) out.target = e.target;
      if (e.targets) out.targets = e.targets.map(t => ({ side: t.side, slot: t.slot, player: !!t.player }));
      return out;
    };
    const data = {
      schema: 'orions2-battle/v1',
      app: 'Orions 2 web',
      version: '2026.10.19',
      exportedAt: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      mode: UI.mode,
      difficulty: UI.diff,
      challenge: UI.challenge,
      deckMode: UI.deckMode,
      deckMode2: UI.deckMode2,
      deckSlot: UI.deckSlot,
      deckSlot2: UI.deckSlot2,
      turn: g.turn,
      active: g.active,
      phase: g.phase,
      winner: g.winner,
      players: g.players.map(playerInfo),
      logs: g.logs.map(x => ({ turn: x.turn, kind: x.kind, seq: x.seq, who: x.who, tag: x.tag, text: x.text })),
      decisions: (g.aiDecisions || []).slice(),
      events: g.events.slice(-3000).map(eventInfo),
      errors: (g.errors || []).slice()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orions2-battle-' + data.exportedAt.replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('战报已导出');
  }
  window.exportBattle = exportBattle;

  /* --------------------------------------------------------------- log */
  // 战报渲染：按"谁"着色（我方/敌方），按类型区分字体（法术/生物），
  // 回合用整行分隔条，避免整屏同色文字。
  const LOG_ICON = {
    turn: '◆', card: '▸', spell: '✦', summon: '◈', transform: '✧',
    attack: '⚔', damage: '✸', heal: '✚', death: '☠', status: '❖',
    move: '➜', mana: '◆', win: '★', debuff: '▼', info: '·'
  };
  const CREATURE_KINDS = { summon: 1, transform: 1, attack: 1, move: 1, death: 1, status: 1, damage: 1, heal: 1 };
  function logTagOf(entry) {
    if (entry.tag === 'spell' || entry.tag === 'creature') return entry.tag;
    if (entry.kind === 'spell' || entry.kind === 'card') return 'spell';
    if (CREATURE_KINDS[entry.kind]) return 'creature';
    return '';
  }
  function logSideOf(entry) {
    return entry.who === 0 ? 'p0' : entry.who === 1 ? 'p1' : 'sys';
  }
  function logNode(entry) {
    if (entry.kind === 'turnend') {
      const row = h('div', 'lg-turnend lg-turnend-' + logSideOf(entry));
      row.innerHTML = '<i></i><span>' + (entry.text || '') + '</span>';
      return row;
    }
    if (entry.kind === 'turn') {
      const wrap = h('div', 'lg-turn lg-turn-' + logSideOf(entry));
      const m = /^第 (\d+) 回合：?(.*)$/.exec(entry.text || '');
      wrap.innerHTML = '<b>' + (m ? '第 ' + m[1] + ' 回合' : '回合') + '</b>' +
        '<span>' + (m && m[2] ? m[2] : '') + '</span>';
      return wrap;
    }
    const tag = logTagOf(entry);
    const row = h('div', 'lg lg-' + logSideOf(entry) + ' lg-k-' + (entry.kind || 'info') +
      (tag ? ' lg-t-' + tag : ''));
    const ico = h('i', 'lg-ico', LOG_ICON[entry.kind] || '·');
    const txt = h('span', 'lg-txt');
    txt.textContent = entry.text;
    row.appendChild(ico);
    row.appendChild(txt);
    return row;
  }
  /* ------------------------------------------------------- log round tint */
  // Walks the rendered log and tags every row with its distance from the
  // current round: 0 = the round being played, 1 = the previous round, ...
  // The CSS turns that number into the fading gradient.
  let logPaintQueued = false;
  function paintLogRounds() {
    if (logPaintQueued) return;
    logPaintQueued = true;
    requestAnimationFrame(() => {
      logPaintQueued = false;
      const list = $('#log');
      if (!list || !list.children.length) return;
      const kids = list.children;
      let total = 0;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].classList.contains('lg-turn')) total++;
      }
      let cur = -1;
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (el.classList.contains('lg-turn')) cur++;
        // total === 0 means the log is filtered by side and has no round
        // headers: show everything, there is no "current round" to compare.
        const age = total === 0 ? 0 : (cur < 0 ? total : total - 1 - cur);
        const capped = Math.min(age, 9);
        if (el.dataset.age !== (age === 0 ? 'live' : age === 1 ? 'prev' : 'old')) {
          el.dataset.age = age === 0 ? 'live' : age === 1 ? 'prev' : 'old';
        }
        if (el.style.getPropertyValue('--age') !== String(capped)) {
          el.style.setProperty('--age', capped);
        }
      }
    });
  }

  function appendLogRows(list, entries, filter) {
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      if (filter === 'p0' || filter === 'p1') {
        if (entry.kind === 'turn') continue;
        if (logSideOf(entry) !== filter) continue;
      }
      frag.appendChild(logNode(entry));
    }
    list.appendChild(frag);
    paintLogRounds();
  }
  function syncLog() {
    const g = UI.g;
    if (!g) return;
    const log = $('#log');
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    let lastSeq = UI.logSeq || 0;
    const frag = document.createDocumentFragment();
    for (const entry of g.logs) {
      const seq = entry.seq || 0;
      if (seq <= lastSeq) continue;
      frag.appendChild(logNode(entry));
      lastSeq = seq;
    }
    log.appendChild(frag);
    UI.logSeq = lastSeq;
    while (log.children.length > 1200) log.removeChild(log.firstChild);
    if (nearBottom) log.scrollTop = log.scrollHeight;
    paintLogRounds();
  }

  /* --------------------------------------------------------------- events */
  async function onEvent(e) {
    const g = UI.g;
    if (!g) return;
    switch (e.type) {
      case 'start':
        render();
        break;
      case 'turn': {
        UI.sel = null;
        render();
        if (UI.mode === 'duo') {
          banner('玩家 ' + (e.player + 1) + ' 的回合', '第 ' + g.turn + ' 回合', false);
        } else {
          const mine = e.player === 0;
          banner(mine ? '你的回合' : '敌方回合', mine ? '第 ' + g.turn + ' 回合' : g.player(1).name + ' 行动', !mine);
        }
        play('cast2');
        await wait(420);
        break;
      }
      case 'summon': {
        render();
        const node = targetNode(e.player, e.slot);
        const color = elColor(e.creature.card.element);
        if (node) {
          node.classList.add('summon-in');
          const c = centerOf(node);
          if (c) { fxRingAt(c.x, c.y, color, 96); fxBurstAt(c.x, c.y, color, 10); }
        }
        play('cast');
        await wait(230);
        break;
      }
      case 'card': {
        render();
        fxFlash(elColor(e.card.element), 0.07);
        const bar = barFor(e.player).querySelector('.hp-track');
        const c = centerOf(bar);
        if (c) fxLabelAt(c.x, c.y - 34, '出牌', elColor(e.card.element));
        await wait(120);
        break;
      }
      case 'spell': {
        render();
        const color = elColor(e.card.element);
        const target = targetForEvent(e.player, e.target);
        const from = barFor(e.player).querySelector('.hp-track');
        if (target) {
          fxBeam(from, target, color);
          const c = centerOf(target);
          if (c) { fxRingAt(c.x, c.y, color, 86); fxBurstAt(c.x, c.y, color, 12); }
        }
        fxFlash(color, 0.2);
        if (!e.target || (!e.target.player && e.target.side === 'enemy')) {
          // All-target spells still get a broad burst across the enemy row.
          const side = 1 - e.player;
          for (let s = 0; s < 5; s++) {
            const n = targetNode(side, s);
            const c = centerOf(n);
            if (c) fxBurstAt(c.x, c.y, color, 4);
          }
        }
        play('spell');
        await wait(260);
        break;
      }
      case 'ability': {
        render();
        const color = elColor(e.creature.card.element);
        const src = targetNode(e.player, e.slot);
        const dst = targetForEvent(e.player, e.target);
        if (src) {
          const a = centerOf(src);
          if (a) fxRingAt(a.x, a.y, color, 72);
        }
        if (src && dst) fxBeam(src, dst, color);
        if (dst) {
          const b = centerOf(dst);
          if (b) { fxRingAt(b.x, b.y, color, 88); fxBurstAt(b.x, b.y, color, 10); }
        }
        if (src) {
          const a = centerOf(src);
          if (a) fxLabelAt(a.x, a.y - 34, '施法', color);
        }
        play('cast2');
        await wait(260);
        break;
      }
      case 'attack': {
        const node = slotEl(e.player, e.slot) && slotEl(e.player, e.slot).querySelector('.card');
        const color = e.creature ? elColor(e.creature.card.element) : '#f3d999';
        if (node) {
          const a0 = centerOf(node);
          // Aim the lunge at the first target instead of always hopping up.
          const first = (e.targets || [])[0];
          const firstNode = first ? targetForEvent(e.player, first) : null;
          const b0 = centerOf(firstNode);
          if (a0 && b0) {
            const dx = b0.x - a0.x, dy = b0.y - a0.y;
            const len = Math.hypot(dx, dy) || 1;
            const reach = Math.min(30, len * 0.2);
            node.style.setProperty('--tx', (dx / len * reach).toFixed(1) + 'px');
            node.style.setProperty('--ty', (dy / len * reach).toFixed(1) + 'px');
          }
          node.classList.add('attacking');
          const a = centerOf(node);
          if (a) { fxRingAt(a.x, a.y, color, 60); fxBurstAt(a.x, a.y, color, 4); }
        }
        for (const t of (e.targets || [])) {
          const target = targetForEvent(e.player, t);
          const c = centerOf(target);
          if (c) {
            burstAt(c.x, c.y);
            fxImpactAt(c.x, c.y);
            fxBurstAt(c.x, c.y, '#ffb36b', 10);
          }
        }
        fxScreenShake((e.targets || []).some(t => t.player) ? 2 : 1);
        play('attack');
        await wait(300);
        break;
      }
      case 'damage': {
        render();
        const dmgColor = e.kind === 'poison' ? '#9ee06a' : (e.kind === 'spell' ? '#ff9a72' : '#ff6b4a');
        const heavy = e.amount >= 8;
        if (e.playerHit) {
          const bar = barFor(e.player);
          const r = rectOf(bar.querySelector('.hp-track'));
          if (r) {
            floatText(r.left + r.width / 2, r.top + r.height / 2, '-' + e.amount, 'dmg', heavy);
            fxRingAt(r.left + r.width / 2, r.top + r.height / 2, dmgColor, heavy ? 96 : 74);
            fxBurstAt(r.left + r.width / 2, r.top + r.height / 2, dmgColor, heavy ? 16 : 10);
            fxImpactAt(r.left + r.width / 2, r.top + r.height / 2);
          }
          bar.classList.add('shake');
          setTimeout(() => bar.classList.remove('shake'), 460);
          fxFlash(dmgColor, heavy ? 0.2 : 0.12);
          fxScreenShake(heavy ? 3 : 2);
          await wait(heavy ? 520 : 460);
        } else {
          const slot = slotEl(e.player, e.slot);
          const node = slot && slot.querySelector('.card');
          if (node) {
            node.classList.add('hit');
            const r = rectOf(node);
            if (r) {
              const cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
              floatText(cx, cy, '-' + e.amount, 'dmg', heavy);
              fxRingAt(cx, cy, dmgColor, heavy ? 82 : 64);
              fxBurstAt(cx, cy, dmgColor, heavy ? 12 : 7);
              fxImpactAt(cx, cy);
            }
            fxScreenShake(heavy ? 2 : 1);
          }
          await wait(heavy ? 470 : 430);
        }
        break;
      }
      case 'heal': {
        render();
        const HEAL = '#ffd76a';
        if (e.playerHit || e.playerHeal) {
          const bar = barFor(e.player);
          const track = bar && bar.querySelector('.hp-track');
          const r = rectOf(track);
          if (r) {
            floatText(r.left + r.width / 2, r.top + r.height / 2, '+' + e.amount, 'heal');
            fxHealAt(r.left + r.width / 2, r.top + r.height / 2, 54, 14);
          }
          if (track) {
            track.classList.remove('healing');
            void track.offsetWidth;
            track.classList.add('healing');
            setTimeout(() => track.classList.remove('healing'), 620);
          }
          fxFlash(HEAL, 0.1);
        } else {
          const slot = slotEl(e.player, e.slot);
          const node = slot && slot.querySelector('.card');
          if (node) {
            node.classList.remove('healed');
            void node.offsetWidth;
            node.classList.add('healed');
            const r = rectOf(node);
            if (r) {
              const cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
              floatText(cx, cy, '+' + e.amount, 'heal');
              fxHealAt(cx, cy, 46, 11);
            }
          }
        }
        await wait(420);
        break;
      }
      case 'death': {
        if (UI.sel && UI.sel.creature && UI.sel.creature.uid === e.creature.uid) UI.sel = null;
        const slot = slotEl(e.player, e.slot);
        const node = slot && slot.querySelector('.card');
        const r = rectOf(node);
        let clone = null;
        if (node) {
          clone = node.cloneNode(true);
          clone.style.position = 'fixed';
          clone.style.left = r.left + 'px';
          clone.style.top = r.top + 'px';
          clone.style.width = r.width + 'px';
          clone.style.height = r.height + 'px';
          clone.style.zIndex = '45';
          clone.style.pointerEvents = 'none';
          clone.classList.add('dying');
          $('#fx-layer').appendChild(clone);
          const c = centerOf(node);
          if (c) {
            fxRingAt(c.x, c.y, elColor(e.creature.card.element), 118);
            fxBurstAt(c.x, c.y, elColor(e.creature.card.element), 18);
            fxShatterAt(c.x, c.y, 12);
            fxImpactAt(c.x, c.y);
            fxLabelAt(c.x, c.y - 22, '消灭', '#c9a7ff');
          }
          fxScreenShake(2);
          fxFlash(elColor(e.creature.card.element), 0.16);
        }
        render();
        play('die');
        await wait(520);
        if (clone) clone.remove();
        break;
      }
      case 'deathDone':
        render();
        break;
      case 'mana': {
        render();
        if (e.delta) {
          const bar = barFor(e.player);
          const icon = bar && bar.querySelector('.mana[data-el="' + e.element + '"]');
          if (icon) {
            icon.classList.remove('pulse');
            void icon.offsetWidth;
            icon.classList.add('pulse');
            const c = centerOf(icon);
            if (c) {
              fxLabelAt(c.x, c.y - 10, (e.delta > 0 ? '+' : '') + e.delta + ' ' + LABEL[e.element],
                e.delta > 0 ? elColor(e.element) : '#ff8b6b');
              if (e.delta > 0) fxBurstAt(c.x, c.y, elColor(e.element), 4);
            }
          }
        }
        break;
      }
      case 'buff': {
        render();
        const node = targetNode(e.player, e.slot);
        const color = e.kind === 'poison' ? '#9ee06a' : (e.kind === 'atk' ? '#ffb36b' : '#f3d999');
        if (node) {
          const c = centerOf(node);
          if (c) fxRingAt(c.x, c.y, color, 70);
          let text = '强化';
          if (e.kind === 'atk') text = (e.amount > 0 ? '+' : '') + e.amount + ' 攻击';
          else if (e.kind === 'maxhp') text = (e.amount > 0 ? '+' : '') + e.amount + ' 最大生命';
          else if (e.kind === 'poison') text = '中毒 +' + e.amount;
          else if (e.kind === 'silence') text = '沉默';
          else if (e.kind === 'airshield') text = '空气护盾';
          else if (e.kind === 'stoneskin') text = '石肤';
          if (c) fxLabelAt(c.x, c.y - 28, text, color);
        }
        break;
      }
      case 'cleanse': {
        render();
        const node = targetNode(e.player, e.slot);
        if (node) {
          const c = centerOf(node);
          if (c) { fxRingAt(c.x, c.y, '#e8f7ff', 82); fxLabelAt(c.x, c.y - 28, '净化', '#e8f7ff'); }
        }
        break;
      }
      case 'polymorph': {
        render();
        const node = targetNode(e.player, e.slot);
        if (node) { const c = centerOf(node); if (c) { fxFlash('#b58cff', 0.14); fxRingAt(c.x, c.y, '#b58cff', 92); } }
        break;
      }
      case 'move': {
        render();
        const node = targetNode(e.player, e.slot);
        if (node) { const c = centerOf(node); if (c) fxBurstAt(c.x, c.y, '#a9e8ff', 6); }
        break;
      }
      case 'skip':
      case 'skipattack':
      case 'sick': {
        render();
        const node = targetNode(e.player, e.slot);
        if (node) {
          const c = centerOf(node);
          const text = e.type === 'sick' ? '召唤失调' : (e.type === 'skip' ? '跳过攻击' : '无法攻击');
          if (c) fxLabelAt(c.x, c.y - 24, text, '#c9b48e');
        }
        break;
      }
      case 'aiThinking':
        render();
        break;
      case 'endturn':
        render();
        if (e.skipCombat) {
          banner('跳过战斗', '本回合无法行动', true);
          await wait(260);
        } else {
          banner('战斗阶段', '生物将依次攻击', false);
          play('attack');
          await wait(360);
        }
        break;
      case 'win': {
        render();
        const won = e.player === meId();
        const tint = won ? '#f3d999' : '#c9645a';
        fxVictory(won);
        fxFlash(tint, 0.28);
        fxScreenShake(2);
        // 棋盘上的生物依次炸开，像被胜利的冲击波扫过
        let idx = 0;
        for (const side of [0, 1]) {
          for (let s = 0; s < 5; s++) {
            const n = targetNode(side, s);
            const c = centerOf(n);
            if (!c) continue;
            const delay = 60 * idx++;
            setTimeout(() => {
              fxBurstAt(c.x, c.y, tint, 7);
              fxRingAt(c.x, c.y, tint, 58);
            }, delay);
          }
        }
        play('cast2');
        await wait(980);
        showEnd(e.player === 0);
        break;
      }
    }
  }

  function banner(big, small, foe) {
    $$('.turn-banner').forEach(n => n.remove());
    const n = h('div', 'turn-banner' + (foe ? ' foe' : ''));
    n.innerHTML = '<b>' + big + '</b><span>' + (small || '') + '</span>';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1550);
  }

  /* --------------------------------------------------------------- modal */
  function openModal(html, keepReturn) {
    hideCardTip();
    closeMobilePicker();
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
    if (!keepReturn) UI.modalReturn = null;
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    // A card opened from the codex returns to the codex at the same position.
    if (UI.modalReturn === 'codex') {
      UI.modalReturn = null;
      openCodex(UI.codexFilter || 'all');
    }
  }

  function openCardModal(card, creature) {
    const modalReturn = UI.modalReturn;
    const g = UI.g;
    const p = g ? g.player(meId()) : null;
    const isFriendly = creature && creature.owner === meId();
    const inHand = !creature;
    const cost = p ? (card.type === 'SPELL' ? g.spellCost(p, card) : card.level) : card.level;
    const hpNow = creature ? fmt(creature.hp) + ' / ' + creature.maxHp : (card.hpVar ? '变动' : card.hp);
    const atkNow = creature ? g.attackValue(creature) : (card.atkVar ? '变动' : card.atk);
    const rawSpec = creature && isFriendly && isMyTurn() ? g.getAbilitySpec(creature) : null;
    const canAfford = rawSpec && (card.id === 'lich' || !rawSpec.cost || !rawSpec.cost.amount
      || (rawSpec.cost.element === 'all'
        ? ELEMENTS.every(el => p && p.mana[el] >= rawSpec.cost.amount)
        : (p && p.mana[rawSpec.cost.element] >= rawSpec.cost.amount)));
    const hasTargets = !rawSpec || rawSpec.type === 'none'
      || (!!g && !!p && g.validTargets(p, rawSpec, creature).length > 0);
    const cloudTax = !!(rawSpec && rawSpec.surcharge && !canAfford);
    const canCast = !!(rawSpec && (canAfford || cloudTax) && rawSpec.canCast !== false && hasTargets);
    const spec = rawSpec;
    const ccAmount = spec && spec.cost ? spec.cost.amount : (card.castCost || 0);
    const ccElement = spec && spec.cost ? spec.cost.element : (card.castElement || card.element);
    const castCost = ccElement === 'all' ? '每系 ' + ccAmount + ' 点' : (ccAmount ? ccAmount + ' ' + LABEL[ccElement] : '免费');

    let html = '<div class="mc-grid">';
    html += '<div class="mc-art"><img src="' + card.bigimg + '" alt="">' +
      '<div class="mc-stats">' +
      '<div><b>' + card.level + '</b>费用</div>' +
      '<div><b>' + atkNow + '</b>攻击</div>' +
      '<div><b>' + hpNow + '</b>生命</div>' +
      '</div></div>';
    html += '<div class="mc-info">';
    html += '<div class="mc-head"><h3>' + card.name + '</h3><div class="mc-sub">' +
      LABEL[card.element] + ' · ' + (card.type === 'MONSTER' ? '生物' : '法术') +
      (card.caster ? ' · 施法者' : '') + '</div></div>';
    if (card.ability) {
      html += '<div class="mc-label">能力</div><div class="mc-text">' + zhA(card) + '</div>';
    }
    if (card.spell && card.caster) {
      html += '<div class="mc-rule"></div><div class="mc-label">施法 · ' +
        (card.spellName || '法术') + ' · ' + castCost + '</div><div class="mc-text">' + zhS(card) + '</div>';
    }
    if (card.type === 'SPELL') {
      html += '<div class="mc-rule"></div><div class="mc-label">施法费用 · ' + cost + ' ' + LABEL[card.element] + '</div>';
      if (card.spell) html += '<div class="mc-text">' + zhS(card) + '</div>';
    }
    if (['chain-lightning', 'steal-life', 'fire-burst', 'rejuvenation'].includes(card.id)) {
      html += '<div class="mc-note">结算顺序：先按当前元素结算效果，再支付卡牌费用。</div>';
    } else if (card.id === 'raise-dead') {
      html += '<div class="mc-note">结算顺序：先支付费用，再按剩余死元素召唤骷髅。</div>';
    }
    if (rawSpec && rawSpec.canCast === false) {
      html += '<div class="mc-note warn">' + rawSpec.castReason + '</div>';
    } else if (cloudTax) {
      html += '<div class="mc-note warn">元素不足：对面 Astral Cloud 使费用 +3；强行施放会受到 3 点伤害。</div>';
    }
    html += '<div class="mc-actions">';
    if (canCast) html += '<button class="gold-btn small" id="mc-cast">施放能力</button>';
    const owned = inHand && p && p.deck.some(d => d.card.id === card.id);
    if (owned && isMyTurn() && p && !p.cardPlayed) html += '<button class="gold-btn small" id="mc-play">选择卡牌</button>';
    html += '<button class="ghost-btn" id="mc-close2">关闭</button></div>';
    html += '</div></div>';
    openModal(html, modalReturn === 'codex');
    UI.modalReturn = modalReturn;
    if (canCast) {
      $('#mc-cast').addEventListener('click', () => startAbility(creature, spec));
    }
    if (owned && isMyTurn() && p && !p.cardPlayed) {
      $('#mc-play').addEventListener('click', () => { closeModal(); onHandCard(card); });
    }
    $('#mc-close2').addEventListener('click', closeModal);
  }

  const CHALLENGES = {
    none: '经典 24 张随机卡组决斗。',
    'fire-ice': '你只能使用火与死；对手只能使用水与风。',
    'forbidden-spells': '所有法术的费用翻倍。',
    'mana-pool': '双方每回合每系恢复 2 点元素。',
    'cursed-fields': '每回合开始时，所有生物受到 3 点魔法伤害。',
    sandstorm: '每回合开始时，双方各受到 5 点伤害。',
    guardians: '对手开局场上已有一个火系和一个水系强力生物。',
    'random-flow': '每回合获得共 6 点元素，但元素分配随机。',
    'sudden-death': '你以 9 点生命开始；对手以 100 点生命开始。',
    leverage: '你开局有 Leviathan；对手开局有两个 Knight。'
  };

  function openRules() {
    openModal(
      '<div class="mc-head"><h3>决斗规则</h3><div class="mc-sub">Orions 2：卡牌大师 · 116 张卡</div></div>' +
      '<div class="mc-rule"></div>' +
      '<div class="mc-text">' +
      '<p><b>目标。</b>把敌方卡牌大师的生命打到 0。法师的生命<b>没有上限</b>，治疗可以把生命抬到初始值以上。</p>' +
      '<p><b>元素。</b>火、水、风、土、生、死六系。开局每系随机 1–5 点（共 25 点），之后每个自己的回合开始时<b>每系 +1</b>。</p>' +
      '<p><b>卡牌。</b>决斗卡组 24 张，每系最多 5 张，<b>同一张卡只能放 1 张</b>。卡牌不会消耗：只要元素足够，同一张卡可以在不同回合反复使用；每回合仍然只能打出一张卡。打出卡牌需要支付它在对应元素上的费用。</p>' +
      '<p><b>元素结算顺序。</b>Chain Lightning、Steal Life、Fire Burst、Rejuvenation 都是<b>先按当前元素结算，再支付卡牌费用</b>；例如 Chain Lightning 9 费在 15 风时先造成 15 点伤害，再扣到 6 风。Raise Dead 是例外：它明确按<b>施法后剩余死元素</b>召唤骷髅。</p>' +
      '<p><b>你的回合。</b>打出<b>一张卡</b>——生物放进五个槽位之一，法术立即结算。你也可以使用任意数量生物的<b>施法</b>能力，支付费用，每个生物每回合一次（卡牌另有说明的除外）。</p>' +
      '<p><b>结算时机。</b>法术、施法能力和召唤效果都是<b>即时结算</b>：打出/施放的瞬间就改变场面和生命。只有<b>生物攻击</b>发生在结束回合后的“战斗阶段”，由左到右依次结算；此时对面为空才攻击敌方法师。当回合召唤的生物不能攻击（卡牌另有说明的除外），默认没有反击。</p>' +
      '<p><b>自定义决斗。</b>开始界面可选原版 Orions 2 的特殊规则：冰与火、禁咒、魔力之池、诅咒之地、沙暴、守护者、乱流、猝死、压制。也可以使用<b>自组卡组</b>（24 张、每系最多 5 张、同名卡只能 1 张）或从 116 张共享牌池进行<b>轮抽</b>：双方按 1-2-2-1 的蛇形顺序轮流选卡，各选 24 张。</p>' +
      '<p><b>双人同屏。</b>两名玩家轮流操作；轮到谁，画面下方的生命、元素和手牌就切换为谁。把设备交给对方后点击“继续”。开局时玩家 1 和玩家 2 可以各自选择随机卡组或不同的自组卡组。</p>' +
      '<p><b>操作。</b>点元素页签 → 点卡牌 → 点空槽或目标。点自己的生物查看卡牌并使用施法能力；生物卡上的<b>施法</b>按钮会直接进入施法。 <b>空格</b>结束回合，<b>Esc</b>取消。</p>' +
      '</div><div class="mc-actions"><button class="ghost-btn" id="rules-close">关闭</button></div>'
    );
    $('#rules-close').addEventListener('click', closeModal);
  }

  function openCodex(filter) {
    filter = filter || 'all';
    UI.codexFilter = filter;
    // Restore the reader's position: switching tabs or coming back from a card
    // detail must not jump the grid back to the top.
    const prevGrid = document.querySelector('#modal-body .codex-grid');
    const keepScroll = prevGrid ? prevGrid.scrollTop : (UI.codexScroll || 0);
    const anchorId = UI.codexAnchor || null;
    const list = window.CARDS.filter(c => filter === 'all' || c.element === filter);
    let html = '<div class="mc-head"><h3>卡牌图鉴</h3><div class="mc-sub">共 ' + window.CARDS.length + ' 张 · 点击查看</div></div>';
    html += '<div class="codex-tabs">';
    ['all'].concat(ELEMENTS).forEach(el => {
      html += '<button class="codex-tab' + (el === filter ? ' active' : '') + '" data-filter="' + el + '">' +
        (el === 'all' ? '全部' : LABEL[el]) + '</button>';
    });
    html += '</div><div class="codex-grid">';
    for (const c of list) {
      html += '<div class="codex-cell" data-id="' + c.id + '">' +
        '<img src="' + c.img + '" alt=""><span>' + c.name + '</span><i>' + c.level + '</i></div>';
    }
    html += '</div>';
    openModal(html);
    const grid = document.querySelector('#modal-body .codex-grid');
    if (grid) {
      grid.scrollTop = keepScroll;
      if (anchorId) {
        const cell = grid.querySelector('[data-id="' + anchorId + '"]');
        if (cell) {
          const gr = grid.getBoundingClientRect();
          const cr = cell.getBoundingClientRect();
          if (cr.top < gr.top + 4 || cr.bottom > gr.bottom - 4) grid.scrollTop += cr.top - gr.top - 10;
        }
      }
      grid.addEventListener('scroll', () => { UI.codexScroll = grid.scrollTop; });
    }
    UI.codexAnchor = null;
    $$('.codex-tab').forEach(b => b.addEventListener('click', () => {
      UI.codexAnchor = null;
      UI.codexScroll = 0;
      openCodex(b.dataset.filter);
    }));
    $$('.codex-cell').forEach(cell => cell.addEventListener('click', () => {
      UI.modalReturn = 'codex';
      UI.codexAnchor = cell.dataset.id;
      openCardModal(cardById(cell.dataset.id), null);
    }));
  }

  function emptyDecks() {
    return Array.from({ length: DECK_SLOTS }, (_, i) => ({ name: '卡组 ' + (i + 1), ids: [] }));
  }

  function deckCounts(ids) {
    const c = {};
    ELEMENTS.forEach(e => { c[e] = 0; });
    ids.forEach(id => { const card = cardById(id); if (card) c[card.element]++; });
    return c;
  }

  function validDeckIds(ids) {
    if (!Array.isArray(ids) || ids.length !== 24) return false;
    if (new Set(ids).size !== 24) return false;
    if (ids.some(id => !cardById(id))) return false;
    const counts = deckCounts(ids);
    return ELEMENTS.every(e => counts[e] <= DECK_MAX_PER_ELEMENT);
  }

  function saveCustomDecks() {
    try { localStorage.setItem('orions2decks', JSON.stringify(UI.customDecks)); } catch (e) {}
  }

  function loadCustomDecks() {
    const decks = emptyDecks();
    try {
      const raw = localStorage.getItem('orions2decks');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (let i = 0; i < DECK_SLOTS && i < arr.length; i++) {
            const d = arr[i];
            if (d && Array.isArray(d.ids) && validDeckIds(d.ids)) {
              decks[i] = { name: String(d.name || ('卡组 ' + (i + 1))).slice(0, 12), ids: d.ids.slice() };
            }
          }
        }
      } else {
        const old = localStorage.getItem('orions2deck');
        if (old) {
          const ids = JSON.parse(old);
          if (validDeckIds(ids)) decks[0] = { name: '卡组 1', ids: ids.slice() };
        }
      }
    } catch (e) {}
    UI.customDecks = decks;
  }

  function updateModeUI() {
    const lan = UI.mode === 'lan';
    $$('#mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === UI.mode));
    $('#mode-desc').textContent = lan
      ? '两台设备在同一局域网对战'
      : (UI.mode === 'duo' ? '两名玩家轮流操作，共用一台设备' : '你 vs 电脑');
    const diff = $('#difficulty');
    if (diff) {
      diff.classList.toggle('disabled', UI.mode === 'duo' || lan);
      diff.parentElement && diff.parentElement.classList.toggle('disabled', UI.mode === 'duo' || lan);
    }
    const p2 = $('#p2-deck-row');
    if (p2) p2.classList.toggle('hidden', UI.mode !== 'duo' || UI.deckMode === 'draft');
    $('#lan-panel').classList.toggle('hidden', !lan);
    $('#btn-start').classList.toggle('hidden', lan);
    if (!lan) {
      $('#p0-deck-row').classList.remove('hidden');
    } else if (UI.lan.role === 'guest') {
      $('#p0-deck-row').classList.add('hidden');
    }
    updateDeckModeUI();
  }

  function updateDeckSelect(select, slot) {
    if (!select) return;
    select.innerHTML = '';
    UI.customDecks.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = d.name + ' · ' + d.ids.length + '/24';
      select.appendChild(o);
    });
    select.value = String(slot);
  }

  function deckPreviewHtml(d) {
    const ids = (d && d.ids) || [];
    const counts = deckCounts(ids);
    const ok = validDeckIds(ids);
    const chips = ELEMENTS.map(e => '<span class="dpv-chip el-' + e + (counts[e] ? '' : ' zero') + '">' +
      LABEL[e] + '<b>' + counts[e] + '</b></span>').join('');
    return '<b class="dpv-name">' + ((d && d.name) || '卡组') + '</b>' + chips +
      '<span class="dpv-state ' + (ok ? 'ok' : 'bad') + '">' +
      (ok ? '24 / 24 · 可以开战' : '不可用 · ' + ids.length + '/24') + '</span>';
  }

  function updateDeckPreview(el, mode, slot) {
    if (!el) return;
    if (mode !== 'custom') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = deckPreviewHtml(UI.customDecks[slot] || { name: '卡组', ids: [] });
  }

  function updateDeckModeUI() {
    $$('#deck-mode button').forEach(b => b.classList.toggle('active', b.dataset.deck === UI.deckMode));
    $$('#deck-mode2 button').forEach(b => b.classList.toggle('active', b.dataset.deck === UI.deckMode2));
    const d0 = UI.customDecks[UI.deckSlot] || { name: '卡组', ids: [] };
    const d1 = UI.customDecks[UI.deckSlot2] || { name: '卡组', ids: [] };
    const ok0 = validDeckIds(d0.ids);
    const ok1 = validDeckIds(d1.ids);
    const draftBtn = $('#deck-mode button[data-deck="draft"]');
    if (draftBtn) {
      draftBtn.disabled = UI.mode === 'lan';
      draftBtn.title = UI.mode === 'lan' ? '局域网对战使用随机或自组卡组' : '双方共享全部卡池，轮流选卡';
    }
    const p2row = $('#p2-deck-row');
    if (p2row) p2row.classList.toggle('hidden', UI.mode !== 'duo' || UI.deckMode === 'draft');
    updateDeckPreview($('#deck-preview'), UI.deckMode, UI.deckSlot);
    const pv2 = $('#deck-preview2');
    if (pv2) {
      if (UI.mode !== 'duo' || UI.deckMode === 'draft') pv2.classList.add('hidden');
      else updateDeckPreview(pv2, UI.deckMode2, UI.deckSlot2);
    }
    $('#deck-desc').textContent = UI.deckMode === 'custom'
      ? (ok0 ? '自组：' + d0.name + ' · 24 张' : (d0.name + '：卡组未完成，点“编辑卡组”'))
      : (UI.deckMode === 'draft'
        ? '轮抽：116 张共享牌池，双方轮流选 24 张（蛇形顺序）。'
        : '24 张随机卡牌，每系 4 张，同一套内不重复。');
    $('#deck-desc2').textContent = UI.deckMode2 === 'custom'
      ? (ok1 ? '自组：' + d1.name + ' · 24 张' : (d1.name + '：卡组未完成，点“编辑卡组”'))
      : '玩家 2 使用随机卡组。';
    const s0 = $('#deck-select');
    const s1 = $('#deck-select2');
    updateDeckSelect(s0, UI.deckSlot);
    updateDeckSelect(s1, UI.deckSlot2);
    if (s0) {
      s0.classList.toggle('hidden', UI.deckMode !== 'custom');
      s0.disabled = UI.deckMode !== 'custom';
    }
    if (s1) {
      s1.classList.toggle('hidden', UI.deckMode2 !== 'custom');
      s1.disabled = UI.deckMode2 !== 'custom';
    }
    $('#deck-label').textContent = UI.mode === 'duo' ? '玩家 1 卡组' : '你的卡组';
  }

  function openDeckBuilder(filter, slot, player) {
    filter = filter || 'all';
    const modalCard = document.querySelector('.modal-card');
    const keepScroll = modalCard && !$('#modal').classList.contains('hidden') ? modalCard.scrollTop : 0;
    // The card grid is its own scroll container: rebuilding the modal used to
    // throw the reader back to the top after every pick.
    const prevGrid = document.querySelector('#modal-body .deck-grid');
    const keepGridScroll = prevGrid ? prevGrid.scrollTop : (UI.deckScroll || 0);
    const anchorId = UI.deckAnchor || null;
    if (slot != null) {
      UI.editingSlot = slot;
      UI.editingPlayer = player == null ? 0 : player;
      UI.deckDraft = (UI.customDecks[slot] ? UI.customDecks[slot].ids : []).slice();
      UI.deckAnchor = null;
      UI.deckScroll = 0;
    }
    const deck = UI.customDecks[UI.editingSlot] || { name: '卡组', ids: [] };
    const draft = UI.deckDraft;
    const counts = deckCounts(draft);
    const list = window.CARDS.filter(c => filter === 'all' || c.element === filter);
    const remain = 24 - draft.length;
    let slotOptions = '';
    UI.customDecks.forEach((d, i) => {
      slotOptions += '<option value="' + i + '"' + (i === UI.editingSlot ? ' selected' : '') + '>' +
        d.name + ' · ' + d.ids.length + '/24</option>';
    });
    let html = '<div class="mc-head"><h3>自组卡组</h3><div class="mc-sub">' +
      '24 张 · 每系最多 5 张 · 同名卡只能 1 张</div></div>';
    html += '<div class="deck-builder-top">' +
      '<label>卡组 <select id="deck-slot-select" class="deck-select">' + slotOptions + '</select></label>' +
      '<input id="deck-name" class="deck-name" maxlength="12" value="' + (deck.name || '').replace(/"/g, '&quot;') + '" placeholder="卡组名称">' +
      '<span>玩家 ' + (UI.editingPlayer + 1) + '</span></div>';
    // Sticky progress: how many cards are in, and the per-element budget.
    html += '<div class="deck-progress">' +
      '<div class="dp-count"><b>' + draft.length + '</b><span>/24</span>' +
        '<em class="' + (draft.length === 24 ? 'ok' : '') + '">' + (remain > 0 ? ('还差 ' + remain + ' 张') : '已满 24 张') + '</em></div>' +
      '<div class="dp-bar"><i style="width:' + Math.min(100, draft.length / 24 * 100) + '%"></i></div>' +
      '<div class="dp-chips">' + ELEMENTS.map(e => {
        const n = counts[e] || 0;
        return '<span class="dp-chip el-' + e + (n >= DECK_MAX_PER_ELEMENT ? ' full' : '') + '">' +
          '<img src="assets/ui/element-' + e + '.png" alt="">' + LABEL[e] +
          '<b>' + n + '</b>/' + DECK_MAX_PER_ELEMENT + '</span>';
      }).join('') + '</div></div>';
    html += '<div class="codex-tabs deck-tabs">';
    ['all'].concat(ELEMENTS).forEach(el => {
      html += '<button class="codex-tab deck-tab' + (el === filter ? ' active' : '') + '" data-filter="' + el + '">' +
        (el === 'all' ? '全部' : LABEL[el]) + '</button>';
    });
    html += '</div><div class="codex-grid deck-grid">';
    for (const c of list) {
      const sel = draft.includes(c.id);
      const full = counts[c.element] >= DECK_MAX_PER_ELEMENT;
      const blocked = !sel && full;
      html += '<div class="codex-cell deck-cell' + (sel ? ' selected' : '') + (blocked ? ' blocked' : '') +
        '" data-id="' + c.id + '" title="' + c.name + ' · ' + LABEL[c.element] + ' ' + c.level +
        (blocked ? ' · ' + LABEL[c.element] + '系已满 ' + DECK_MAX_PER_ELEMENT + ' 张' : '') + '">' +
        '<img src="' + c.img + '" alt=""><span>' + c.name + '</span><i>' + c.level + '</i>' +
        (sel ? '<b class="deck-check">✓</b><button class="deck-minus" data-id="' + c.id + '" type="button" title="移出卡组">−</button>' : '') +
        '</div>';
    }
    html += '</div>';
    html += '<div class="mc-actions"><button class="gold-btn small" id="deck-save">保存卡组</button>' +
      '<button class="ghost-btn" id="deck-clear">清空</button>' +
      '<button class="ghost-btn" id="deck-close">取消</button></div>';
    openModal(html);
    if (modalCard) modalCard.scrollTop = keepScroll;
    const grid = document.querySelector('#modal-body .deck-grid');
    if (grid) {
      grid.scrollTop = keepGridScroll;
      if (anchorId) {
        const cell = grid.querySelector('[data-id="' + anchorId + '"]');
        if (cell) {
          const gr = grid.getBoundingClientRect();
          const cr = cell.getBoundingClientRect();
          if (cr.top < gr.top + 4 || cr.bottom > gr.bottom - 4) {
            grid.scrollTop += cr.top - gr.top - 10;
          }
        }
      }
      grid.addEventListener('scroll', () => { UI.deckScroll = grid.scrollTop; });
    }
    UI.deckAnchor = null;

    $('#deck-slot-select').addEventListener('change', ev => {
      const slot = parseInt(ev.target.value, 10);
      UI.editingSlot = slot;
      UI.deckDraft = (UI.customDecks[slot] ? UI.customDecks[slot].ids : []).slice();
      openDeckBuilder(filter);
    });
    $('#deck-name').addEventListener('input', ev => {
      if (UI.customDecks[UI.editingSlot]) {
        UI.customDecks[UI.editingSlot].name = ev.target.value.slice(0, 12) || ('卡组 ' + (UI.editingSlot + 1));
      }
    });
    $$('.deck-tab').forEach(b => b.addEventListener('click', () => {
      UI.deckAnchor = null;
      UI.deckScroll = 0;
      openDeckBuilder(b.dataset.filter);
    }));
    $$('.deck-cell').forEach(cell => cell.addEventListener('click', () => {
      const id = cell.dataset.id;
      const card = cardById(id);
      const counts2 = deckCounts(UI.deckDraft);
      if (UI.deckDraft.includes(id)) { toast('同一张卡只能放 1 张'); return; }
      if (counts2[card.element] >= DECK_MAX_PER_ELEMENT) { toast(LABEL[card.element] + '系最多选 ' + DECK_MAX_PER_ELEMENT + ' 张'); return; }
      UI.deckDraft.push(id);
      // Keep the list exactly where it was; the picked card stays in view.
      UI.deckAnchor = id;
      openDeckBuilder(filter);
    }));
    $$('.deck-minus').forEach(btn => btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const idx = UI.deckDraft.lastIndexOf(id);
      if (idx >= 0) UI.deckDraft.splice(idx, 1);
      UI.deckAnchor = id;
      openDeckBuilder(filter);
    }));
    $('#deck-save').addEventListener('click', () => {
      const counts2 = deckCounts(UI.deckDraft);
      if (UI.deckDraft.length !== 24) { toast('卡组必须正好 24 张'); return; }
      if (new Set(UI.deckDraft).size !== 24) { toast('同一张卡只能放 1 张'); return; }
      if (!ELEMENTS.every(e => counts2[e] <= DECK_MAX_PER_ELEMENT)) { toast('每系最多 ' + DECK_MAX_PER_ELEMENT + ' 张'); return; }
      const name = ($('#deck-name').value || '').trim().slice(0, 12) || ('卡组 ' + (UI.editingSlot + 1));
      UI.customDecks[UI.editingSlot] = { name, ids: UI.deckDraft.slice() };
      saveCustomDecks();
      if (UI.editingPlayer === 1) {
        UI.deckMode2 = 'custom';
        UI.deckSlot2 = UI.editingSlot;
      } else {
        UI.deckMode = 'custom';
        UI.deckSlot = UI.editingSlot;
      }
      updateDeckModeUI();
      closeModal();
      toast('卡组已保存');
    });
    $('#deck-clear').addEventListener('click', () => {
      UI.deckDraft = [];
      UI.deckAnchor = null;
      UI.deckScroll = 0;
      openDeckBuilder(filter);
    });
    $('#deck-close').addEventListener('click', closeModal);
  }

  function draftNames() {
    return UI.mode === 'duo' ? ['玩家 1', '玩家 2'] : ['你', '电脑'];
  }

  function draftCounts(player) {
    if (!UI.draft) return deckCounts([]);
    return deckCounts(UI.draft.picks[player]);
  }

  function draftHuman(player) {
    return UI.mode === 'duo' || player === 0;
  }

  function draftCurrent() {
    if (!UI.draft || UI.draft.index >= UI.draft.order.length) return -1;
    return UI.draft.order[UI.draft.index];
  }

  function startDraft() {
    if (UI.challenge === 'fire-ice') { toast('冰与火模式使用固定元素卡组'); return; }
    const pool = window.CARDS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const order = [];
    for (let round = 0; round < 12; round++) order.push(0, 1, 1, 0);
    UI.draft = {
      pool,
      order,
      index: 0,
      picks: [[], []],
      history: [],
      filter: 'all',
      locked: false,
      timer: null
    };
    $('#start-screen').classList.add('hidden');
    $('#end-screen').classList.add('hidden');
    closeModal();
    $('#draft-screen').classList.remove('hidden');
    renderDraft(true);
  }

  function closeDraft(cancel) {
    if (!UI.draft) return;
    clearTimeout(UI.draft.timer);
    UI.draft = null;
    $('#draft-screen').classList.add('hidden');
    if (cancel) {
      $('#end-screen').classList.add('hidden');
      $('#start-screen').classList.remove('hidden');
    }
  }

  function draftApply(player, card) {
    const d = UI.draft;
    d.picks[player].push(card.id);
    d.history.push({ player, card });
    const idx = d.pool.findIndex(c => c.id === card.id);
    if (idx >= 0) d.pool.splice(idx, 1);
    d.index++;
  }

  function draftChoose(player) {
    const d = UI.draft;
    const counts = draftCounts(player);
    const avail = d.pool.filter(c => counts[c.element] < DECK_MAX_PER_ELEMENT);
    if (!avail.length) return null;
    const rank = c => {
      let s = c.type === 'MONSTER'
        ? c.level * 0.7 + c.atk * 2.3 + c.hp * 0.55 + (c.caster ? 4 : 0)
        : c.level * 1.15;
      const n = counts[c.element];
      if (n < 2) s += 2.5;
      if (n >= 4) s -= 4;
      return s;
    };
    const sorted = avail.slice().sort((a, b) => rank(b) - rank(a));
    const diff = UI.mode === 'duo' ? 'normal' : UI.diff;
    const limit = diff === 'hard' ? 1 : (diff === 'easy' ? 7 : 3);
    return sorted[Math.floor(Math.random() * Math.min(limit, sorted.length))];
  }

  function draftAIPick() {
    const d = UI.draft;
    if (!d || d.index >= d.order.length) return;
    d.locked = true;
    renderDraft();
    d.timer = setTimeout(() => {
      if (!UI.draft) return;
      const card = draftChoose(1);
      if (!card) { d.locked = false; return; }
      draftApply(1, card);
      d.locked = false;
      if (d.index >= d.order.length) { renderDraft(); finishDraft(); return; }
      renderDraft();
      if (!draftHuman(draftCurrent())) draftAIPick();
    }, 520);
  }

  function draftPick(cardId) {
    const d = UI.draft;
    if (!d || d.locked || d.index >= d.order.length) return;
    const player = draftCurrent();
    if (!draftHuman(player)) return;
    const counts = draftCounts(player);
    const card = d.pool.find(c => c.id === cardId);
    if (!card) return;
    if (counts[card.element] >= DECK_MAX_PER_ELEMENT) {
      toast(LABEL[card.element] + '系已经有 5 张了');
      return;
    }
    draftApply(player, card);
    renderDraft();
    if (d.index >= d.order.length) { finishDraft(); return; }
    if (!draftHuman(draftCurrent())) draftAIPick();
  }

  function draftRandomPick() {
    const d = UI.draft;
    if (!d || d.locked || d.index >= d.order.length) return;
    const player = draftCurrent();
    if (!draftHuman(player)) return;
    const counts = draftCounts(player);
    const legal = d.pool.filter(c => counts[c.element] < DECK_MAX_PER_ELEMENT);
    if (!legal.length) { toast('没有可选卡牌了'); return; }
    const card = legal[Math.floor(Math.random() * legal.length)];
    draftPick(card.id);
  }

  function draftUndo() {
    const d = UI.draft;
    if (!d || !d.history.length) { toast('没有可撤销的选卡'); return; }
    clearTimeout(d.timer);
    d.timer = null;
    d.locked = false;
    let cut = d.history.length - 1;
    if (UI.mode !== 'duo') {
      while (cut > 0 && d.history[cut].player !== 0) cut--;
      if (d.history[cut].player !== 0) { toast('电脑的选择不能撤销'); return; }
    }
    for (let i = d.history.length - 1; i >= cut; i--) {
      const h = d.history[i];
      const pickIdx = d.picks[h.player].lastIndexOf(h.card.id);
      if (pickIdx >= 0) d.picks[h.player].splice(pickIdx, 1);
      d.pool.push(h.card);
    }
    d.history.length = cut;
    d.index = cut;
    renderDraft();
  }

  function draftAutoRest() {
    const d = UI.draft;
    if (!d || d.index >= d.order.length) return;
    if (!window.confirm('剩余选卡交给电脑自动完成，然后直接开始决斗？')) return;
    clearTimeout(d.timer);
    d.timer = null;
    d.locked = false;
    let guard = 0;
    while (d.index < d.order.length && guard++ < 64) {
      const player = draftCurrent();
      const card = draftChoose(player);
      if (!card) break;
      draftApply(player, card);
    }
    renderDraft();
    if (d.index >= d.order.length) finishDraft();
  }

  function finishDraft() {
    const d = UI.draft;
    if (!d) return;
    if (d.picks[0].length !== 24 || d.picks[1].length !== 24) {
      toast('轮抽尚未完成');
      return;
    }
    const p0 = d.picks[0].slice();
    const p1 = d.picks[1].slice();
    clearTimeout(d.timer);
    UI.draft = null;
    $('#draft-screen').classList.add('hidden');
    UI.busy = true;
    startGame(p0, p1);
  }

  function renderDraft(resetScroll) {
    const d = UI.draft;
    if (!d) return;
    const grid = $('#draft-grid');
    const keepScroll = resetScroll || !grid ? 0 : grid.scrollTop;
    const names = draftNames();
    const current = draftCurrent();
    $('#draft-turn').textContent = current >= 0
      ? (draftHuman(current) ? names[current] + ' 选卡' : names[current] + ' 选卡中…')
      : '轮抽完成';
    const nameEls = $$('.draft-player b');
    if (nameEls[0]) nameEls[0].textContent = names[0];
    if (nameEls[1]) nameEls[1].textContent = names[1];
    $('#draft-p0').textContent = d.picks[0].length + ' / 24';
    $('#draft-p1').textContent = d.picks[1].length + ' / 24';
    const fmtCounts = (n) => ELEMENTS.map(e => LABEL[e] + ' ' + n[e] + '/5').join(' · ');
    $('#draft-p0-el').textContent = fmtCounts(draftCounts(0));
    $('#draft-p1-el').textContent = fmtCounts(draftCounts(1));
    $$('.draft-player').forEach((el, i) => el.classList.toggle('active', current === i));
    $('#draft-pool').textContent = '剩余 ' + d.pool.length + ' 张';
    const tabs = $('#draft-tabs');
    tabs.innerHTML = '';
    ['all'].concat(ELEMENTS).forEach(el => {
      const b = h('button', 'draft-tab' + (d.filter === el ? ' active' : ''), el === 'all' ? '全部' : LABEL[el]);
      b.addEventListener('click', () => { d.filter = el; renderDraft(true); });
      tabs.appendChild(b);
    });
    const randomBtn = $('#draft-random');
    const undoBtn = $('#draft-undo');
    const autoBtn = $('#draft-auto');
    const finished = d.index >= d.order.length;
    if (randomBtn) randomBtn.disabled = finished || d.locked || !draftHuman(current);
    if (undoBtn) undoBtn.disabled = !d.history.length;
    if (autoBtn) autoBtn.disabled = finished;
    const counts = current >= 0 ? draftCounts(current) : null;
    const cards = d.pool.filter(c => d.filter === 'all' || c.element === d.filter);
    grid.innerHTML = '';
    if (!cards.length) {
      grid.innerHTML = '<div class="draft-empty">牌池里已经没有这个元素的卡了。</div>';
      grid.scrollTop = keepScroll;
      return;
    }
    for (const c of cards) {
      const disabled = !draftHuman(current) || current < 0 || counts[c.element] >= DECK_MAX_PER_ELEMENT;
      const cell = h('button', 'draft-cell' + (disabled ? ' disabled' : ''));
      cell.type = 'button';
      cell.dataset.id = c.id;
      cell.innerHTML = '<img src="' + c.img + '" alt=""><span>' + c.name + '</span><b class="dcost">' + c.level + '</b>';
      cell.addEventListener('click', () => {
        if (disabled) return;
        draftPick(c.id);
      });
      grid.appendChild(cell);
    }
    grid.scrollTop = keepScroll;
  }

  /* --------------------------------------------------------------- end screen */
  function fillLogList() {
    const list = $('#battle-log-list');
    if (!list) return;
    list.innerHTML = '';
    const logs = UI.recordView ? (UI.recordView.logs || []) : (UI.g ? UI.g.logs : []);
    if (!logs.length) {
      const p = h('div', 'lg lg-sys');
      p.innerHTML = '<i class="lg-ico">·</i><span class="lg-txt">还没有战斗记录。</span>';
      list.appendChild(p);
      return;
    }
    appendLogRows(list, logs, UI.blFilter || 'all');
  }

  function showBattleLog(tab) {
    const list = $('#battle-log-list');
    if (!list) return;
    UI.recordView = null;
    const haveGame = !!UI.g;
    // 没有进行中的对局时（例如从主菜单进入存档），只展示历史对战。
    const logTab = $('#bl-tabs button[data-tab="log"]');
    if (logTab) logTab.classList.toggle('hidden', !haveGame);
    fillLogList();
    list.scrollTop = list.scrollHeight;
    $('#battle-log-screen').classList.remove('hidden');
    setBattleLogTab(!haveGame ? 'archive' : (tab || 'log'));
  }

  function openArchive() {
    showBattleLog('archive');
  }

  function closeBattleLog() {
    $('#battle-log-screen').classList.add('hidden');
  }

  function setBattleLogTab(tab) {
    UI.blTab = tab;
    $$('#bl-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const isLog = tab === 'log';
    $('#bl-tools').classList.toggle('hidden', !isLog);
    $('#battle-log-list').classList.toggle('hidden', !isLog);
    $('#bl-archive').classList.toggle('hidden', isLog);
    const hint = $('#bl-hint');
    if (hint) {
      hint.textContent = UI.recordView && isLog
        ? '回看：' + new Date(UI.recordView.savedAt).toLocaleString()
        : '法术 / 生物 / 系统提示 使用不同字体与颜色';
    }
    if (!isLog) renderArchive();
    if (isLog) {
      fillLogList();
      const list = $('#battle-log-list');
      if (list) list.scrollTop = list.scrollHeight;
    }
  }

  /* --------------------------------------------------------- battle archive */
  const MODE_LABEL = { single: '单人', duo: '双人同屏', lan: '局域网' };
  const CHALLENGE_LABEL = {
    none: '标准', 'fire-ice': '冰与火', 'forbidden-spells': '禁咒', 'mana-pool': '魔力之池',
    'cursed-fields': '诅咒之地', sandstorm: '沙暴', guardians: '守护者',
    'random-flow': '乱流', 'sudden-death': '猝死', leverage: '压制'
  };

  function renderArchive() {
    const wrap = $('#bl-archive-list');
    if (!wrap) return;
    const store = window.BattleRecords;
    const recs = store ? store.list() : [];
    const learned = window.AI_LEARNED || { bias: {} };
    const trained = learned.trainedAt
      ? new Date(learned.trainedAt).toLocaleString()
      : '未训练';
    wrap.innerHTML = '';
    const head = h('div', 'bl-archive-head');
    const biasCount = Object.keys(learned.bias || {}).length;
    const limit = store && store.MAX_RECORDS ? store.MAX_RECORDS : 100;
    head.innerHTML = '<b>' + recs.length + ' / ' + limit + ' 局存档</b>' +
      '<span>AI 模型：' + (learned.games || 0) + ' 局 / ' + biasCount + ' 项权重 · ' + trained + '</span>';
    wrap.appendChild(head);
    if (!recs.length) {
      const empty = h('div', 'bl-archive-empty');
      empty.innerHTML = '还没有存档。完成一局决斗后会自动记录（最多 ' + limit + ' 局，超出后丢弃最旧的）；' +
        '也可以点“导入记录”读取之前导出的 JSON。<br>' +
        '每次“重新训练 AI”后会清空这里的对局，但对战统计与训练出的模型会保留。';
      wrap.appendChild(empty);
      return;
    }
    for (const rec of recs) {
      const meta = rec.meta || {};
      const winName = meta.players && meta.players[meta.winner] ? meta.players[meta.winner].name : '—';
      const row = h('div', 'bl-rec');
      const d = new Date(rec.savedAt);
      row.innerHTML =
        '<div class="bl-rec-main">' +
          '<b>' + winName + ' 获胜</b>' +
          '<span>' + (MODE_LABEL[meta.mode] || meta.mode || '单人') + ' · ' +
            (CHALLENGE_LABEL[meta.challenge] || meta.challenge || '标准') + ' · ' +
            ({ easy: '学徒', normal: '法师', hard: '大法师' }[meta.difficulty] || meta.difficulty || '') + '</span>' +
          '<em>' + d.toLocaleString() + ' · ' + (meta.turns || 0) + ' 回合 · ' +
            ((rec.logs || []).length) + ' 条记录 · ' + ((rec.decisions || []).length) + ' 个决策</em>' +
        '</div>' +
        '<div class="bl-rec-actions">' +
          '<button class="ghost-btn small" data-act="view" type="button">查看</button>' +
          '<button class="ghost-btn small" data-act="export" type="button">导出</button>' +
          '<button class="ghost-btn small danger" data-act="del" type="button">删除</button>' +
        '</div>';
      row.querySelector('[data-act="view"]').addEventListener('click', () => {
        UI.recordView = rec;
        setBattleLogTab('log');
      });
      row.querySelector('[data-act="export"]').addEventListener('click', () => store.exportRecord(rec));
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        store.remove(rec.id);
        if (UI.recordView && UI.recordView.id === rec.id) UI.recordView = null;
        renderArchive();
        toast('已删除该存档');
      });
      wrap.appendChild(row);
    }
  }

  function trainFromArchive() {
    const store = window.BattleRecords;
    const trainer = window.AITrainer;
    if (!store || !trainer) { toast('训练模块未加载'); return; }
    const recs = store.list();
    if (!recs.length) { toast('还没有可供训练的对战记录'); return; }
    const w = trainer.train(recs);
    if (!Object.keys(w.bias).length) {
      toast('样本太少（每张卡至少 4 次决策），再多打几局');
      return;
    }
    window.saveLearned(w);
    // 训练成功 -> 清空历史对局，避免样本重复计入下一轮；
    // 对战统计（career，另一个存储键）与训练出的模型全部保留。
    store.clear();
    UI.recordView = null;
    renderArchive();
    toast('训练完成：' + w.games + ' 局 · ' + w.decisions + ' 个决策 · ' +
      Object.keys(w.bias).length + ' 项权重；历史对局已清空（统计与模型保留）');
  }

  function importRecords(files) {
    const store = window.BattleRecords;
    if (!store) return;
    store.importFiles(files).then(res => {
      toast('导入完成：新增 ' + res.added + ' 局' + (res.skipped ? '，跳过 ' + res.skipped + ' 条' : ''));
      renderArchive();
    }).catch(() => toast('导入失败：文件格式不正确'));
  }

  /* --------------------------------------------------------------- career stats */
  const CAREER_KEY = 'orions2career_v1';

  function emptyCareer() {
    return {
      version: 1, games: 0, wins: 0, losses: 0, draws: 0,
      duoP1: 0, duoP2: 0, turns: 0, kills: 0, cards: {}
    };
  }

  function loadCareer() {
    const base = emptyCareer();
    try {
      const raw = localStorage.getItem(CAREER_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return base;
      Object.assign(base, saved);
      base.cards = (saved.cards && typeof saved.cards === 'object') ? saved.cards : {};
      return base;
    } catch (e) {
      return base;
    }
  }

  function saveCareer(career) {
    try { localStorage.setItem(CAREER_KEY, JSON.stringify(career)); } catch (e) { /* private mode */ }
  }

  function recordCareer(g) {
    if (!g || UI.statsRecorded) return;
    UI.statsRecorded = true;
    const career = loadCareer();
    career.games++;
    career.turns += g.turn;
    career.kills += g.totalKills || 0;
    if (UI.mode === 'duo') {
      if (g.winner === 0) career.duoP1++;
      else if (g.winner === 1) career.duoP2++;
      else career.draws++;
    } else if (g.winner == null) {
      career.draws++;
    } else {
      const won = UI.mode === 'lan' ? g.winner === meId() : g.winner === 0;
      if (won) career.wins++; else career.losses++;
    }
    for (const [id, cs] of Object.entries(g.cardStats || {})) {
      const t = career.cards[id] || { plays: 0, summons: 0, spellCasts: 0, abilityCasts: 0, damage: 0, kills: 0, heal: 0 };
      for (const k of ['plays', 'summons', 'spellCasts', 'abilityCasts', 'damage', 'kills', 'heal']) {
        t[k] = (t[k] || 0) + (cs[k] || 0);
      }
      career.cards[id] = t;
    }
    saveCareer(career);
  }

  function cardMeta(id) {
    return (window.CARD_BY_ID && window.CARD_BY_ID[id]) || { id, name: id, type: '', element: '' };
  }

  function careerEntries(career, field, filter) {
    return Object.entries(career.cards)
      .map(([id, s]) => ({ id, s, card: cardMeta(id) }))
      .filter(x => (x.s[field] || 0) > 0 && (!filter || filter(x.card, x.s)))
      .sort((a, b) => (b.s[field] || 0) - (a.s[field] || 0));
  }

  function statRows(entries, field, label, limit) {
    if (!entries.length) return '<div class="stat-empty">暂无记录。</div>';
    return entries.slice(0, limit || 6).map((x, i) => {
      const card = x.card;
      const type = card.type === 'MONSTER' ? '生物' : (card.type === 'SPELL' ? '法术' : '能力');
      const sub = field === 'damage' ? ((x.s.kills || 0) + ' 击杀')
        : field === 'kills' ? ((x.s.damage || 0) + ' 伤害')
          : ((x.s.plays || 0) + ' 次使用');
      return '<div class="stat-row"><span class="rank">' + (i + 1) + '</span>' +
        '<span class="name">' + card.name + '</span>' +
        '<span class="val">' + (x.s[field] || 0) + ' ' + label + '</span>' +
        '<span class="sub">' + type + ' · ' + sub + '</span></div>';
    }).join('');
  }

  function renderStats(career) {
    const decided = career.wins + career.losses;
    const rate = decided ? Math.round(career.wins / decided * 100) : 0;
    let html = '<div class="stats-summary">' +
      '<div><b>' + career.games + '</b><span>总场次</span></div>' +
      '<div><b>' + career.wins + '</b><span>单机/局域网胜</span></div>' +
      '<div><b>' + career.losses + '</b><span>单机/局域网负</span></div>' +
      '<div><b>' + rate + '%</b><span>胜率</span></div>' +
      '<div><b>' + career.turns + '</b><span>累计回合</span></div>' +
      '<div><b>' + career.kills + '</b><span>累计击杀</span></div>' +
      '<div><b>' + career.duoP1 + '</b><span>双人 P1 胜</span></div>' +
      '<div><b>' + career.duoP2 + '</b><span>双人 P2 胜</span></div>' +
      '</div>';

    const creatures = careerEntries(career, 'summons', c => c.type === 'MONSTER' || !c.type);
    const spells = careerEntries(career, 'spellCasts', c => c.type === 'SPELL' || !c.type);
    const abilities = careerEntries(career, 'abilityCasts');
    const damage = careerEntries(career, 'damage');
    const damageCreatures = careerEntries(career, 'damage', c => c.type === 'MONSTER' || !c.type);
    const damageSpells = careerEntries(career, 'damage', c => c.type === 'SPELL' || !c.type);
    const kills = careerEntries(career, 'kills');
    const played = careerEntries(career, 'plays');
    const healed = careerEntries(career, 'heal');

    html += '<div class="stat-section"><h3>使用最多的生物（召唤次数）</h3>' + statRows(creatures, 'summons', '次召唤') + '</div>';
    html += '<div class="stat-section"><h3>使用最多的咒术（主动施放）</h3>' + statRows(spells, 'spellCasts', '次施放') + '</div>';
    html += '<div class="stat-section"><h3>使用最多的能力（CAST）</h3>' + statRows(abilities, 'abilityCasts', '次使用') + '</div>';
    html += '<div class="stat-section"><h3>杀伤力最高的生物（总伤害）</h3>' + statRows(damageCreatures, 'damage', '伤害') + '</div>';
    html += '<div class="stat-section"><h3>杀伤力最高的咒术（总伤害）</h3>' + statRows(damageSpells, 'damage', '伤害') + '</div>';
    html += '<div class="stat-section"><h3>总伤害最高的卡牌</h3>' + statRows(damage, 'damage', '伤害') + '</div>';
    html += '<div class="stat-section"><h3>击杀最多的卡牌</h3>' + statRows(kills, 'kills', '击杀') + '</div>';
    html += '<div class="stat-section"><h3>治疗量最高的卡牌</h3>' + statRows(healed, 'heal', '治疗') + '</div>';

    if (played.length) {
      html += '<div class="stat-section"><h3>全部卡牌统计</h3><table class="stat-table"><thead><tr>' +
        '<th>卡牌</th><th>出场</th><th>召唤</th><th>法术</th><th>能力</th><th>伤害</th><th>击杀</th><th>治疗</th>' +
        '</tr></thead><tbody>' + played.slice(0, 40).map(x =>
          '<tr><td>' + x.card.name + '</td><td class="num">' + (x.s.plays || 0) + '</td><td class="num">' + (x.s.summons || 0) +
          '</td><td class="num">' + (x.s.spellCasts || 0) + '</td><td class="num">' + (x.s.abilityCasts || 0) +
          '</td><td class="num">' + (x.s.damage || 0) + '</td><td class="num">' + (x.s.kills || 0) +
          '</td><td class="num">' + (x.s.heal || 0) + '</td></tr>').join('') +
        '</tbody></table></div>';
    } else {
      html += '<div class="stat-section"><div class="stat-empty">完成一场决斗后，这里会记录胜负、召唤、法术、伤害、击杀等统计。</div></div>';
    }
    return html;
  }

  function showStats() {
    const career = loadCareer();
    $('#stats-body').innerHTML = renderStats(career);
    $('#stats-body').scrollTop = 0;
    $('#stats-screen').classList.remove('hidden');
  }

  function closeStats() {
    $('#stats-screen').classList.add('hidden');
  }

  function showEnd(victory) {
    if (!UI.g || UI.g.winner == null) return;
    if (!$('#start-screen').classList.contains('hidden')) return;
    closeMobilePicker();
    closeModal();
    $$('.turn-banner').forEach(n => n.remove());
    const oldPrompt = $('#cast-prompt');
    if (oldPrompt) oldPrompt.remove();
    $('#end-screen').classList.remove('hidden');
    const g = UI.g;
    recordCareer(g);
    if (!UI.recordSaved && g && g.winner != null) {
      UI.recordSaved = true;
      try {
        if (window.BattleRecords) {
          window.BattleRecords.save(g, {
            mode: UI.mode, deckMode: UI.deckMode, deckMode2: UI.deckMode2
          });
        }
      } catch (e) {}
    }
    const duo = UI.mode === 'duo';
    const lan = UI.mode === 'lan';
    const winP = g.player(g.winner);
    const won = lan ? g.winner === meId() : g.winner === 0;
    const title = duo ? ('玩家 ' + (g.winner + 1) + ' 获胜') : (won ? '胜利' : '失败');
    $('#end-title').textContent = title;
    $('#end-title').style.color = (duo || won) ? '' : '#d98a7a';
    $('#end-crest').textContent = (duo || won) ? '✦' : '✧';
    $('#end-sub').textContent = duo
      ? '双人同屏 · 玩家 ' + (g.winner + 1) + ' 笑到最后。'
      : (lan ? '局域网对战 · ' + winP.name + ' 获胜。' : (won ? '奥里昂属于你。' : winP.name + ' 是最后的法师。'));
    const p = (duo || lan) ? winP : g.player(0);
    $('#end-stats').innerHTML =
      '<div><b>' + g.turn + '</b><span>回合</span></div>' +
      '<div><b>' + p.stats.played + '</b><span>打出卡牌</span></div>' +
      '<div><b>' + g.totalKills + '</b><span>击杀生物</span></div>' +
      '<div><b>' + fmt(p.hp) + '</b><span>剩余生命</span></div>';
    if (lan) { UI.lan.started = false; updateLanLobby(); }
  }

  /* --------------------------------------------------------------- game flow */
  async function newGame() {
    let deckIds = null;
    let p2Ids = null;
    if (UI.deckMode === 'custom' && UI.challenge !== 'fire-ice') {
      const d = UI.customDecks[UI.deckSlot];
      if (!d || !validDeckIds(d.ids)) {
        toast('玩家 1 的卡组未完成或无效');
        openDeckBuilder('all', UI.deckSlot, 0);
        return;
      }
      deckIds = d.ids.slice();
    }
    if (UI.mode === 'duo' && UI.deckMode2 === 'custom' && UI.challenge !== 'fire-ice') {
      const d = UI.customDecks[UI.deckSlot2];
      if (!d || !validDeckIds(d.ids)) {
        toast('玩家 2 的卡组未完成或无效');
        openDeckBuilder('all', UI.deckSlot2, 1);
        return;
      }
      p2Ids = d.ids.slice();
    }
    $('#start-screen').classList.add('hidden');
    $('#end-screen').classList.add('hidden');
    closeBattleLog();
    closeStats();
    closeModal();
    UI.sel = null;
    UI.busy = true;
    UI.logSeq = 0;
    UI.statsRecorded = false;
    UI.recordSaved = false;
    UI.recordView = null;
    $('#log').innerHTML = '';
    const good = ['water', 'earth', 'life'];
    const evil = ['fire', 'air', 'death'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    $('#player-portrait img').src = 'assets/ui/avatar-' + pick(good) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png';
    $('#enemy-portrait img').src = 'assets/ui/avatar-' + pick(evil) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png';
    await startGame(deckIds, p2Ids);
  }

  async function startGame(p0Ids, p1Ids, opts) {
    opts = opts || {};
    if (UI.draft) closeDraft(false);
    $('#start-screen').classList.add('hidden');
    $('#end-screen').classList.add('hidden');
    closeMobilePicker();
    closeModal();
    UI.sel = null;
    UI.busy = true;
    UI.logSeq = 0;
    UI.statsRecorded = false;
    UI.recordSaved = false;
    UI.recordView = null;
    UI.passPending = false;
    $('#pass-screen').classList.add('hidden');
    $('#log').innerHTML = '';
    const good = ['water', 'earth', 'life'];
    const evil = ['fire', 'air', 'death'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    UI.avatars = Array.isArray(opts.avatars) && opts.avatars.length === 2 ? opts.avatars.slice() : [
      'assets/ui/avatar-' + pick(good) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png',
      'assets/ui/avatar-' + pick(evil) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png'
    ];
    const g = new Game({
      difficulty: (UI.mode === 'duo' || UI.mode === 'lan') ? 'normal' : UI.diff,
      duoNames: UI.mode === 'duo' || UI.mode === 'lan',
      challenge: opts.challenge || UI.challenge,
      deckIds: p0Ids,
      opponentDeckIds: p1Ids,
      firstPlayer: opts.firstPlayer != null ? opts.firstPlayer : UI.firstChoice,
      onEvent: onEvent,
      rng: opts.rng || Math.random
    });
    UI.g = g;
    render();
    await g.start();
    UI.busy = false;
    render();
    if (g.winner == null && UI.mode === 'single' && g.active === 1) {
      UI.busy = true;
      render();
      await wait(450);
      await g.aiPlay();
      UI.busy = false;
      render();
    } else if (g.winner == null && UI.mode === 'duo' && g.active === 1) {
      showPass(1);
    }
  }

  /* --------------------------------------------------------------- LAN play */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomDeckIds() {
    const by = {};
    ELEMENTS.forEach(e => { by[e] = window.CARDS.filter(c => c.element === e).map(c => c.id); });
    const out = [];
    for (const e of ELEMENTS) {
      const list = by[e].slice();
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      out.push(...list.slice(0, 4));
    }
    return out;
  }

  function randomAvatars() {
    const good = ['water', 'earth', 'life'];
    const evil = ['fire', 'air', 'death'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    return [
      'assets/ui/avatar-' + pick(good) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png',
      'assets/ui/avatar-' + pick(evil) + '-' + (1 + Math.floor(Math.random() * 5)) + '.png'
    ];
  }

  function lanStatus(html, cls) {
    const el = $('#lan-status');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'lan-status' + (cls ? ' ' + cls : '');
  }

  function lanServerValue() {
    const v = ($('#lan-server').value || '').trim();
    if (v) return v;
    if (location.protocol === 'file:') {
      try { return localStorage.getItem('orions2lanServer') || 'http://127.0.0.1:8901'; } catch (e) {}
      return 'http://127.0.0.1:8901';
    }
    return location.origin;
  }

  function lanCodegen() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function updateLanLobby() {
    if (!UI.lan.role) return;
    const host = UI.lan.role === 'host';
    $('#p0-deck-row').classList.toggle('hidden', !host);
    $('#lan-start').classList.toggle('hidden', !(host && UI.lan.peer && !UI.lan.started));
    if (UI.lan.started) return;
    const direct = UI.lan.code === 'DIRECT';
    if (host) {
      lanStatus(direct
        ? (UI.lan.peer ? '直连已建立，可以开始' : '直连等待对方应答…')
        : ('房间码 <code>' + UI.lan.code + '</code> · ' + (UI.lan.peer ? '对方已加入，可以开始' : '等待另一台设备加入…')),
        UI.lan.peer ? 'ok' : '');
    } else {
      lanStatus(UI.lan.peer ? (direct ? '直连已建立，等待房主开始…' : '已连接房主，你使用随机卡组，等待房主开始…') : (direct ? '直连等待房主…' : '正在等待房主…'), UI.lan.peer ? 'ok' : '');
    }
  }

  function lanConnect(role) {
    if (!window.LAN) { toast('局域网模块未加载'); return; }
    let code = ($('#lan-code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (role === 'host') {
      code = lanCodegen();
      $('#lan-code').value = code;
    } else if (code.length < 4) {
      toast('请输入房间码'); return;
    }
    UI.lan.role = role;
    UI.lan.code = code;
    UI.lan.peer = false;
    UI.lan.started = false;
    UI.lan.pending = false;
    UI.lan.resolve = null;
    UI.lanSide = role === 'host' ? 0 : 1;
    LAN.connect({ role, code, server: lanServerValue(), onEvent: onLanEvent });
    lanStatus(role === 'host'
      ? '房间码 <code>' + code + '</code> · 正在连接服务器…'
      : '正在加入 <code>' + code + '</code>…');
    $('#lan-start').classList.add('hidden');
  }

  function directStatus(html, cls) {
    const el = $('#direct-status');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'direct-status' + (cls ? ' ' + cls : '');
  }

  function closeDirect(cancel) {
    if (window.LAN) LAN.close();
    $('#direct-screen').classList.add('hidden');
    UI.lan = { role: '', code: '', peer: false, pending: false, resolve: null, started: false };
    $('#p0-deck-row').classList.remove('hidden');
    if (cancel) {
      $('#start-screen').classList.remove('hidden');
      updateLanLobby();
    }
  }

  function maybeDirectDone() {
    if (!window.LAN || LAN.mode !== 'direct' || !UI.lan.peer) return;
    $('#direct-screen').classList.add('hidden');
    updateLanLobby();
  }

  function copyDirect(id) {
    const ta = $('#' + id);
    if (!ta) return;
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(() => toast('配对码已复制')).catch(() => {});
      if (ok) toast('配对码已复制');
    } else if (ok) toast('配对码已复制');
    else toast('请长按文本框全选复制');
  }

  async function openDirectHost() {
    if (!window.RTCPeerConnection) { toast('当前浏览器不支持直连'); return; }
    UI.lan = { role: 'host', code: 'DIRECT', peer: false, pending: false, resolve: null, started: false };
    UI.lanSide = 0;
    $('#direct-screen').classList.remove('hidden');
    $('#direct-sub').textContent = '无需服务器，复制配对码给对方';
    $('#direct-body').innerHTML = '<div class="direct-status" id="direct-status">正在生成房主配对码…</div>';
    try {
      const code = await LAN.directHost({ onEvent: onLanEvent });
      $('#direct-body').innerHTML =
        '<div class="direct-step"><h4>1. 把房主配对码发给对方</h4>' +
        '<textarea class="direct-code" id="direct-offer" readonly>' + code + '</textarea>' +
        '<div class="direct-actions"><button class="ghost-btn" id="direct-copy">复制配对码</button></div></div>' +
        '<div class="direct-step"><h4>2. 粘贴对方生成的应答</h4>' +
        '<textarea class="direct-code" id="direct-answer" placeholder="在这里粘贴对方的应答码"></textarea>' +
        '<div class="direct-actions"><button class="gold-btn small" id="direct-accept">完成连接</button></div></div>' +
        '<div class="direct-status" id="direct-status">等待对方应答…</div>';
      $('#direct-copy').addEventListener('click', () => copyDirect('direct-offer'));
      $('#direct-accept').addEventListener('click', async () => {
        const code2 = ($('#direct-answer').value || '').trim();
        if (!code2) { directStatus('请先粘贴对方的应答码', 'err'); return; }
        directStatus('正在建立直连…');
        try {
          await LAN.directAccept(code2);
          directStatus('已提交应答，等待直连建立…', 'ok');
        } catch (e) {
          directStatus('应答码无效：' + e.message, 'err');
        }
      });
    } catch (e) {
      directStatus('生成失败：' + e.message, 'err');
    }
  }

  function openDirectJoin() {
    if (!window.RTCPeerConnection) { toast('当前浏览器不支持直连'); return; }
    UI.lan = { role: 'guest', code: 'DIRECT', peer: false, pending: false, resolve: null, started: false };
    UI.lanSide = 1;
    $('#direct-screen').classList.remove('hidden');
    $('#direct-sub').textContent = '粘贴房主配对码，生成应答';
    $('#direct-body').innerHTML =
      '<div class="direct-step"><h4>1. 粘贴房主的配对码</h4>' +
      '<textarea class="direct-code" id="direct-offer" placeholder="在这里粘贴房主发来的配对码"></textarea>' +
      '<div class="direct-actions"><button class="gold-btn small" id="direct-generate">生成应答</button></div></div>' +
      '<div class="direct-step" id="direct-answer-step" style="display:none"><h4>2. 把应答码发回房主</h4>' +
      '<textarea class="direct-code" id="direct-answer" readonly></textarea>' +
      '<div class="direct-actions"><button class="ghost-btn" id="direct-copy">复制应答码</button></div></div>' +
      '<div class="direct-status" id="direct-status">等待房主配对码…</div>';
    $('#direct-generate').addEventListener('click', async () => {
      const code = ($('#direct-offer').value || '').trim();
      if (!code) { directStatus('请先粘贴房主配对码', 'err'); return; }
      directStatus('正在生成应答…');
      try {
        const answer = await LAN.directGuest(code, { onEvent: onLanEvent });
        $('#direct-answer').value = answer;
        $('#direct-answer-step').style.display = '';
        $('#direct-copy').addEventListener('click', () => copyDirect('direct-answer'));
        directStatus('把应答码发回房主，等待直连建立…', 'ok');
      } catch (e) {
        directStatus('配对码无效：' + e.message, 'err');
      }
    });
  }

  function onLanEvent(msg) {
    if (!msg) return;
    if (msg.type === 'hello' || msg.type === 'peer') {
      UI.lan.peer = !!msg.peer;
      updateLanLobby();
      maybeDirectDone();
    } else if (msg.type === 'connection') {
      if (msg.state === 'open') {
        lanStatus(UI.lan.role === 'host'
          ? '房间码 <code>' + UI.lan.code + '</code> · 等待另一台设备加入…'
          : '已连接服务器，等待房主…');
      } else {
        lanStatus(msg.reason || '局域网连接中断', 'err');
      }
    } else if (msg.type === 'start' && UI.lan.role === 'guest') {
      UI.lan.started = true;
      startLanGame(msg.config, 1);
    } else if (msg.type === 'request' && UI.lan.role === 'host') {
      onLanRequest(msg);
    } else if (msg.type === 'action' && UI.lan.role === 'guest') {
      onLanAction(msg);
    } else if (msg.type === 'reject' && UI.lan.role === 'guest') {
      resolveLan({ ok: false, reason: msg.reason || '房主拒绝了操作' }, true);
    }
  }

  async function startLanHost() {
    if (UI.lan.role !== 'host') return;
    if (!UI.lan.peer) { toast('还没有玩家加入'); return; }
    let p0 = null;
    if (UI.deckMode === 'custom' && UI.challenge !== 'fire-ice') {
      const d = UI.customDecks[UI.deckSlot];
      if (!d || !validDeckIds(d.ids)) {
        toast('你的自组卡组未完成或无效');
        openDeckBuilder('all', UI.deckSlot, 0);
        return;
      }
      p0 = d.ids.slice();
    }
    if (!p0) p0 = randomDeckIds();
    const p1 = randomDeckIds();
    const firstPlayer = UI.firstChoice === 'random'
      ? Math.floor(Math.random() * 2)
      : (Number(UI.firstChoice) === 1 ? 1 : 0);
    const config = {
      seed: Math.floor(Math.random() * 0x7fffffff),
      p0Ids: p0,
      p1Ids: p1,
      firstPlayer,
      challenge: UI.challenge,
      avatars: randomAvatars()
    };
    UI.lan.started = true;
    LAN.send({ type: 'start', config });
    await startLanGame(config, 0);
  }

  function startLanGame(config, side) {
    UI.mode = 'lan';
    UI.lanSide = side;
    UI.lan.started = true;
    UI.challenge = config.challenge || 'none';
    closeMobilePicker();
    return startGame(config.p0Ids, config.p1Ids, {
      seed: config.seed,
      rng: mulberry32(config.seed),
      avatars: config.avatars,
      firstPlayer: config.firstPlayer,
      challenge: config.challenge
    });
  }

  async function lanApply(action) {
    const g = UI.g;
    if (!g) return { ok: false, reason: '对局尚未开始' };
    if (!action || action.player !== g.active) return { ok: false, reason: '还没轮到该玩家' };
    if (action.kind === 'play') return await g.playCard(action.player, action.cardId, action.slot, action.target || null);
    if (action.kind === 'cast') return await g.castAbility(action.player, action.slot, action.target || null);
    if (action.kind === 'end') {
      if (g.phase !== 'play') return { ok: false, reason: '当前不能结束回合' };
      await g.endTurn();
      return { ok: true };
    }
    return { ok: false, reason: '未知操作' };
  }

  async function lanHostAction(action) {
    const res = await lanApply(action);
    if (res.ok) LAN.send({ type: 'action', action });
    return res;
  }

  function resolveLan(res, toastIt) {
    const fn = UI.lan.resolve;
    UI.lan.pending = false;
    UI.lan.resolve = null;
    if (fn) fn(res);
    UI.busy = false;
    render();
    if (toastIt && res && !res.ok && res.reason) toast(res.reason);
  }

  function lanRequestAction(action) {
    if (!LAN.connected) return Promise.resolve({ ok: false, reason: '局域网未连接' });
    if (UI.lan.pending) return Promise.resolve({ ok: false, reason: '正在等待房主结算' });
    UI.lan.pending = true;
    return new Promise(resolve => {
      UI.lan.resolve = resolve;
      LAN.send({ type: 'request', action }).then(r => {
        if (!r || !r.ok) resolveLan({ ok: false, reason: '房主未收到操作' }, true);
      });
      setTimeout(() => {
        if (UI.lan.pending) resolveLan({ ok: false, reason: '等待房主超时' }, true);
      }, 12000);
    });
  }

  async function onLanRequest(msg) {
    if (UI.lan.role !== 'host' || !UI.g) return;
    const action = msg.action;
    if (!action || action.player !== UI.g.active) {
      LAN.send({ type: 'reject', reason: '还没轮到该玩家' });
      return;
    }
    const res = await lanApply(action);
    if (res.ok) {
      render();
      LAN.send({ type: 'action', action });
    } else {
      LAN.send({ type: 'reject', reason: res.reason || '操作无效' });
    }
  }

  async function onLanAction(msg) {
    const res = await lanApply(msg.action);
    if (UI.lan.pending) {
      resolveLan(res, true);
    } else {
      UI.busy = false;
      render();
      if (!res.ok && res.reason) toast(res.reason);
    }
  }

  function netPlayCard(cardId, slot, target) {
    if (UI.mode !== 'lan') return UI.g.playCard(meId(), cardId, slot, target);
    const action = { kind: 'play', player: meId(), cardId, slot: slot == null ? null : slot, target: target || null };
    return UI.lan.role === 'host' ? lanHostAction(action) : lanRequestAction(action);
  }

  function netCastAbility(slot, target) {
    if (UI.mode !== 'lan') return UI.g.castAbility(meId(), slot, target);
    const action = { kind: 'cast', player: meId(), slot, target: target || null };
    return UI.lan.role === 'host' ? lanHostAction(action) : lanRequestAction(action);
  }

  function netEndTurn() {
    if (UI.mode !== 'lan') return UI.g.endTurn();
    const action = { kind: 'end', player: meId() };
    return UI.lan.role === 'host' ? lanHostAction(action) : lanRequestAction(action);
  }

  function openStart() {
    if (UI.busy) { toast('请先完成当前操作'); return; }
    if (UI.draft) closeDraft(false);
    const inGame = !!(UI.g && UI.g.winner == null);
    $('#btn-resume').classList.toggle('hidden', !inGame);
    $('#start-screen').classList.remove('hidden');
    $('#end-screen').classList.add('hidden');
    closeBattleLog();
    closeStats();
    $('#pass-screen').classList.add('hidden');
    closeMobilePicker();
    UI.passPending = false;
    updateModeUI();
    if (UI.mode === 'lan') updateLanLobby();
    closeModal();
  }

  /* --------------------------------------------------------------- bind */
  function bind() {
    $('#btn-end').addEventListener('click', endTurn);
    $('#btn-new').addEventListener('click', openStart);
    $('#btn-rules').addEventListener('click', openRules);
    $('#btn-start-rules').addEventListener('click', openRules);
    $('#btn-start-codex').addEventListener('click', () => openCodex('all'));
    $('#btn-codex').addEventListener('click', () => openCodex('all'));
    $('#btn-start').addEventListener('click', () => {
      requestLandscape();
      if (UI.deckMode === 'draft') startDraft();
      else newGame();
    });
    document.addEventListener('pointerdown', requestLandscape, { once: true });
    $('#challenge').addEventListener('change', ev => {
      UI.challenge = ev.target.value;
      $('#challenge-desc').textContent = CHALLENGES[UI.challenge] || '';
    });
    $('#first-player').addEventListener('change', ev => {
      UI.firstChoice = ev.target.value;
      $('#first-desc').textContent = UI.firstChoice === 'random'
        ? '系统随机抽签决定谁先手。'
        : (UI.firstChoice === '1' ? '玩家 2 先手。' : '玩家 1 先手。');
    });
    $('#btn-resume').addEventListener('click', () => $('#start-screen').classList.add('hidden'));
    $('#btn-pass').addEventListener('click', () => {
      UI.passPending = false;
      $('#pass-screen').classList.add('hidden');
      UI.busy = false;
      render();
    });
    $('#draft-exit').addEventListener('click', () => closeDraft(true));
    $('#draft-random').addEventListener('click', draftRandomPick);
    $('#draft-undo').addEventListener('click', draftUndo);
    $('#draft-auto').addEventListener('click', draftAutoRest);
    $('#draft-screen').addEventListener('click', ev => { if (ev.target.id === 'draft-screen') closeDraft(true); });
    $('#picker-close').addEventListener('click', closeMobilePicker);
    $('#mobile-picker').addEventListener('click', ev => { if (ev.target.id === 'mobile-picker') closeMobilePicker(); });
    $('#lan-host').addEventListener('click', () => lanConnect('host'));
    $('#lan-join').addEventListener('click', () => lanConnect('guest'));
    $('#lan-direct-host').addEventListener('click', openDirectHost);
    $('#lan-direct-join').addEventListener('click', openDirectJoin);
    $('#lan-start').addEventListener('click', startLanHost);
    $('#direct-exit').addEventListener('click', () => closeDirect(true));
    $('#lan-code').addEventListener('input', ev => {
      ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    });
    $('#lan-code').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') lanConnect('guest');
    });
    $('#lan-server').addEventListener('change', ev => {
      try { localStorage.setItem('orions2lanServer', ev.target.value.trim()); } catch (e) {}
    });
    $$('#mode button').forEach(b => b.addEventListener('click', () => {
      const next = b.dataset.mode;
      if (UI.mode === 'lan' && next !== 'lan') {
        if (window.LAN) LAN.close();
        UI.lan = { role: '', code: '', peer: false, pending: false, resolve: null, started: false };
      }
      if (next === 'lan' && UI.deckMode === 'draft') UI.deckMode = 'random';
      UI.mode = next;
      updateModeUI();
      if (next === 'lan') updateLanLobby();
    }));
    $('#btn-deckbuilder').addEventListener('click', () => openDeckBuilder('all', UI.deckSlot, 0));
    $('#btn-deckbuilder2').addEventListener('click', () => openDeckBuilder('all', UI.deckSlot2, 1));
    $$('#deck-mode button').forEach(b => b.addEventListener('click', () => {
      UI.deckMode = b.dataset.deck;
      updateDeckModeUI();
      if (b.dataset.deck === 'custom' && !validDeckIds(UI.customDecks[UI.deckSlot].ids)) openDeckBuilder('all', UI.deckSlot, 0);
    }));
    $$('#deck-mode2 button').forEach(b => b.addEventListener('click', () => {
      UI.deckMode2 = b.dataset.deck;
      updateDeckModeUI();
      if (b.dataset.deck === 'custom' && !validDeckIds(UI.customDecks[UI.deckSlot2].ids)) openDeckBuilder('all', UI.deckSlot2, 1);
    }));
    $('#deck-select').addEventListener('change', ev => {
      UI.deckSlot = parseInt(ev.target.value, 10);
      updateDeckModeUI();
    });
    $('#deck-select2').addEventListener('change', ev => {
      UI.deckSlot2 = parseInt(ev.target.value, 10);
      updateDeckModeUI();
    });
    $('#btn-again').addEventListener('click', () => {
      if (UI.mode === 'lan') { openStart(); return; }
      if (UI.deckMode === 'draft') startDraft();
      else newGame();
    });
    $('#btn-end-menu').addEventListener('click', openStart);
    $('#btn-end-log').addEventListener('click', showBattleLog);
    $('#btn-start-records').addEventListener('click', openArchive);
    $('#btn-archive').addEventListener('click', openArchive);
    $('#btn-battle-log-close').addEventListener('click', closeBattleLog);
    $('#battle-log-screen').addEventListener('click', ev => {
      if (ev.target && ev.target.id === 'battle-log-screen') closeBattleLog();
    });
    $$('#bl-tabs button').forEach(b => b.addEventListener('click', () => setBattleLogTab(b.dataset.tab)));
    $$('#bl-filter button').forEach(b => b.addEventListener('click', () => {
      UI.blFilter = b.dataset.side;
      $$('#bl-filter button').forEach(x => x.classList.toggle('active', x === b));
      fillLogList();
      const list = $('#battle-log-list');
      if (list) list.scrollTop = list.scrollHeight;
    }));
    $('#bl-import').addEventListener('click', () => $('#bl-file').click());
    $('#bl-file').addEventListener('change', ev => {
      importRecords(ev.target.files);
      ev.target.value = '';
    });
    $('#bl-export-all').addEventListener('click', () => {
      const n = window.BattleRecords.exportAll();
      if (!n) { toast('还没有存档'); return; }
      // 安卓端由原生桥保存并在 records.js 里提示具体路径，这里不再覆盖。
      if (window.Orions2Bridge) return;
      toast('已导出 ' + n + ' 局对战记录');
    });
    $('#bl-refresh').addEventListener('click', renderArchive);
    $('#bl-train').addEventListener('click', trainFromArchive);
    $('#bl-clear').addEventListener('click', () => {
      if (!window.confirm('清空全部对战存档？此操作不可恢复。')) return;
      window.BattleRecords.clear();
      UI.recordView = null;
      renderArchive();
      toast('存档已清空');
    });
    $('#btn-stats').addEventListener('click', showStats);
    $('#btn-end-stats').addEventListener('click', showStats);
    $('#btn-stats-close').addEventListener('click', closeStats);
    $('#stats-screen').addEventListener('click', ev => {
      if (ev.target && ev.target.id === 'stats-screen') closeStats();
    });
    document.addEventListener('pointerover', ev => {
      const t = tipTarget(ev.target);
      if (!t) { hideCardTip(); return; }
      if (t.el === tipAnchor) return;
      hideCardTip();
      tipTimer = setTimeout(() => {
        if (t.el.isConnected) showCardTip(t.el, t.card, t.creature);
      }, 550);
    });
    document.addEventListener('pointerout', ev => {
      const t = tipTarget(ev.target);
      if (t && !t.el.contains(ev.relatedTarget)) hideCardTip();
    });
    document.addEventListener('scroll', hideCardTip, true);
    document.addEventListener('keydown', hideCardTip);
    document.addEventListener('touchstart', ev => {
      const t = tipTarget(ev.target);
      if (!t) { hideCardTip(); return; }
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { if (t.el.isConnected) showCardTip(t.el, t.card, t.creature); }, 550);
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (tipAnchor) setTimeout(hideCardTip, 2200);
    });
    $('#btn-export').addEventListener('click', exportBattle);
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', ev => { if (ev.target.id === 'modal') closeModal(); });
    $('#btn-sound').addEventListener('click', () => {
      UI.sound = !UI.sound;
      $('#btn-sound').textContent = '音效：' + (UI.sound ? '开' : '关');
      $('#btn-sound').setAttribute('aria-pressed', UI.sound ? 'true' : 'false');
    });
    $('#volume').addEventListener('input', ev => setVolume(Number(ev.target.value) / 100, true));
    $$('#difficulty button').forEach(b => b.addEventListener('click', () => {
      UI.diff = b.dataset.diff;
      $$('#difficulty button').forEach(x => x.classList.toggle('active', x === b));
    }));

    $('#board').addEventListener('click', ev => {
      const cast = ev.target.closest('.cast-btn');
      if (cast) {
        ev.stopPropagation();
        if (cast.disabled || UI.busy) return;
        const side = parseInt(cast.dataset.side, 10);
        const slot = parseInt(cast.dataset.slot, 10);
        const c = UI.g && UI.g.creatureAt(side, slot);
        if (!c) return;
        const spec = UI.g.getAbilitySpec(c);
        if (spec) startAbility(c, spec);
        return;
      }
      const slot = ev.target.closest('.slot');
      if (!slot) return;
      onSlotClick(parseInt(slot.dataset.side, 10), parseInt(slot.dataset.slot, 10));
    });


    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        if (!$('#direct-screen').classList.contains('hidden')) { closeDirect(true); return; }
        if (!$('#draft-screen').classList.contains('hidden')) { closeDraft(true); return; }
        if (!$('#mobile-picker').classList.contains('hidden')) { closeMobilePicker(); return; }
        if (!$('#modal').classList.contains('hidden')) { closeModal(); return; }
        if ($('#start-screen').classList.contains('hidden') === false) return;
        UI.sel = null; render();
      }
      if (ev.code === 'Space' && $('#start-screen').classList.contains('hidden') && $('#modal').classList.contains('hidden')) {
        ev.preventDefault();
        endTurn();
      }
    });
  }

  UI.render = render;
  UI.newGame = newGame;
  UI.onHandCard = onHandCard;
  UI.endTurn = endTurn;

  window.addEventListener('DOMContentLoaded', () => {
    buildBoard();
    buildTabs();
    buildDeckStrip();
    buildMana();
    startArt();
    loadCustomDecks();
    loadVolume();
    if (location.protocol === 'file:') {
      try { $('#lan-server').value = localStorage.getItem('orions2lanServer') || ''; } catch (e) {}
    }
    bind();
    updateModeUI();
    updateDeckModeUI();
    render();
    // 特效缩放：开局算一次，之后窗口尺寸/棋盘尺寸变化时重算
    computeFxScale();
    window.addEventListener('resize', scheduleFxScale);
    window.addEventListener('orientationchange', scheduleFxScale);
    if (window.ResizeObserver) {
      const board = $('#board');
      if (board) new ResizeObserver(scheduleFxScale).observe(board);
    }
    if (/[?&]autostart/.test(location.search)) newGame();
  });
})();


