/* Orions 2 — small value network (state -> win probability).
 *
 * Shared by the browser and by the offline tooling in tools/.
 * The network itself is optional: until js/value-net-weights.js is loaded,
 * `predict()` returns null and the AI keeps using its heuristic evaluator.
 *
 * Everything here is pure: no DOM, no globals beyond `window.ValueNet`.
 */
(function () {
  'use strict';

  const ELEMENTS = (typeof window !== 'undefined' && window.ELEMENTS) ||
    ['fire', 'water', 'air', 'earth', 'life', 'death'];

  // Fixed feature order. Changing this invalidates every trained weight file.
  const FEATURES = [
    'me_hp', 'foe_hp', 'hp_diff',
    'me_mana', 'foe_mana', 'mana_diff',
    'mana_fire_diff', 'mana_water_diff', 'mana_air_diff',
    'mana_earth_diff', 'mana_life_diff', 'mana_death_diff',
    'me_playable', 'foe_playable',
    'me_board_n', 'foe_board_n', 'board_n_diff',
    'me_atk', 'foe_atk', 'atk_diff',
    'me_hp_board', 'foe_hp_board', 'hp_board_diff',
    'me_face', 'foe_face', 'face_diff',
    'me_casters', 'foe_casters',
    'me_top_atk', 'foe_top_atk',
    'me_board_value', 'foe_board_value',
    'me_slow', 'foe_slow',
    'turn', 'to_move', 'first',
    'me_pressure', 'foe_pressure',
    'me_spells_left', 'foe_spells_left',
    'me_big_left', 'foe_big_left',
    // 5 slots x (my atk, my hp, foe atk, foe hp)
    's0_me_atk', 's0_me_hp', 's0_foe_atk', 's0_foe_hp',
    's1_me_atk', 's1_me_hp', 's1_foe_atk', 's1_foe_hp',
    's2_me_atk', 's2_me_hp', 's2_foe_atk', 's2_foe_hp',
    's3_me_atk', 's3_me_hp', 's3_foe_atk', 's3_foe_hp',
    's4_me_atk', 's4_me_hp', 's4_foe_atk', 's4_foe_hp'
  ];

  function num(v) { return Number.isFinite(v) ? v : 0; }

  function creatureValue(g, c) {
    if (!c) return 0;
    let v = c.card.level * 0.9 + g.attackValue(c) * 2.5 + c.hp * 0.65;
    if (c.card.caster) v += 5;
    if (c.silenced) v -= 4;
    if (c.poison) v -= 2;
    return v;
  }

  function playableCount(g, id) {
    const p = g.player(id);
    const slots = g.freeSlots(id).length;
    let n = 0;
    for (const entry of p.deck) {
      const card = entry.card;
      if (card.type === 'MONSTER' && !slots) continue;
      const cost = card.type === 'SPELL' ? g.spellCost(p, card) : card.level;
      if ((p.mana[card.element] || 0) >= cost) n++;
    }
    return n;
  }

  function featurize(g, me) {
    me = me | 0;
    const foe = 1 - me;
    const p = g.player(me);
    const e = g.player(foe);
    const mine = g.creatures(me);
    const theirs = g.creatures(foe);
    const sum = (list, fn) => list.reduce((s, c) => s + fn(c), 0);
    const manaTotal = (pl) => ELEMENTS.reduce((s, el) => s + (pl.mana[el] || 0), 0);
    const face = (list) => sum(list, c => g.opposite(c) ? 0 : g.attackValue(c));
    const topAtk = (list) => list.reduce((m, c) => Math.max(m, g.attackValue(c)), 0);
    const deckSpells = (pl) => pl.deck.filter(d => d.card.type === 'SPELL').length;
    const deckBig = (pl) => pl.deck.filter(d => d.card.level >= 6).length;

    const meFace = face(mine);
    const foeFace = face(theirs);
    const mt = manaTotal(p);
    const ft = manaTotal(e);

    const x = [
      num(p.hp / 50), num(e.hp / 50), num((p.hp - e.hp) / 50),
      num(mt / 25), num(ft / 25), num((mt - ft) / 25)
    ];
    for (const el of ELEMENTS) x.push(num(((p.mana[el] || 0) - (e.mana[el] || 0)) / 5));
    x.push(
      num(playableCount(g, me) / 24), num(playableCount(g, foe) / 24),
      num(mine.length / 5), num(theirs.length / 5), num((mine.length - theirs.length) / 5),
      num(sum(mine, c => g.attackValue(c)) / 30), num(sum(theirs, c => g.attackValue(c)) / 30),
      num((sum(mine, c => g.attackValue(c)) - sum(theirs, c => g.attackValue(c))) / 30),
      num(sum(mine, c => c.hp) / 60), num(sum(theirs, c => c.hp) / 60),
      num((sum(mine, c => c.hp) - sum(theirs, c => c.hp)) / 60),
      num(meFace / 30), num(foeFace / 30), num((meFace - foeFace) / 30),
      num(mine.filter(c => c.card.caster).length / 4),
      num(theirs.filter(c => c.card.caster).length / 4),
      num(topAtk(mine) / 12), num(topAtk(theirs) / 12),
      num(sum(mine, c => creatureValue(g, c)) / 80),
      num(sum(theirs, c => creatureValue(g, c)) / 80),
      // "slow" bodies: high hp, no attack yet (walls / setup pieces)
      num(mine.filter(c => g.attackValue(c) === 0 && c.hp >= 8).length / 3),
      num(theirs.filter(c => g.attackValue(c) === 0 && c.hp >= 8).length / 3),
      num(g.turn / 60),
      g.active === me ? 1 : 0,
      g.firstPlayer === me ? 1 : 0,
      num(Math.max(0, foeFace - p.hp) / 40),
      num(Math.max(0, meFace - e.hp) / 40),
      num(deckSpells(p) / 12), num(deckSpells(e) / 12),
      num(deckBig(p) / 8), num(deckBig(e) / 8)
    );

    for (let slot = 0; slot < 5; slot++) {
      const a = g.creatureAt(me, slot);
      const b = g.creatureAt(foe, slot);
      x.push(
        num(a ? g.attackValue(a) / 12 : 0), num(a ? a.hp / 24 : 0),
        num(b ? g.attackValue(b) / 12 : 0), num(b ? b.hp / 24 : 0)
      );
    }
    return x;
  }

  /* ------------------------------------------------------------- inference */
  function forward(x, net) {
    let v = x;
    if (net.mean && net.std) {
      v = new Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const sd = net.std[i] || 1;
        v[i] = (x[i] - net.mean[i]) / (sd > 1e-6 ? sd : 1);
      }
    }
    const layers = net.layers || [];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const out = new Array(L.b.length);
      for (let j = 0; j < L.b.length; j++) {
        const row = L.W[j];
        let s = L.b[j];
        for (let k = 0; k < row.length; k++) s += row[k] * v[k];
        out[j] = li === layers.length - 1 ? s : Math.tanh(s);
      }
      v = out;
    }
    const raw = v[0];
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, raw))));
  }

  function weights() {
    if (typeof window !== 'undefined' && window.VALUE_NET) return window.VALUE_NET;
    return null;
  }

  function predict(g, me) {
    const net = weights();
    if (!net || !net.layers || !net.layers.length) return null;
    if (net.in != null && net.in !== FEATURES.length) return null;
    try {
      const p = forward(featurize(g, me), net);
      return Number.isFinite(p) ? p : null;
    } catch (err) {
      return null;
    }
  }

  const api = { VERSION: 1, FEATURES, featurize, forward, predict };
  if (typeof window !== 'undefined') window.ValueNet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
