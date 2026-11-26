/* Orions duel engine — pure rules, no DOM. */
(function () {
  'use strict';

  const ELEMENTS = ['fire', 'water', 'air', 'earth', 'life', 'death'];
  const ELEM_LABEL = {
    fire: '火', water: '水', air: '风',
    earth: '土', life: '生', death: '死'
  };
  const CARD = {};
  (window.CARDS || []).forEach(c => { CARD[c.id] = c; });
  const EFFECTS = new Proxy({}, { get: (_, k) => (window.EFFECTS || {})[k] });
  window.CARD_BY_ID = CARD;

  const GOOD_NAMES = ['Roland', 'Arhmaster', 'Fernando', 'Elfinger', 'Selena', 'Marfera',
    'Clandalf', 'Veland', 'Tallar', 'Zera', 'Argos', 'Virtus', 'Atropos', 'Orphey', 'Iason', 'Valiant'];
  const BAD_NAMES = ['Orchiid', 'Hordamned', 'Zarghul', 'Zealon', 'Ilmorg', 'Morgant', 'Dorgon',
    'Velthar', 'Ozerthu', 'Thukhu', 'Mordian', 'Archimond', 'Acheron', 'Borg', 'Macabra', 'Nemezida'];

  function finiteNum(n, fallback) {
    const v = Number(n);
    return Number.isFinite(v) ? v : (fallback == null ? 0 : fallback);
  }

  let UID = 0;

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  class Creature {
    constructor(card, owner, slot) {
      this.uid = ++UID;
      this.card = card;
      this.id = card.id;
      this.name = card.name;
      this.owner = owner;
      this.slot = slot;
      this.maxHp = card.hp;
      this.hp = card.hp;
      this.baseAtk = card.atk;
      this.atkBonus = 0;
      this.tempAtk = 0;
      this.flatShield = 0;
      this.blessed = false;
      this.poison = 0;
      this.stun = 0;
      this.silenced = false;
      this.sick = true;
      this.alive = true;
      this.castUsed = false;
      this.kills = 0;
      this.summonedTurn = 0;
      this.flags = {};
      this.buffs = [];
      this.temp = {};
    }
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.onEvent = opts.onEvent || null;
      this.rng = opts.rng || Math.random;
      this.difficulty = opts.difficulty || 'normal';
      this.duoNames = !!opts.duoNames;
      this.challenge = opts.challenge || 'none';
      this.customDeckIds = (opts.deckIds && opts.deckIds.length === 24) ? opts.deckIds.slice() : null;
      this.opponentDeckIds = (opts.opponentDeckIds && opts.opponentDeckIds.length === 24) ? opts.opponentDeckIds.slice() : null;
      this.firstPlayer = opts.firstPlayer == null ? 0 : opts.firstPlayer;
      this.events = [];
      this.logs = [];
      this.logSeq = 0;
      // Log attribution: which side the current line is about, and whether the
      // line describes a spell, a creature or plain system state.
      this.logWho = null;
      this.logTag = null;
      this.errors = [];
      this.turn = 0;
      this.active = 0;
      this.phase = 'init';
      this.winner = null;
      this.peace = 0;
      this.totalKills = 0;
      this.cardStats = {};
      this.castingCardId = null;
      this.players = [this.makePlayer(0), this.makePlayer(1)];
      this.players[0].name = opts.playerName || 'Wizard';
      this.buildDeck();
      this.applyDeckRules();
    }

    makePlayer(id) {
      const mana = {};
      ELEMENTS.forEach(e => { mana[e] = 0; });
      return {
        id,
        name: id === 0 ? 'Wizard' : GOOD_NAMES[0],
        hp: 50,
        maxHp: 50,
        mana,
        board: [null, null, null, null, null],
        deck: [],
        cardPlayed: false,
        skip: false,
        spellDiscount: 0,
        spellTax: 0,
        spellBonus: 0,
        damageReduction: 0,
        avatarUid: 0,
        stats: { played: 0, damage: 0, kills: 0 }
      };
    }

    /* ------------------------------------------------------------------ setup */
    buildDeck() {
      const byEl = {};
      ELEMENTS.forEach(e => { byEl[e] = []; });
      Object.values(CARD).forEach(c => { if (byEl[c.element]) byEl[c.element].push(c); });
      ELEMENTS.forEach(e => shuffle(byEl[e], this.rng));

      const makeRandom = (offset) => {
        const out = [];
        ELEMENTS.forEach(e => {
          const pool = byEl[e];
          for (let i = 0; i < 4 && offset + i < pool.length; i++) {
            out.push({ card: pool[offset + i], used: false });
          }
        });
        return out;
      };
      if (this.customDeckIds) {
        const p0 = this.customDeckIds.map(id => ({ card: CARD[id], used: false })).filter(d => d.card);
        if (p0.length === 24) {
          const p1 = this.opponentDeckIds
            ? this.opponentDeckIds.map(id => ({ card: CARD[id], used: false })).filter(d => d.card)
            : makeRandom(0);
          this.players[0].deck = shuffle(p0, this.rng);
          this.players[1].deck = shuffle(p1, this.rng);
          return;
        }
      }

      if (this.opponentDeckIds) {
        const p1 = this.opponentDeckIds.map(id => ({ card: CARD[id], used: false })).filter(d => d.card);
        if (p1.length === 24) {
          this.players[0].deck = shuffle(makeRandom(0), this.rng);
          this.players[1].deck = shuffle(p1, this.rng);
          return;
        }
      }

      this.players[0].deck = shuffle(makeRandom(0), this.rng);
      this.players[1].deck = shuffle(makeRandom(4), this.rng);
    }

    applyDeckRules() {
      if (this.challenge !== 'fire-ice') return;
      const byEl = {};
      ELEMENTS.forEach(e => { byEl[e] = []; });
      Object.values(CARD).forEach(c => { if (byEl[c.element]) byEl[c.element].push(c); });
      ELEMENTS.forEach(e => shuffle(byEl[e], this.rng));
      const build = (els) => {
        const out = [];
        for (const e of els) {
          const pool = byEl[e];
          for (let i = 0; i < 6 && i < pool.length; i++) out.push({ card: pool[i], used: false });
        }
        return shuffle(out, this.rng);
      };
      this.players[0].deck = build(['fire', 'death']);
      this.players[1].deck = build(['water', 'air']);
    }

    rollMana() {
      // each school 1..5, total 25
      const m = {};
      ELEMENTS.forEach(e => { m[e] = 1; });
      let left = 19;
      let guard = 0;
      while (left > 0 && guard++ < 1000) {
        const e = ELEMENTS[Math.floor(this.rng() * 6)];
        if (m[e] < 5) { m[e]++; left--; }
      }
      return m;
    }

    async start() {
      const p0 = this.players[0];
      const p1 = this.players[1];
      const diff = this.difficulty;
      if (diff === 'hard') { p1.hp = 60; p1.maxHp = 60; }
      else if (diff === 'easy') { p1.hp = 42; p1.maxHp = 42; }
      if (this.duoNames) {
        p0.name = '玩家 1';
        p1.name = '玩家 2';
      } else {
        p0.name = '法师';
        p1.name = BAD_NAMES[Math.floor(this.rng() * BAD_NAMES.length)];
      }
      p0.mana = this.rollMana();
      p1.mana = this.rollMana();
      if (diff === 'hard') ELEMENTS.forEach(e => { p1.mana[e] = Math.min(5, p1.mana[e] + 1); });
      if (this.challenge === 'sudden-death') {
        p0.hp = p0.maxHp = 9;
        p1.hp = p1.maxHp = 100;
      }
      await this.emit({ type: 'start' });
      if (this.challenge === 'guardians') {
        await this.summon(1, CARD['infernal'], 1, { reason: '守护者' });
        await this.summon(1, CARD['kraken'], 3, { reason: '守护者' });
      }
      if (this.challenge === 'leverage') {
        await this.summon(0, CARD['leviathan'], 0, { reason: '压制' });
        await this.summon(1, CARD['knight'], 0, { reason: '压制' });
        await this.summon(1, CARD['knight'], 1, { reason: '压制' });
      }
      const first = this.firstPlayer === 'random'
        ? Math.floor(this.rng() * 2)
        : (Number(this.firstPlayer) === 1 ? 1 : 0);
      await this.beginTurn(first);
    }

    /* ------------------------------------------------------------------ utils */
    clone() {
      const copy = Object.create(Game.prototype);
      copy.onEvent = null;
      copy.rng = () => 0.5;
      copy.difficulty = this.difficulty;
      copy.duoNames = this.duoNames;
      copy.challenge = this.challenge;
      copy.customDeckIds = this.customDeckIds;
      copy.opponentDeckIds = this.opponentDeckIds;
      copy.firstPlayer = this.firstPlayer;
      copy.events = [];
      copy.logs = [];
      copy.logSeq = this.logSeq;
      copy.errors = [];
      copy.turn = this.turn;
      copy.active = this.active;
      copy.phase = this.phase;
      copy.winner = this.winner;
      copy.peace = this.peace;
      copy.totalKills = this.totalKills;
      copy.necroDeath = this.necroDeath;
      // Simulations replay card plays on the copy, and every play bumps card
      // statistics. Without these fields the clone threw on the very first
      // playCard() and every AI simulation silently returned null.
      copy.cardStats = {};
      copy.castingCardId = this.castingCardId;
      copy.castingElement = this.castingElement;
      copy.castingMana = this.castingMana ? Object.assign({}, this.castingMana) : null;
      copy.valueWeight = this.valueWeight;
      copy.valueSide = this.valueSide;
      copy.valueBlend = this.valueBlend;
      copy.aiExplore = 0;
      copy.players = this.players.map(p => {
        const np = Object.assign({}, p);
        np.mana = Object.assign({}, p.mana);
        np.stats = Object.assign({}, p.stats);
        np.board = p.board.map(c => {
          if (!c) return null;
          const nc = Object.assign(Object.create(Object.getPrototypeOf(c)), c);
          nc.flags = Object.assign({}, c.flags);
          nc.buffs = c.buffs.slice();
          nc.temp = Object.assign({}, c.temp);
          nc.lastHitBy = null;
          return nc;
        });
        np.deck = p.deck.map(d => ({ card: d.card, used: !!d.used }));
        return np;
      });
      return copy;
    }

    player(i) { return this.players[i]; }
    enemy(i) { return 1 - i; }
    boardOf(i) { return this.players[i].board; }
    creatureAt(i, slot) { return this.players[i].board[slot] || null; }
    opposite(c) { return this.creatureAt(this.enemy(c.owner), c.slot); }
    creatures(i) { return this.players[i].board.filter(Boolean); }
    // `fromOwner` puts the enemy side first (left to right), then the owner's own
    // side (left to right). Combat and area damage resolve in this order so the
    // log and the animations always read "enemy → self, left → right".
    allCreatures(fromOwner) {
      if (fromOwner !== 0 && fromOwner !== 1) return this.creatures(0).concat(this.creatures(1));
      return this.enemyCreatures(fromOwner).concat(this.creatures(fromOwner));
    }
    orderTargets(owner, targets) {
      const list = targets || [];
      return list.map((t, i) => ({ t, i })).sort((a, b) => {
        const sideA = (a.t.creature ? a.t.creature.owner : a.t.player) === owner ? 1 : 0;
        const sideB = (b.t.creature ? b.t.creature.owner : b.t.player) === owner ? 1 : 0;
        if (sideA !== sideB) return sideA - sideB;
        const slotA = a.t.creature ? a.t.creature.slot : 9;
        const slotB = b.t.creature ? b.t.creature.slot : 9;
        if (slotA !== slotB) return slotA - slotB;
        return a.i - b.i;
      }).map(x => x.t);
    }
    enemyCreatures(i) { return this.creatures(this.enemy(i)); }
    friendsOf(c) { return this.creatures(c.owner); }
    isUndead(c) { return c.card.element === 'death'; }
    isLiving(c) { return c.card.element !== 'death'; }
    freeSlots(i) { const out = []; this.players[i].board.forEach((c, k) => { if (!c) out.push(k); }); return out; }

    async emit(e) {
      if (!e.text && e.type === 'log') e.text = e.text || '';
      const priorWho = this.logWho;
      const priorTag = this.logTag;
      if (e.creature && (e.creature.owner === 0 || e.creature.owner === 1)) {
        this.logWho = e.creature.owner;
        this.logTag = 'creature';
      }
      this.events.push(e);
      if (e.type === 'move' && e.creature) {
        this.log(e.creature.name + ' 移动到 ' + (e.slot + 1) + ' 号槽。', 'move');
      } else if (e.type === 'buff' && e.creature) {
        const c = e.creature;
        const k = e.kind;
        if (k === 'poison') this.log(c.name + ' 中毒加深（当前 ' + c.poison + ' 层）。', 'status');
        else if (k === 'silence') this.log(c.name + ' 被沉默，无法施法。', 'status');
        else if (k === 'web') this.log(c.name + ' 被网住，下次攻击会被跳过。', 'status');
        else if (k === 'blind') this.log(c.name + ' 被致盲：攻击降低并眩晕。', 'status');
        else if (k === 'rust') this.log(c.name + ' 被锈蚀：之后受到的伤害 +2。', 'status');
        else if (k === 'magiclink') this.log(c.name + ' 与 Elementalist 建立了魔法链接。', 'status');
        else if (k === 'weaken') this.log(c.name + ' 的攻击被削弱。', 'status');
        else if (k === 'petrify') this.log(c.name + ' 进入石化：受到的伤害 -2。', 'status');
        else if (k === 'invincible') this.log(c.name + ' 进入无敌状态。', 'status');
        else if (k === 'protect') this.log(c.name + ' 被 Guardian 保护。', 'status');
        else if (k === 'airshield') this.log(c.name + ' 获得气盾：受到的伤害 -2。', 'status');
        else if (k === 'stoneskin') this.log(c.name + ' 获得石肤：受到的伤害 -1。', 'status');
        else if (k === 'fireshield') this.log(c.name + ' 获得火盾。', 'status');
        else if (k === 'atk') this.log(c.name + ' 攻击 ' + (e.amount >= 0 ? '+' : '') + e.amount + '。', 'status');
        else if (k === 'maxhp') this.log(c.name + ' 最大生命 ' + (e.amount >= 0 ? '+' : '') + e.amount + '。', 'status');
        else if (k === 'blessed') this.log(c.name + ' 获得祝福：被击中时回复 1 点生命。', 'status');
        else if (k === 'deathrage') this.log(c.name + ' 进入死亡狂怒：本回合攻击翻倍。', 'status');
        else if (k === 'pureheart') this.log(c.name + ' 获得纯净之心：对亡灵伤害 +10。', 'status');
        else if (k === 'aging') this.log(c.name + ' 衰老：最大生命减半，无法再次衰老。', 'status');
        else if (k === 'gift') this.log(c.name + ' 获得生命之礼：死亡后会满血复活。', 'status');
        else if (k === 'bloodlust') this.log(c.name + ' 进入嗜血状态。', 'status');
      } else if (e.type === 'cleanse') {
        this.log(e.creature.name + ' 的负面状态被清除。', 'status');
      } else if (e.type === 'sick') {
        this.log(e.creature.name + ' 刚召唤，本回合无法攻击。', 'move');
      } else if (e.type === 'skipattack') {
        this.log(e.creature.name + ' 被冻结，跳过攻击。', 'status');
      } else if (e.type === 'skip') {
        this.log(this.player(e.player).name + ' 跳过回合。', 'status', e.player);
      }
      this.logWho = priorWho;
      this.logTag = priorTag;
      if (this.onEvent) await this.onEvent(e, this);
    }

    badNumber(where, n) {
      const item = { turn: this.turn, where, value: String(n) };
      this.errors.push(item);
      if (this.errors.length > 100) this.errors.shift();
      if (window.console && console.warn) console.warn('[Orions] invalid number', where, n);
    }

    cardStat(id) {
      if (!id) return null;
      let s = this.cardStats[id];
      if (!s) {
        s = { plays: 0, summons: 0, spellCasts: 0, abilityCasts: 0, damage: 0, kills: 0, heal: 0 };
        this.cardStats[id] = s;
      }
      return s;
    }

    bumpCard(id, field, n) {
      const s = this.cardStat(id);
      if (!s) return;
      s[field] = (s[field] || 0) + (n == null ? 1 : n);
    }

    log(text, kind, who, tag) {
      this.logSeq = (this.logSeq || 0) + 1;
      let side = who === undefined || who === null ? this.logWho : who;
      if (side !== 0 && side !== 1) side = null;
      const entry = {
        turn: this.turn,
        text,
        kind: kind || 'info',
        seq: this.logSeq,
        who: side,
        tag: tag || this.logTag || null
      };
      this.logs.push(entry);
      // Keep enough history for a full post-duel review.
      if (this.logs.length > 3000) this.logs.shift();
      this.events.push({
        type: 'log', text, kind: entry.kind, seq: entry.seq, who: entry.who, tag: entry.tag
      });
    }

    canPay(p, el, n) { return p.mana[el] >= n; }

    preCostMana(p, el) {
      const m = this.castingMana;
      return m && Number.isFinite(m[el]) ? m[el] : p.mana[el];
    }

    async pay(p, el, n) {
      n = finiteNum(n, 0);
      if (!n) return;
      p.mana[el] = Math.max(0, p.mana[el] - n);
      await this.emit({ type: 'mana', player: p.id, element: el, value: p.mana[el], delta: -n });
    }

    async gain(p, el, n) {
      n = finiteNum(n, 0);
      if (!n) return;
      p.mana[el] = Math.max(0, p.mana[el] + n);
      await this.emit({ type: 'mana', player: p.id, element: el, value: p.mana[el], delta: n });
    }

    async gainAll(p, n) {
      for (const e of ELEMENTS) await this.gain(p, e, n);
    }

    sumMana(p) { return ELEMENTS.reduce((s, e) => s + p.mana[e], 0); }

    /* ------------------------------------------------------------------ deck */
    deckOf(p, el) { return p.deck.filter(d => d.card.element === el); }
    unusedOf(p, el) { return p.deck.filter(d => d.card.element === el); }
    availableCards(p) { return p.deck.filter(d => !(d.card.type === 'MONSTER' && p.board.every(Boolean))); }

    spellCost(p, card) {
      let cost = card.level;
      if (this.challenge === 'forbidden-spells') cost *= 2;
      cost += p.spellTax;
      return Math.max(0, cost);
    }

    chimeraCount(p) {
      return p.board.filter(c => c && c.id === 'chimera').length;
    }

    hasChimera(p) { return p.board.some(c => c && c.id === 'chimera'); }

    /* ------------------------------------------------------------------ play */
    async playCard(playerId, cardId, slot, target) {
      if (this.phase !== 'play' || playerId !== this.active) return { ok: false, reason: '还没轮到你。' };
      const p = this.player(playerId);
      if (p.cardPlayed) return { ok: false, reason: '每回合只能打出一张卡。' };
      const entry = p.deck.find(d => d.card.id === cardId);
      if (!entry) return { ok: false, reason: '这张卡不可用。' };
      const card = entry.card;
      const cost = card.type === 'SPELL' ? this.spellCost(p, card) : card.level;
      if (!this.canPay(p, card.element, cost)) return { ok: false, reason: ELEM_LABEL[card.element] + '元素不足。' };

      if (card.type === 'MONSTER') {
        if (slot == null || slot < 0 || slot > 4 || p.board[slot]) return { ok: false, reason: '请选择一个空槽。' };
      } else {
        const spec = this.getSpellSpec(p, card);
        if (spec.type !== 'none' && !target) return { ok: false, reason: '请选择目标。' };
        if (spec.type !== 'none' && !this.validTargets(p, spec).some(t => this.sameTarget(t, target))) {
          return { ok: false, reason: '目标无效。' };
        }
      }

      p.cardPlayed = true;
      p.stats.played++;
      this.log(p.name + ' 打出 ' + card.name + '（' + (card.type === 'SPELL' ? '法术' : '生物') +
        '，' + ELEM_LABEL[card.element] + ' ' + cost + '）' +
        (target ? '，目标：' + this.targetLabel(p, target) : (slot != null ? '，放置到 ' + (slot + 1) + ' 号槽' : '')) + '。',
        'card', playerId, card.type === 'SPELL' ? 'spell' : 'creature');
      if (card.type === 'SPELL') {
        this.bumpCard(card.id, 'plays');
        this.bumpCard(card.id, 'spellCasts');
      }
      const priorCastingMana = this.castingMana;
      const priorCastingElement = this.castingElement;
      const priorCastingCardId = this.castingCardId;
      this.castingMana = Object.assign({}, p.mana);
      this.castingElement = card.element;
      this.castingCardId = card.id;
      try {
        await this.pay(p, card.element, cost);

        if (card.type === 'MONSTER') {
          const c = await this.summon(playerId, card, slot, { fromCard: true });
          await this.emit({ type: 'card', player: playerId, card, slot, creature: c });
        } else {
          await this.emit({ type: 'spell', player: playerId, card, target });
          this.log(p.name + ' 施放了 ' + card.name + '。', 'spell', playerId, 'spell');
          const fx = EFFECTS[card.id];
          if (fx && fx.spell) await fx.spell(this, p, target, card);
          await this.afterSpellCast(p, card);
          const chimeras = this.chimeraCount(p);
          if (chimeras > 0 && cost > 0) {
            const refund = Math.floor(cost * Math.min(1, chimeras * 0.5));
            if (refund > 0) {
              await this.gain(p, card.element, refund);
              this.log('CHIMERA 返还 ' + refund + ' 点' + ELEM_LABEL[card.element] + '元素（法术费用 ' + cost + '）。',
                'mana', playerId, 'spell');
            }
          }
          await this.checkWin();
        }
      } finally {
        this.castingMana = priorCastingMana;
        this.castingElement = priorCastingElement;
        this.castingCardId = priorCastingCardId;
      }
      return { ok: true };
    }

    async afterSpellCast(caster, card) {
      for (const c of this.allCreatures().slice()) {
        const fx = EFFECTS[c.id];
        if (fx && fx.onSpellCast) await fx.onSpellCast(this, c, caster, card);
      }
      const cp = this.player(caster.id);
      cp.spellDiscount = 0;
      const opp = this.player(this.enemy(caster.id));
      opp.spellTax = 0;
    }

    async summon(owner, card, slot, opts) {
      opts = opts || {};
      const p = this.player(owner);
      if (slot == null || p.board[slot]) return null;
      const c = new Creature(card, owner, slot);
      c.summonedTurn = this.turn;
      const cfx = window.EFFECTS && window.EFFECTS[card.id];
      c.sick = !(opts.charge || (cfx && cfx.charge));
      p.board[slot] = c;
      this.bumpCard(card.id, 'plays');
      this.bumpCard(card.id, 'summons');
      await this.emit({ type: 'summon', player: owner, slot, creature: c, transform: !!opts.transform });
      if (!opts.noLog) {
        this.log(p.name + ' 将 ' + card.name + ' 召唤到 ' + (slot + 1) + ' 号槽' +
          (opts.reason ? '（' + opts.reason + '）' : '') + '。', 'summon', owner, 'creature');
      }
      // Transforms deliberately skip all summon triggers. The new creature was
      // "turned into", not summoned.
      if (!opts.noSummon) {
        const fx = EFFECTS[c.id];
        if (fx && fx.onSummon) await fx.onSummon(this, c);
        for (const other of this.allCreatures().slice()) {
          if (other === c) continue;
          const ofx = EFFECTS[other.id];
          if (ofx && ofx.onSummonAny) await ofx.onSummonAny(this, other, c);
        }
      }
      return c;
    }

    async transform(owner, slot, card, opts) {
      opts = opts || {};
      const p = this.player(owner);
      const old = p.board[slot];
      if (!old) return null;
      p.board[slot] = null;
      old.alive = false;
      old.hp = 0;
      // Remove the old body without calling kill(): no onDeath, no onAnyDeath,
      // no Imp/Disperser death triggers and no kill stat.
      await this.emit({ type: 'vanish', player: owner, slot, creature: old, reason: opts.reason || 'transform' });
      this.log(old.name + ' 被转变为 ' + card.name +
        '（转变不触发死亡或召唤效果）' + (opts.reason ? '：' + opts.reason : '') + '。', 'transform', owner, 'creature');
      return this.summon(owner, card, slot, Object.assign({}, opts, {
        noSummon: true, noLog: true, transform: true
      }));
    }

    async playToEmpty(playerId, cardId, reason) {
      const p = this.player(playerId);
      const slot = this.freeSlots(playerId)[0];
      if (slot == null) return null;
      return this.summon(playerId, CARD[cardId], slot, { reason: reason || '' });
    }

    /* ------------------------------------------------------------------ abilities */
    getAbilitySpec(c) {
      const fx = EFFECTS[c.id];
      if (!c.card.caster || !fx || !fx.cast) return null;
      if (c.silenced) return null;
      let type = c.card.castTarget || fx.castTarget || 'none';
      const el = c.card.castElement || c.card.element;
      let amount = c.card.castCost || 0;
      const cloud = this.creatures(this.enemy(c.owner)).find(x => x.id === 'astral-cloud' && x.slot === c.slot);
      if (cloud) amount += 3;
      const canCast = !fx.castCheck || !!fx.castCheck(this, c);
      return {
        type,
        filter: fx.castFilter || null,
        source: c,
        surcharge: cloud ? 3 : 0,
        cloudUid: cloud ? cloud.uid : 0,
        cost: { element: el, amount },
        repeatable: !!fx.repeatable,
        canCast,
        castReason: fx.castReason || '现在不能使用这个能力。',
        name: c.card.spellName
      };
    }

    async castAbility(playerId, slot, target) {
      if (this.phase !== 'play' || playerId !== this.active) return { ok: false, reason: '还没轮到你。' };
      const p = this.player(playerId);
      const c = p.board[slot];
      if (!c) return { ok: false, reason: '这里没有生物。' };
      const spec = this.getAbilitySpec(c);
      if (!spec) return { ok: false, reason: '没有施法能力。' };
      if (c.castUsed && !spec.repeatable) return { ok: false, reason: '本回合已经施法。' };
      if (spec.canCast === false) return { ok: false, reason: spec.castReason };
      if (spec.type !== 'none') {
        if (!target || !this.validTargets(p, spec, c).some(t => this.sameTarget(t, target))) {
          return { ok: false, reason: '目标无效。' };
        }
      }
      const priorCastingMana = this.castingMana;
      const priorCastingElement = this.castingElement;
      this.castingMana = Object.assign({}, p.mana);
      try {
      const cost = spec.cost;
      const cloud = spec.cloudUid
        ? this.allCreatures().find(x => x.uid === spec.cloudUid && x.alive && x.id === 'astral-cloud')
        : null;
      const cloudPunish = async (reason) => {
        if (cloud) {
          await this.damageCreature(c, 3, { kind: 'ability', element: 'air', source: cloud });
        }
        return { ok: false, reason };
      };
      if (cost && cost.amount > 0) {
        if (cost.element === 'all') {
          const short = ELEMENTS.some(e => p.mana[e] < cost.amount);
          if (short) return cloudPunish('每系元素都不足。');
          for (const e of ELEMENTS) await this.pay(p, e, cost.amount);
        } else if (spec.name === 'Death Bolt') {
          const had = p.mana[cost.element];
          const pay = Math.min(cost.amount, had);
          if (pay > 0) await this.pay(p, cost.element, pay);
          if (had < cost.amount) await this.damagePlayer(p, 10, { kind: 'cost' });
        } else {
          if (!this.canPay(p, cost.element, cost.amount)) {
            return cloudPunish(ELEM_LABEL[cost.element] + '元素不足。');
          }
          await this.pay(p, cost.element, cost.amount);
        }
      } else if (spec.surcharge && cloud && !this.canPay(p, cost.element, spec.surcharge)) {
        return cloudPunish(ELEM_LABEL[cost.element] + '元素不足。');
      }
      this.bumpCard(c.id, 'plays');
      this.bumpCard(c.id, 'abilityCasts');
      if (!spec.repeatable) c.castUsed = true;
      await this.emit({ type: 'ability', player: playerId, slot, creature: c, name: c.card.spellName, target });
      this.log(p.name + ' 的 ' + c.name + ' 使用了 ' + c.card.spellName +
        (target ? '，目标：' + this.targetLabel(p, target) : '') + '。', 'spell', playerId, 'spell');
      const fx = EFFECTS[c.id];
      const priorCastingCardId = this.castingCardId;
      this.castingElement = c.card.element;
      this.castingCardId = c.id;
      try {
        if (fx.cast) await fx.cast(this, c, target);
        for (const other of this.allCreatures().slice()) {
          const ofx = EFFECTS[other.id];
          if (ofx && ofx.onAbilityCast) await ofx.onAbilityCast(this, other, c);
        }
        await this.checkWin();
      } finally {
        this.castingElement = priorCastingElement;
        this.castingCardId = priorCastingCardId;
      }
      } finally {
        this.castingMana = priorCastingMana;
      }
      return { ok: true };
    }

    /* ------------------------------------------------------------------ targeting */
    validTargets(p, spec, source) {
      source = source || spec.source || null;
      const out = [];
      const enemyId = this.enemy(p.id);
      const addBoard = (pid, filter) => {
        this.players[pid].board.forEach((c, slot) => {
          if (c && (!filter || filter(c, source))) out.push({ side: pid === p.id ? 'own' : 'enemy', slot, creature: c });
        });
      };
      switch (spec.type) {
        case 'enemyCreature': addBoard(enemyId, spec.filter); break;
        case 'ownCreature': addBoard(p.id, spec.filter); break;
        case 'anyCreature': addBoard(p.id, spec.filter); addBoard(enemyId, spec.filter); break;
        case 'otherOwnCreature':
          addBoard(p.id, c => c !== source && (!spec.filter || spec.filter(c))); break;
        case 'otherEnemyCreature':
          addBoard(enemyId, c => c !== source && (!spec.filter || spec.filter(c))); break;
        case 'emptyOwn':
          this.freeSlots(p.id).forEach(slot => out.push({ side: 'own', slot, empty: true }));
          break;
        case 'enemyPlayer': out.push({ side: 'enemy', player: true }); break;
        case 'ownPlayer': out.push({ side: 'own', player: true }); break;
        case 'any': addBoard(p.id, spec.filter); addBoard(enemyId, spec.filter);
          out.push({ side: 'enemy', player: true }); break;
      }
      return out;
    }

    sameTarget(a, b) {
      if (!a || !b) return false;
      if (a.player || b.player) return !!(a.player && b.player && a.side === b.side);
      return a.side === b.side && a.slot === b.slot;
    }

    resolveTarget(target) {
      if (!target) return null;
      if (target.player) return { player: this.player(target.side === 'own' ? this.active : this.enemy(this.active)) };
      const pid = target.side === 'own' ? this.active : this.enemy(this.active);
      return { creature: this.creatureAt(pid, target.slot) };
    }

    targetLabel(p, target) {
      if (!target) return '无目标';
      if (target.player) return '敌方玩家';
      const pid = target.side === 'own' ? p.id : this.enemy(p.id);
      const c = this.creatureAt(pid, target.slot);
      return (c ? c.name : '空槽') + '（' + (target.side === 'own' ? '友方' : '敌方') + ' ' + (target.slot + 1) + ' 号槽）';
    }

    getSpellSpec(p, card) {
      const fx = EFFECTS[card.id] || {};
      let type = fx.spellTarget || 'none';
      if (!fx.spellTarget) {
        if (card.spellTarget === 'ENEMIES') type = 'enemyCreature';
        else if (card.spellTarget === 'FRIENDLY') type = 'ownCreature';
        else if (card.spellTarget === 'EMPTY_OWNER') type = 'emptyOwn';
      }
      return { type, filter: fx.spellFilter || null };
    }

    /* ------------------------------------------------------------------ combat */
    async beginTurn(i) {
      this.active = i;
      this.turn++;
      this.phase = 'play';
      const p = this.player(i);
      p.cardPlayed = false;
      for (const c of this.creatures(i)) {
        c.castUsed = false;
        c.tempAtk = 0;
        if (c.summonedTurn !== this.turn) c.sick = false;
        if (c.flags.absolute) c.flags.absolute = false;
      }
      if (this.turn > 1) {
        if (this.challenge === 'random-flow') {
          for (let k = 0; k < 6; k++) await this.gain(p, ELEMENTS[Math.floor(this.rng() * 6)], 1);
        } else {
          await this.gainAll(p, this.challenge === 'mana-pool' ? 2 : 1);
        }
        this.log(p.name + ' 的元素：' + ELEMENTS.map(e => ELEM_LABEL[e] + p.mana[e]).join(' / ') + '。', 'mana', i);
      }
      if (this.challenge === 'sandstorm') {
        // Enemy side resolves first, then the active player.
        await this.damagePlayer(this.players[this.enemy(i)], 5, { kind: 'spell' });
        await this.damagePlayer(this.players[i], 5, { kind: 'spell' });
      }
      if (this.challenge === 'cursed-fields') {
        for (const c of this.allCreatures(i).slice()) await this.damageCreature(c, 3, { kind: 'spell' });
      }
      if (this.winner != null) return;
      await this.emit({ type: 'turn', player: i, turn: this.turn });
      this.log('第 ' + this.turn + ' 回合：' + p.name, 'turn', i);
      if (this.turn > 50) {
        const burn = 1 + Math.floor((this.turn - 51) / 8);
        this.log('奥里昂震颤——受到 ' + burn + ' 点侵蚀伤害。', 'debuff', i);
        await this.damagePlayerRaw(p, burn, { kind: 'attrition' });
        if (this.turn >= 150 && this.winner == null) { await this.finish(this.players[0].hp >= this.players[1].hp ? 0 : 1); return; }
        if (this.winner != null) return;
      }
      for (const c of this.creatures(i).slice()) {
        if (c.deathRage) {
          c.deathRage = false;
          c.tempAtk = 0;
          this.log(c.name + ' 被死亡狂怒吞噬。', 'debuff', c.owner, 'creature');
          await this.damageCreature(c, 10, { kind: 'ability', element: 'death' });
          continue;
        }
        if (c.poison > 0 && c.alive && !this.creatures(i).some(x => x.id === 'unicorn') && !p.spellImmune) {
          await this.damageCreature(c, c.poison, { kind: 'poison', element: 'water' });
        }
        if (!c.alive) continue;
        if (c.bloodlust && c.alive) await this.damageCreature(c, 2, { kind: 'ability', element: 'fire' });
        if (!c.alive) continue;
        if (c.buffs && c.buffs.includes('fireshield') && c.card.element !== 'fire') {
          await this.damageCreature(c, 2, { kind: 'ability', element: 'fire' });
        }
        if (!c.alive) continue;
        if (c.flags.protectUntil && this.turn >= c.flags.protectUntil) {
          c.flags.protectSlot = null;
          c.flags.protectUntil = 0;
        }
        if (c.flags.invincible && this.turn > (c.flags.invincibleUntil || 0)) c.flags.invincible = false;
        const fx = EFFECTS[c.id];
        if (fx && fx.onTurnStart) await fx.onTurnStart(this, c);
      }
      await this.checkWin();
      if (p.skip) {
        p.skip = false;
        // A web is consumed by the webbed creature's own skipped attack, not by
        // its owner losing a turn to paralysis.
        await this.emit({ type: 'skip', player: i });
        this.log(p.name + ' 陷入麻痹，跳过回合。', 'debuff', i);
        await this.endTurn(true);
      }
    }

    async endTurn(skipCombat) {
      if (this.phase !== 'play') return;
      this.phase = 'ending';
      const i = this.active;
      const p = this.player(i);
      this.log(p.name + ' 结束回合' + (skipCombat ? '（跳过战斗）' : '，进入战斗阶段'), 'turnend', i);
      await this.emit({ type: 'endturn', player: i, skipCombat: !!skipCombat });
      for (const c of this.creatures(i).slice()) {
        const fx = EFFECTS[c.id];
        if (fx && fx.onTurnEnd) await fx.onTurnEnd(this, c);
      }
      if (!skipCombat && !this.winner) {
        // Snapshot attackers before combat. Creatures that move (Sea Monster,
        // Ice Wall, etc.) must not be picked up again by a live slot loop.
        const attackers = this.creatures(i).slice();
        for (const c of attackers) {
          if (!c.alive || c.owner !== i) continue;
          await this.attack(c);
          if (this.winner) break;
          await this.tickDeaths();
        }
      }
      for (const c of this.creatures(i).slice()) c.tempAtk = 0;
      if (this.peace > 0) this.peace--;
      if (this.winner) return;
      await this.beginTurn(this.enemy(i));
    }

    async attack(c) {
      if (!c.alive || this.winner) return;
      if (c.stun > 0 || c.flags.web) {
        c.stun = Math.max(0, c.stun - 1);
        c.flags.web = false;
        await this.emit({ type: 'skipattack', player: c.owner, slot: c.slot, creature: c });
        return;
      }
      if (c.sick) {
        await this.emit({ type: 'sick', player: c.owner, slot: c.slot, creature: c });
        return;
      }
      if (c.id === 'elven-archer') return;
      const fx = EFFECTS[c.id] || {};
      if (fx.canAttack && !(await fx.canAttack(this, c))) return;

      const rawTargets = fx.attackTargets ? await fx.attackTargets(this, c) : this.defaultTargets(c);
      if (!rawTargets || !rawTargets.length) return;
      // Multi-target attacks always resolve enemy side first, left to right.
      const targets = this.orderTargets(c.owner, rawTargets);
      const targetText = targets.map(t => t.creature
        ? t.creature.name + '（' + (t.creature.owner === c.owner ? '友方' : '敌方') + ' ' + (t.creature.slot + 1) + ' 号槽）'
        : (this.player(t.player).name + '（玩家）')).join('、');
      this.log(c.name + ' 发起攻击：' + targetText + '。', 'attack', c.owner, 'creature');
      await this.emit({ type: 'attack', player: c.owner, slot: c.slot, creature: c, targets: targets.map(t => t.creature ? { side: t.creature.owner === c.owner ? 'own' : 'enemy', slot: t.creature.slot } : { side: t.player === c.owner ? 'own' : 'enemy', player: true }) });
      for (const t of targets) {
        if (!c.alive) break;
        if (t.creature) {
          if (!t.creature.alive) continue;
          let amount = await this.attackDamage(c, t.creature, t.mult || 1);
          if (amount <= 0) continue;
          if (fx.onAttack) amount = (await fx.onAttack(this, c, t.creature, amount)) || amount;
          const dmg = await this.damageCreature(t.creature, amount, {
            source: c, kind: 'attack', element: c.card.element, attacker: c, rawAttack: true
          });
          if (fx.afterAttack) await fx.afterAttack(this, c, t.creature, dmg);
        } else if (t.player != null) {
          let amount = this.attackValue(c);
          if (c.id === 'scareling' && c.hp === c.maxHp) amount *= 2;
          if (c.id === 'valor') amount = Math.floor(amount / 2);
          if (fx.onAttackPlayer) amount = (await fx.onAttackPlayer(this, c, amount)) || amount;
          if (amount > 0) {
            await this.damagePlayer(this.player(t.player), amount, { source: c, kind: 'attack', element: c.card.element, attacker: c });
            if (fx.afterAttackPlayer) await fx.afterAttackPlayer(this, c, amount);
          }
        }
        await this.tickDeaths();
      }
    }

    defaultTargets(c) {
      const opp = this.opposite(c);
      if (opp && opp.alive) return [{ creature: opp }];
      return [{ player: this.enemy(c.owner) }];
    }

    attackValue(c) {
      if (this.peace > 0) return 0;
      if (this.isWall(c)) return 0;
      // Evil Sorcerer's attack is always exactly 5 and cannot be modified.
      if (c.id === 'evil-sorcerer') return 5;
      const p = this.player(c.owner);
      let base = c.baseAtk;
      if (c.id === 'waterfall') base = p.mana.water;
      if (c.id === 'elemental') base = Math.max(0, p.mana.earth - 3);
      if (c.id === 'elemental-water') base = p.mana.water;
      if (c.id === 'elemental-fire') base = p.mana.fire;
      if (c.id === 'moloch') base = p.mana.earth;
      if (c.id === 'tentacle') base = this.creatures(c.owner).filter(x => x.id === 'tentacle').length;
      if (c.id === 'vulcan') base = p.mana.fire + 3;
      if (c.id === 'soul-of-winds') {
        const o = this.opposite(c);
        // Match the opposing creature's current attack, not just its printed base.
        // Guard the Soul-vs-Soul mirror to avoid recursion.
        base = o ? (o.id === 'soul-of-winds' ? o.baseAtk : this.attackValue(o)) : 4;
      }
      let a = base + c.atkBonus + c.tempAtk;
      const friends = this.creatures(c.owner);
      for (const f of friends) {
        if (f !== c && f.id === 'dryad' && Math.abs(f.slot - c.slot) === 1) {
          a += (c.card.element === 'earth' ? 2 : 1);
        }
        if (f !== c && f.id === 'salamander') a += 2;
      }
      if (c.id === 'titan') a += this.allCreatures().filter(x => x.card.element === 'air').length;
      if (c.id === 'evil-sorcerer') a = c.baseAtk;
      if (c.deathRage) a *= 2;
      const out = Math.floor(a);
      return Number.isFinite(out) ? Math.max(0, out) : 0;
    }

    async attackDamage(c, target, mult) {
      let amount = this.attackValue(c);
      // Scareling's double damage applies only while actually attacking, not
      // to the attack number shown on its card.
      if (c.id === 'scareling' && c.hp === c.maxHp) amount *= 2;
      if (c.id === 'valor') amount = Math.floor(amount / 2);
      amount = Math.floor(amount * (mult || 1));
      if (c.id === 'lich' && target && target.card.element === 'life') amount += 5;
      if (c.id === 'paladin' && target && this.isUndead(target)) amount *= 3;
      if (c.id === 'assassin' && target && target.slot === c.slot) amount += 4;
      if (c.id === 'kronos' && target && target.card.level < c.card.level) amount += (c.card.level - target.card.level);
      if (c.id === 'water-troll' && target && target.card.level >= 6) amount *= 2;
      if (c.id === 'manticore' && target && target.card.caster) amount += 3;
      if (c.id === 'nixie' && target && target.card.element === 'fire') amount *= 2;
      if ((c.id === 'lord-lightning' || c.id === 'lightning-lord') && target && target.id === 'zeus') { amount = 999; }
      if (c.id === 'zeus' && target && (target.id === 'lord-lightning' || target.id === 'lightning-lord')) { amount = 0; }
      if (c.flags.pureHeart && target && this.isUndead(target)) amount += 10;
      return Math.max(0, Math.floor(amount));
    }

    /* ------------------------------------------------------------------ damage */
    async damageCreature(t, amount, opts) {
      opts = opts || {};
      if (!t || !t.alive) return 0;
      // Damage can bounce between creatures (Blade Master splash, Efreet,
      // Swordsman, Fire Shield...). The chain counter stops pathological loops
      // such as two Blade Masters reflecting 1 damage into each other forever.
      const chain = opts.chain || 0;
      if (chain > 8) return 0;
      amount = Number(amount);
      if (!Number.isFinite(amount)) { this.badNumber('damageCreature', amount); return 0; }
      let dmg = Math.max(0, Math.floor(amount));
      const kind = opts.kind || 'ability';
      const element = opts.element || (opts.source && opts.source.card.element) || this.castingElement || null;
      const src = opts.source;
      const beforeHp = t.hp;

      // ---------- global protection
      if (kind === 'attack' && t.flags.absolute) dmg = 0;
      if (t.flags.invincible && this.turn <= (t.flags.invincibleUntil || 0)) dmg = 0;
      if (kind === 'spell' && (t.flags.spellImmune || this.player(t.owner).spellImmune)) dmg = 0;
      if (t.flags.petrified) dmg = Math.max(0, dmg - 2);

      // ---------- target-specific mitigation
      const id = t.id;
      if (t.flatShield) dmg = Math.max(0, dmg - t.flatShield);
      if (id === 'ghost') {
        if (kind === 'spell') dmg *= 2;
        else if (kind === 'attack') {
          dmg = Math.floor(dmg / 2);
          await this.damagePlayerRaw(this.player(t.owner), 1, { reason: 'Ghost', source: src });
        }
      }
      if (id === 'shadow') {
        if (kind === 'spell' || kind === 'attack') dmg = Math.max(1, Math.floor(dmg / 2));
        if (kind === 'attack' && src && src.card.element === 'life') dmg += 5;
      }
      if (id === 'kobold' && dmg <= 4) dmg = 0;
      if (id === 'berserker') dmg += 2;
      if (id === 'giant-turtle') dmg = Math.max(0, dmg - 1);
      if (id === 'elementalist' && src && src.card && src.card.level <= 4) dmg = 0;
      if (id === 'forest-spirit' && (kind === 'attack' || kind === 'ability')) dmg = Math.min(dmg, 1);
      if (id === 'ethereal') {
        if (kind === 'attack') {
          // Physical attacks are ignored, but Evil Sorcerer / Lich attacks are pure magic.
          if (!src || (src.id !== 'evil-sorcerer' && src.id !== 'lich')) dmg = 0;
        } else if (kind === 'spell' || kind === 'ability') {
          // Targeted direct damage is ignored; area effects, status and instant
          // kill sources still reach Ethereal.
          if (!opts.area && !opts.status && !opts.instant && !opts.etherealBypass) dmg = 0;
        }
      }
      if (id === 'astral-cloud' && (kind === 'attack' || kind === 'ability')) dmg = Math.max(0, dmg - 2);
      if (id === 'manticore' && kind === 'spell') dmg = Math.floor(dmg / 2);
      if (id === 'evil-sorcerer' && (!src || src.id !== 'evil-sorcerer')) {
        // All magic is ignored; physical attacks and physical CAST abilities still work.
        if (kind === 'spell' || (kind === 'ability' && !opts.physical) || (kind === 'attack' && src && src.id === 'lich')) {
          dmg = 0;
        }
      }
      if (id === 'demon' && kind === 'spell' && (element === 'fire' || element === 'earth')) dmg = 0;
      if (id === 'gargoyle' && kind === 'spell' && (element === 'earth' || element === 'air')) dmg = 0;
      if (id === 'red-drake' && (element === 'fire')) dmg = 0;
      if (id === 'phoenix' && element === 'fire' && kind !== 'attack') dmg = 0;
      if (id === 'ice-wizard') {
        if (kind === 'spell' && element === 'water') dmg = Math.min(dmg, 1);
        if (element === 'fire') dmg *= 2;
      }
      if (id === 'devil' && element === 'water') dmg *= 2;
      if (id === 'ice-guard' && element === 'fire') dmg *= 2;
      if (id === 'elemental' && kind === 'spell' && element === 'fire') dmg += 10;
      if (t.buffs.includes('airshield')) dmg = Math.max(0, dmg - 2);
      if (t.buffs.includes('stoneskin') && dmg > 1) dmg -= 1;
      if (t.buffs.includes('fireshield') && t.card.element !== 'fire') dmg += 0;
      if (id === 'liches') dmg += 0;
      if (id === 'rust') dmg += 0;

      // Unicorn aura: spells on owner's creatures -50%
      if (kind === 'spell' && this.creatures(t.owner).some(x => x.id === 'unicorn')) {
        dmg = Math.floor(dmg / 2);
      }
      // Water Troll: double damage both ways against cost 6+
      if (t.id === 'water-troll' && src && src.card && src.card.level >= 6) dmg *= 2;
      // Salamander: owner's spells deal +2 per Salamander
      if (kind === 'spell') {
        const salamanders = this.creatures(this.active).filter(x => x.id === 'salamander').length;
        if (salamanders) dmg += 2 * salamanders;
      }
      // Rust debuff
      if (t.flags.rust) dmg += 2;
      // Soul of Winds loses a fixed 20 whenever any damage would reduce its HP,
      // regardless of the source's attack power or damage amount.
      if (id === 'soul-of-winds' && dmg > 0
        && !t.flags.invincible && !t.flags.absolute) dmg = 20;
      // Guardian protect
      const guardian = this.creatures(t.owner).find(x => x.id === 'guardian' && x.flags.protectSlot === t.slot);
      if (guardian) {
        const taken = Math.min(dmg, guardian.hp);
        await this.emit({ type: 'damage', player: guardian.owner, slot: guardian.slot, amount: taken, creature: guardian, redirected: true });
        guardian.hp -= taken;
        dmg -= taken;
        if (guardian.hp <= 0) await this.kill(guardian, { kind: 'damage' });
      }
      dmg = Math.max(0, dmg);
      if (dmg > 0) {
        t.hp -= dmg;
        t.lastHitBy = src;
        const statId = this.castingCardId || (src && src.id);
        if (statId) this.bumpCard(statId, 'damage', dmg);
        if (t.id === 'imp' && t.hp <= 4 && t.hp > 0) t.hp = 0;
        const kindText = ({ attack: '攻击', spell: '法术', ability: '能力', poison: '中毒', cost: '代价', attrition: '侵蚀' })[kind] || '效果';
        this.log(t.name + ' 受到 ' + dmg + ' 点' + kindText + '伤害' +
          (kind === 'poison' ? '（毒 ' + t.poison + ' 层）' : '') +
          (src ? '（来源：' + src.name + '）' : '') +
          '；生命 ' + beforeHp + ' → ' + t.hp + '。', 'damage', t.owner, 'creature');
        await this.emit({
          type: 'damage', player: t.owner, slot: t.slot, amount: dmg,
          hp: t.hp, maxHp: t.maxHp, creature: t, kind, element
        });
        if (t.blessed && t.alive) await this.healCreature(t, 1, { silent: true });
        const fx = EFFECTS[t.id];
        if (fx && fx.onDamaged) await fx.onDamaged(this, t, dmg, opts);
        if (kind === 'attack' && src && src.alive) {
          if (t.id === 'efreet') {
            const back = Math.floor(dmg / 2);
            if (back > 0) await this.damageCreature(src, back, { source: t, kind: 'ability', element: 'fire', chain: chain + 1 });
          }
          // "When damaged by an attack": no reflection if the hit was fully
          // absorbed, and never into an attacker that is immune right now
          // (Giant Turtle's Shell, Absolute Defence).
          if (t.id === 'swordsman' && dmg > 0 && src.slot === t.slot &&
              !src.flags.invincible && !src.flags.absolute) {
            await this.damageCreature(src, 2, { source: t, kind: 'ability', chain: chain + 1 });
          }
          if (t.id === 'ice-wall') await this.damageCreature(src, 2, { source: t, kind: 'ability', chain: chain + 1 });
          if (t.buffs.includes('fireshield') && t.card.element !== 'fire') {
            await this.damageCreature(src, 2, { source: t, kind: 'ability', element: 'fire', chain: chain + 1 });
          }
          await this.triggerAttacked(t, src, dmg);
        }
        // Splash damage does not re-trigger another Blade Master's splash;
        // otherwise two of them would ping-pong forever.
        if (t.id === 'blade-master' && dmg > 0 && !opts.bladeSplash) {
          for (const e of this.enemyCreatures(t.owner).slice()) {
            await this.damageCreature(e, 1, { source: t, kind: 'ability', chain: chain + 1, bladeSplash: true });
          }
        }
        if (opts.source && opts.source.id === 'vampire' && kind === 'attack' && t.card.element !== 'death') {
          await this.healCreature(opts.source, Math.min(30, Math.floor(dmg / 2)));
        }
      } else if (amount > 0) {
        const kindText = ({ attack: '攻击', spell: '法术', ability: '能力', poison: '中毒', cost: '代价', attrition: '侵蚀' })[kind] || '效果';
        this.log(t.name + ' 抵挡了 ' + amount + ' 点' + kindText + '伤害。', 'damage', t.owner, 'creature');
      }
      if (t.hp <= 0 && t.alive) await this.kill(t, opts);
      return dmg;
    }

    async triggerAttacked(t, attacker, dmg) {
      for (const c of this.allCreatures().slice()) {
        const fx = EFFECTS[c.id];
        if (fx && fx.onAttacked) await fx.onAttacked(this, c, t, attacker, dmg);
      }
    }

    async damagePlayer(p, amount, opts) {
      opts = opts || {};
      amount = Number(amount);
      if (!Number.isFinite(amount)) { this.badNumber('damagePlayer', amount); return 0; }
      let dmg = Math.max(0, Math.floor(amount));
      if (p.damageReduction) dmg = Math.floor(dmg * (1 - p.damageReduction / 100));
      // guardian? ice guard is a creature
      if (this.creatures(p.id).some(c => c.id === 'ice-guard')) dmg = Math.floor(dmg / 2);
      return this.damagePlayerRaw(p, dmg, opts);
    }

    async damagePlayerRaw(p, amount, opts) {
      amount = Number(amount);
      if (!Number.isFinite(amount)) { this.badNumber('damagePlayerRaw', amount); return 0; }
      let dmg = Math.max(0, Math.floor(amount));
      if (dmg <= 0) return 0;
      const beforeHp = p.hp;
      p.hp -= dmg;
      const src = opts && opts.source;
      const statId = this.castingCardId || (src && src.id);
      if (statId) this.bumpCard(statId, 'damage', dmg);
      const kind = (opts && opts.kind) || 'effect';
      const kindText = ({ attack: '攻击', spell: '法术', ability: '能力', poison: '中毒', cost: '代价', attrition: '侵蚀' })[kind] || '效果';
      this.log(p.name + ' 受到 ' + dmg + ' 点' + kindText + '伤害' +
        (src ? '（来源：' + src.name + '）' : '') +
        '；生命 ' + beforeHp + ' → ' + p.hp + '。', 'damage', p.id);
      await this.emit({ type: 'damage', player: p.id, playerHit: true, amount: dmg, hp: p.hp, maxHp: p.maxHp, kind });
      if (opts && opts.source && opts.source.card) opts.source.owner;
      // magic healer
      const healer = this.creatures(p.id).find(c => c.id === 'magic-healer');
      if (healer && healer.alive && healer.hp > 0) {
        const h = Math.min(dmg, healer.hp);
        healer.hp -= h;
        p.hp += h;
        this.log('Magic Healer 代替 ' + p.name + ' 承受 ' + h + ' 点伤害并治疗了玩家。', 'heal', p.id);
        await this.emit({ type: 'heal', player: p.id, playerHeal: true, amount: h, hp: p.hp, maxHp: p.maxHp });
        if (healer.hp <= 0) await this.kill(healer, { kind: 'damage' });
      }
      // avatar shares damage
      for (const c of this.creatures(p.id)) {
        if (c.id === 'avatar' && c.alive) {
          c.hp -= dmg;
          this.log(c.name + ' 替 ' + p.name + ' 分担了 ' + dmg + ' 点伤害；生命 ' + (c.hp + dmg) + ' → ' + c.hp + '。', 'damage', c.owner, 'creature');
          await this.emit({ type: 'damage', player: c.owner, slot: c.slot, amount: dmg, hp: c.hp, maxHp: c.maxHp, creature: c, kind: 'shared' });
          if (c.hp <= 0) await this.kill(c, { kind: 'damage' });
        }
      }
      for (const c of this.creatures(p.id).slice()) {
        const fx = EFFECTS[c.id];
        if (fx && fx.onOwnerDamaged) await fx.onOwnerDamaged(this, c, dmg, opts);
      }
      if (p.hp <= 0) await this.finish(this.enemy(p.id));
      return dmg;
    }

    async healCreature(c, n, opts) {
      n = Number(n);
      if (!Number.isFinite(n)) { this.badNumber('healCreature', n); return 0; }
      if (!c || !c.alive || n <= 0) return 0;
      const before = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + n);
      const healed = c.hp - before;
      if (healed > 0) {
        if (this.castingCardId) this.bumpCard(this.castingCardId, 'heal', healed);
        if (!opts || !opts.silent) this.log(c.name + ' 恢复 ' + healed + ' 点生命；生命 ' + before + ' → ' + c.hp + '。', 'heal', c.owner, 'creature');
        await this.emit({ type: 'heal', player: c.owner, slot: c.slot, amount: healed, hp: c.hp, maxHp: c.maxHp, creature: c });
      }
      return healed;
    }

    async healPlayer(p, n) {
      n = Number(n);
      if (!Number.isFinite(n)) { this.badNumber('healPlayer', n); return 0; }
      const before = p.hp;
      p.hp += n;
      if (p.hp > before) {
        if (this.castingCardId) this.bumpCard(this.castingCardId, 'heal', p.hp - before);
        this.log(p.name + ' 恢复 ' + (p.hp - before) + ' 点生命；生命 ' + before + ' → ' + p.hp + '。', 'heal', p.id);
        await this.emit({ type: 'heal', player: p.id, playerHeal: true, amount: p.hp - before, hp: p.hp, maxHp: Math.max(p.maxHp, p.hp) });
      }
      return p.hp - before;
    }

    /* ------------------------------------------------------------------ death */
    async kill(c, opts) {
      if (!c || !c.alive) return;
      c.alive = false;
      const p = this.player(c.owner);
      if (this.allCreatures().some(x => x.id === 'necromancer') || p.board.some(x => x && x.id === 'necromancer')) {
        this.necroDeath = true;
      }
      if (p.board[c.slot] === c) p.board[c.slot] = null;
      const reborn = !!c.flags.giftOfLife;
      c.flags.giftOfLife = false;
      await this.emit({ type: 'death', player: c.owner, slot: c.slot, creature: c });
      const deathSrc = opts && opts.source;
      this.log(c.name + ' 被消灭' + (deathSrc ? '（来源：' + deathSrc.name + '）' : '') + '。', 'death', c.owner, 'creature');
      if (reborn && !p.board[c.slot]) {
        await this.summon(c.owner, c.card, c.slot, { reason: '生命之礼' });
      }
      this.totalKills++;
      const killer = opts && opts.source;
      const killStatId = this.castingCardId || (killer && killer.id);
      if (killStatId) this.bumpCard(killStatId, 'kills');
      if (killer && killer.alive) {
        killer.kills++;
        const kfx = EFFECTS[killer.id];
        if (kfx && kfx.onKill) await kfx.onKill(this, killer, c);
      }
      this.player(this.enemy(c.owner)).stats.kills++;
      const fx = EFFECTS[c.id];
      if (fx && fx.onDeath) await fx.onDeath(this, c, opts || {});
      for (const other of this.allCreatures().slice()) {
        const ofx = EFFECTS[other.id];
        if (ofx && ofx.onAnyDeath) await ofx.onAnyDeath(this, other, c);
      }
      await this.emit({ type: 'deathDone', player: c.owner, slot: c.slot, creature: c });
    }

    async tickDeaths() {
      for (const c of this.allCreatures().slice()) {
        if (c.hp <= 0 && c.alive) await this.kill(c, { kind: 'damage' });
      }
    }

    async checkWin() {
      if (this.winner != null) return;
      if (this.players[0].hp <= 0) await this.finish(1);
      else if (this.players[1].hp <= 0) await this.finish(0);
    }

    async finish(winner) {
      if (this.winner != null) return;
      this.winner = winner;
      this.phase = 'over';
      await this.emit({ type: 'win', player: winner });
      this.log(this.player(winner).name + ' 赢得决斗！', 'win', winner);
    }

    /* ------------------------------------------------------------------ misc effect helpers */
    isWall(c) {
      return !!c && (c.id === 'ice-wall' || c.id === 'wall-of-fire');
    }

    async buffAtk(c, n, permanent) {
      n = Number(n);
      if (!Number.isFinite(n)) { this.badNumber('buffAtk', n); return; }
      if (this.isWall(c)) { this.log(c.name + ' 的攻击力无法被改变。', 'info', c.owner, 'creature'); return; }
      if (c.id === 'evil-sorcerer') { this.log(c.name + ' 免疫魔法增益。', 'info', c.owner, 'creature'); return; }
      if (permanent) c.atkBonus += n; else c.tempAtk += n;
      await this.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'atk', amount: n });
    }

    async buffMaxHp(c, n) {
      n = Number(n);
      if (!Number.isFinite(n)) { this.badNumber('buffMaxHp', n); return; }
      if (c.id === 'evil-sorcerer') { this.log(c.name + ' 免疫魔法属性改变。', 'info', c.owner, 'creature'); return; }
      c.maxHp += n;
      await this.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'maxhp', amount: n });
    }

    async addBuff(c, name) {
      if (c.id === 'evil-sorcerer') { this.log(c.name + ' 免疫魔法状态。', 'info', c.owner, 'creature'); return; }
      if (!c.buffs.includes(name)) c.buffs.push(name);
      await this.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: name });
    }

    async removeDebuffs(c) {
      if (c.id === 'evil-sorcerer') { this.log(c.name + ' 免疫魔法净化。', 'info', c.owner, 'creature'); return; }
      c.poison = 0;
      c.stun = 0;
      c.flags.web = false;
      c.flags.rust = false;
      c.flags.weakness = false;
      await this.emit({ type: 'cleanse', player: c.owner, slot: c.slot, creature: c });
    }

    async poisonCreature(c, n) {
      if (c.id === 'evil-sorcerer') { this.log(c.name + ' 免疫魔法中毒。', 'info', c.owner, 'creature'); return; }
      c.poison += n;
      await this.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'poison', amount: n });
    }

    async destroy(c) {
      await this.kill(c, { kind: 'destroy' });
    }

    /* ------------------------------------------------------------------ AI entry point */
    aiPlay() { return window.AI ? window.AI.takeTurn(this) : Promise.resolve(); }
  }

  window.Game = Game;
  window.Creature = Creature;
  window.ELEM_LABEL = ELEM_LABEL;
  window.shuffle = shuffle;
})();

