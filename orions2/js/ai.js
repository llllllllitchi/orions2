/* Orions 2 — heuristic opponent. */
(function () {
  'use strict';

  const AI = {};
  window.AI = AI;

  function sum(a) { return a.reduce((x, y) => x + y, 0); }
  function creatures(g, id) { return g.creatures(id); }
  function enemies(g, id) { return g.enemyCreatures(id); }
  function affordable(p, card) { return p.mana[card.element] >= card.level; }
  function textOf(card) { return ((card.ability || '') + ' ' + (card.spell || '')).toLowerCase(); }
  function enemyPlayer(g, p) { return g.player(g.enemy(p.id)); }
  function freeSlots(g, p) { return g.freeSlots(p.id); }

  function canPay(p, cost) {
    if (!cost || !cost.amount) return true;
    if (cost.element === 'all') return window.ELEMENTS.every(e => p.mana[e] >= cost.amount);
    return p.mana[cost.element] >= cost.amount;
  }

  function creatureValue(g, c) {
    if (!c) return 0;
    let v = c.card.level * 0.9 + g.attackValue(c) * 2.5 + c.hp * 0.65;
    if (c.card.caster) v += 5;
    if (c.silenced) v -= 4;
    if (c.poison) v -= 2;
    return v;
  }

  function monsterValue(g, card) {
    let v = card.level * 0.9 + card.atk * 2.5 + card.hp * 0.65;
    if (card.caster) v += 5;
    return v;
  }

  function boardValue(g, id) {
    return creatures(g, id).reduce((s, c) => s + creatureValue(g, c), 0);
  }

  /* ---------------------------------------------------------------- learned */
  // Optional weights produced by tools/train-ai.js from recorded duels.
  function learnedBias(key) {
    const w = window.AI_LEARNED;
    if (!w || !w.bias) return 0;
    const v = w.bias[key];
    return Number.isFinite(v) ? v : 0;
  }
  AI.learnedBias = learnedBias;

  const SKELETON_BASE = { level: 3, atk: 3, hp: 10 };
  // A skeleton keeps growing (+1 death, +1 health per turn), so its effective
  // worth is a bit above its printed body.
  function skeletonValue() { return monsterValue(null, SKELETON_BASE) + 3; }
  function bansheeValue(g, hp) {
    return monsterValue(null, { level: 7, atk: 5, hp: Math.max(1, hp) });
  }


  function sumMana(g, id) {
    const p = g.player(id);
    return window.ELEMENTS.reduce((s, e) => s + (p.mana[e] || 0), 0);
  }

  function evalState(g, me) {
    if (g.winner === me) return 100000;
    if (g.winner != null) return -100000;
    const p = g.player(me);
    const e = g.player(1 - me);
    const myFace = facePotential(g, me);
    const foeFace = facePotential(g, 1 - me);
    let s = (p.hp - e.hp) * 1.15
      + (boardValue(g, me) - boardValue(g, 1 - me)) * 1.0
      + (myFace - foeFace) * 1.35
      + (sumMana(g, me) - sumMana(g, 1 - me)) * 0.08;
    s -= Math.max(0, foeFace - p.hp) * 1.6;
    return s;
  }

  async function simulateOption(g, me, opt, depth) {
    if (g.simDisabled || g.simDisabledSide === me) return null;
    try {
      const c = g.clone();
      const res = opt.kind === 'monster'
        ? await c.playCard(me, opt.card.id, opt.slot, null)
        : await c.playCard(me, opt.card.id, null, opt.target || null);
      if (!res || !res.ok) return null;
      if (c.winner == null) await c.endTurn();
      // Hard AI models the opponent's next card with a fast heuristic turn.
      if (depth >= 2 && c.winner == null && c.phase === 'play') {
        await AI.fastTurn(c, 1 - me);
      }
      const ev = evalState(c, me);
      // Optional learned value head. Only the side configured on the Game uses
      // it, so an A/B run can pit "heuristic" against "heuristic + net".
      let v = null;
      if (window.ValueNet && g.valueWeight > 0 &&
          (g.valueSide == null || g.valueSide === me) && c.winner == null) {
        v = window.ValueNet.predict(c, me);
      }
      return { e: ev, v: v };
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------------------- lethal */
  // Damage that lands on the enemy deckmaster if combat started right now.
  async function faceNow(g, id) {
    const ep = g.player(g.enemy(id));
    const cut = ep.damageReduction ? (1 - ep.damageReduction / 100) : 1;
    let s = 0;
    for (const c of creatures(g, id)) {
      if (!c.alive || c.sick || c.stun > 0 || c.flags.web) continue;
      if (c.id === 'elven-archer') continue;      // never attacks
      if (g.opposite(c)) continue;
      const fx = window.EFFECTS && window.EFFECTS[c.id];
      if (fx && fx.canAttack && !(await fx.canAttack(g, c))) continue;
      s += Math.floor(g.attackValue(c) * cut);
    }
    return s;
  }

  // Crude face damage a single card can add this turn (0 when it cannot reach
  // the player at all). Used both as a cheap upper bound and for ranking.
  function cardFacePotential(g, p, card) {
    if (card.type === 'MONSTER') {
      let best = 0;
      for (const slot of freeSlots(g, p)) {
        if (!g.creatureAt(g.enemy(p.id), slot)) best = Math.max(best, card.atk || 0);
      }
      return best;
    }
    const direct = directFaceDamage(g, p, card);
    if (direct > 0) return direct;
    return /enemy player|enemy suffers|owner suffers/i.test(textOf(card)) ? 1 : 0;
  }

  function abilityFacePotential(g, p) {
    let s = 0;
    for (const c of creatures(g, p.id)) {
      if (!c.card.caster || c.castUsed) continue;
      const spec = g.getAbilitySpec(c);
      if (!spec || spec.canCast === false || !canPay(p, spec.cost)) continue;
      if (/enemy player|enemy suffers|owner suffers/i.test(textOf(c.card))) s += 10;
    }
    return s;
  }

  /* If this turn can end the duel, take the win instead of developing the
   * board. Returns true when the turn has already been finished. */
  async function tryLethal(g, p, diff, trace) {
    if (g.phase !== 'play' || g.winner != null) return false;
    const ep = enemyPlayer(g, p);
    if (ep.hp <= 0) return false;

    const board = await faceNow(g, p.id);
    if (board >= ep.hp) {
      // The board already kills: swing now, keep the card.
      if (trace && trace.length < 24) trace.push({ kind: 'lethal', how: 'board' });
      await g.endTurn();
      return true;
    }

    let bound = abilityFacePotential(g, p);
    for (const entry of p.deck) {
      if (!affordable(p, entry.card)) continue;
      bound = Math.max(bound, cardFacePotential(g, p, entry.card));
    }
    if (board + bound < ep.hp) return false;

    const plays = [];
    for (const entry of p.deck) {
      const card = entry.card;
      if (!affordable(p, card)) continue;
      const pot = cardFacePotential(g, p, card);
      if (card.type === 'MONSTER') {
        for (const slot of freeSlots(g, p)) plays.push({ card, slot, target: null, pot });
      } else {
        const spec = g.getSpellSpec(p, card);
        const target = spec.type === 'none' ? null : pickTarget(g, p, spec, textOf(card));
        if (spec.type !== 'none' && !target) continue;
        plays.push({ card, slot: null, target, pot });
      }
    }
    plays.sort((a, b) => b.pot - a.pot);

    for (const play of plays.slice(0, 24)) {
      const c = g.clone();
      const r = await c.playCard(p.id, play.card.id, play.slot, play.target);
      if (!r.ok) continue;
      await useAbilities(c, c.player(p.id), 'hard', false);
      if (c.winner == null) await c.endTurn();
      if (c.winner !== p.id) continue;

      // Verified: replay the exact line on the real board.
      const res = await g.playCard(p.id, play.card.id, play.slot, play.target);
      if (!res.ok) return false;
      if (trace && trace.length < 24) {
        trace.push({ kind: 'lethal', how: 'card', card: play.card.id });
      }
      await useAbilities(g, p, diff, false, trace);
      if (g.winner == null) await g.endTurn();
      return true;
    }
    return false;
  }

  function facePotential(g, id) {
    let s = 0;
    for (const c of creatures(g, id)) {
      const o = g.opposite(c);
      if (!o) s += g.attackValue(c);
    }
    return s;
  }

  function killCount(g, p, damage, all) {
    const list = all ? g.allCreatures() : enemies(g, p.id);
    return list.filter(c => c.hp <= damage).length;
  }

  /* --------------------------------------------------------------- spells */
  function spellHeuristic(g, p, card) {
    const foes = enemies(g, p.id);
    const own = creatures(g, p.id);
    const ep = enemyPlayer(g, p);
    const t = textOf(card);
    const id = card.id;
    let s = 0;

    // Explicit player burn first: it can end the game.
    if (/enemy player|enemy suffers|owner suffers|deal .* to the enemy/i.test(t)) {
      s += 8;
      if (/forbidden magic/i.test(t)) s += (p.id === 1 ? 0 : 0) + (own.length + foes.length) * 1.2;
      if (ep.hp <= 12) s += 12;
    }

    if (id === 'fire-spikes') s += 4 + 3 * foes.length;
    else if (id === 'fire-storm') s += 5 + 4 * foes.length + (foes.length ? 6 : 0);
    else if (id === 'starfall') s += 3 + foes.length * foes.length * 1.5;
    else if (id === 'chain-lightning') s += 3 + (p.mana.air || 0) * 0.8 + foes.length;
    else if (id === 'tsunami') s += 4 + foes.reduce((a, c) => a + c.card.level, 0) * 0.55;
    else if (id === 'earthquake') s += 5 + 2.4 * foes.length;
    else if (id === 'lightning-bolt') s += 6 + (ep.hp <= 7 ? 15 : 0) + (foes.length ? 3 : 0);
    else if (id === 'forbidden-magic') s += 4 + (own.length + foes.length) * 2 + (ep.hp <= 9 ? 10 : 0);
    else if (id === 'fire-burst') s += 5 + Math.max(0, Math.floor((p.mana.fire || 0) / 2) * 0.7) + foes.length - own.length * 2;
    else if (id === 'blinding-light') s += 4 + foes.length * 2;
    else if (id === 'blind') s += 4 + foes.length * 3;
    else if (id === 'acid-storm') s += (foes.length - own.length) * 5 + (own.every(c => c.hp > 15) ? 4 : -10);
    else if (id === 'poison-storm') s += 3 + foes.length * 2.5;
    else if (id === 'blood-ritual') s += 3 + (p.mana.fire < 6 ? 5 : 1) - own.filter(c => c.hp <= 3).length * 3;
    else if (id === 'unholy-word') s += 5 + (ep.hp <= 10 ? 15 : 0) - (p.hp <= 10 ? 10 : 0);
    else if (id === 'steal-life') s += 4 + (p.mana.death || 0) * 0.6 + (p.hp < 30 ? 4 : 0);
    else if (id === 'bloody-wind') s += 7 + Math.max(0, ...foes.map(c => c.card.level));
    else if (id === 'wash-away') s += 6 + Math.min(2, foes.length) * 2;
    else if (id === 'force-of-nature') s += 4 + foes.reduce((a, c) => a + c.hp, 0) * 0.18;
    else if (id === 'enslave') s += 8 + Math.max(0, ...foes.map(c => c.card.level));
    else if (id === 'chaos') s += 5 + foes.length * 3;
    else if (id === 'death-rage') s += 2 + own.length * 0.5;
    else if (id === 'raise-dead') s += 3 + Math.min(5, p.mana.death || 0);
    else if (id === 'undead-swarm') s += 2 + creatures(g, p.id).filter(c => c.card.element === 'death').length * 2.5;
    else if (id === 'revival') s += freeSlots(g, p).length ? 7 : 0;
    else if (id === 'moon-cast') {
      const ownMissing = own.reduce((a, c) => a + (c.maxHp - c.hp), 0);
      const foeMissing = foes.reduce((a, c) => a + (c.maxHp - c.hp), 0);
      s += (ownMissing - foeMissing) * 0.35;
    } else if (id === 'purify') s += 4 + foes.length * 3 + own.reduce((a, c) => a + (c.maxHp - c.hp > 4 ? 3 : 0), 0);
    else if (id === 'eternal-light') s += own.reduce((a, c) => a + (c.maxHp - c.hp > 5 ? 3 : 0), 0) + (p.hp < 35 ? 5 : 0);
    else if (id === 'healing-wind') s += (p.hp < 35 ? 5 : 1) + own.length * 0.8;
    else if (id === 'refresh') s += (p.hp < 35 ? 4 : 0) + 2;
    else if (id === 'cure-wounds') s += p.hp < 30 ? 7 : 1;
    else if (id === 'rejuvenation') s += p.hp < 30 ? 7 : 1;
    else if (id === 'wings-of-wisdom') s += 4 + (p.hp < 35 ? 4 : 0);
    else if (id === 'armor-of-god') s += 3 + own.length;
    else if (id === 'bless') s += 3 + own.length * 1.4;
    else if (id === 'peace') s += 4 + foes.length * 2;
    else if (id === 'air-shield') s += 3 + own.length * 1.2;
    else if (id === 'silence') s += 3 + foes.length * 1.5;
    else if (id === 'empower') s += 3 + own.length;
    else if (id === 'restructure') s += 2 + own.length * 0.8;
    else if (id === 'earthchant') s += 2;
    else if (id === 'solitude') s += own.length === 1 ? 5 : -1;
    else if (id === 'rust') s += 3 + foes.length * 1.2;
    else {
      // Generic fallback for any spell the explicit list does not know.
      const harmful = /damage|suffer|destroy|kill|die|death|steal|poison|weak|drain/.test(t);
      const healing = /heal|restore|health/.test(t);
      const buff = /increase|gain|attack|bless|shield|protect|empower/.test(t);
      if (harmful && foes.length) s += 4 + foes.length * 1.5;
      if (healing && p.hp < 35) s += 4;
      if (buff && own.length) s += 2 + own.length;
    }

    // Avoid self-damaging AoE when our board is the one that dies.
    if (id === 'acid-storm' && own.some(c => c.hp <= 15)) s -= 12;
    if (id === 'blood-ritual' && own.some(c => c.hp <= 3)) s -= 5;
    if (id === 'fire-burst' && own.length >= foes.length) s -= 4;
    if (id === 'moon-cast' && foes.length > own.length) s -= 2;

    // Saving a card is sometimes better than playing a marginal one.
    if (foes.length === 0 && /damage|destroy|poison|blind/.test(t)) s -= 5;
    return s + learnedBias('spell:' + card.id);
  }

  /* --------------------------------------------------------------- placement */
  function placementScore(g, p, card, slot) {
    const e = g.creatureAt(g.enemy(p.id), slot);
    const atk = card.atk;
    const eatk = e ? g.attackValue(e) : 0;
    let s = 0;
    if (e) {
      if (atk >= e.hp) s += 8 + e.card.level * 0.5;
      if (eatk >= card.hp) s -= 7;
      if (card.hp > eatk) s += 2;
      if (e.card.caster) s += 2;
    } else {
      s += 4 + atk * 0.35;
      if (enemyPlayer(g, p).hp <= atk * 3) s += 4;
    }
    if (card.caster) s += card.hp >= 14 ? 2 : -1;
    if (card.type === 'MONSTER' && /summon|all enemy|damage/i.test(textOf(card))) s += 1.5;
    // Prefer a lane where our creature survives and blocks a big attacker.
    if (e && eatk >= 5 && card.hp > eatk) s += 1;
    return s;
  }

  /* --------------------------------------------------------------- targeting */
  function threatOf(g, c) {
    return g.attackValue(c) * 2.2 + c.hp * 0.55 + c.card.level * 1.1 + (c.card.caster ? 4 : 0);
  }

  function bestEnemy(g, p, spec, text) {
    const targets = g.validTargets(p, spec).filter(t => t.creature);
    if (!targets.length) return null;
    const strong = /strongest|highest|most expensive|highest-cost/i.test(text);
    if (strong) {
      targets.sort((a, b) => threatOf(g, b.creature) - threatOf(g, a.creature));
      return targets[0];
    }
    const destroy = /destroy|instantly kill|instant kill|consume|devour|assassinate|kill any|kill a creature|dies?\./i.test(text);
    if (destroy) {
      targets.sort((a, b) => threatOf(g, b.creature) - threatOf(g, a.creature));
      return targets[0];
    }
    const damage = /damage|hit|bolt|strike|burn|suffer|poison|prayer|weak/i.test(text);
    targets.sort((a, b) => {
      const ca = a.creature, cb = b.creature;
      if (damage) {
        // Prefer a target that is likely to die, then the bigger threat.
        const ha = ca.hp <= 5 ? 1 : 0;
        const hb = cb.hp <= 5 ? 1 : 0;
        if (ha !== hb) return hb - ha;
        return ca.hp - cb.hp || threatOf(g, cb) - threatOf(g, ca);
      }
      return threatOf(g, cb) - threatOf(g, ca);
    });
    return targets[0];
  }

  function bestOwn(g, p, spec, text) {
    const targets = g.validTargets(p, spec).filter(t => t.creature);
    if (!targets.length) return null;
    const heal = /heal|restore|health|gift of life|protect/i.test(text);
    const sacrifice = /sacrifice|consume|dies|kill|destroy/i.test(text);
    targets.sort((a, b) => {
      const ca = a.creature, cb = b.creature;
      if (heal) return (ca.hp / Math.max(1, ca.maxHp)) - (cb.hp / Math.max(1, cb.maxHp));
      if (sacrifice) return creatureValue(g, ca) - creatureValue(g, cb);
      return (g.attackValue(cb) * 2 + (cb.card.caster ? 4 : 0) + cb.hp * 0.3) -
             (g.attackValue(ca) * 2 + (ca.card.caster ? 4 : 0) + ca.hp * 0.3);
    });
    return targets[0];
  }

  function pickTarget(g, p, spec, text) {
    const all = g.validTargets(p, spec);
    if (!all.length) return null;
    if (spec.type === 'enemyCreature') return bestEnemy(g, p, spec, text);
    if (spec.type === 'ownCreature' || spec.type === 'otherOwnCreature') return bestOwn(g, p, spec, text);
    if (spec.type === 'anyCreature') {
      const enemy = bestEnemy(g, p, spec, text);
      if (enemy && /damage|kill|destroy|poison|silence|blind/i.test(text)) return enemy;
      return bestOwn(g, p, spec, text) || enemy;
    }
    if (spec.type === 'emptyOwn') return all[0];
    if (spec.type === 'enemyPlayer') return all[0];
    return all[0];
  }

  /* --------------------------------------------------------------- abilities */
  function abilityHeuristic(g, p, c, spec, target) {
    if (!spec || spec.canCast === false || !canPay(p, spec.cost)) return -1;
    // Berserk is useless into a target that is fully immune to the 4 damage.
    if (c.id === 'berserker') {
      const o = g.opposite(c);
      if (o && (o.id === 'evil-sorcerer' || o.id === 'red-drake' || o.id === 'ethereal')) return -1;
    }
    // ---- transformation abilities are evaluated on the actual body swap ----
    if (c.id === 'black-mage') {
      // Extract Soul: a 10 HP skeleton is worth far less than a levelled card.
      // Only convert something that is already cheaper than the new body.
      if (!target || !target.creature) return -1;
      const t = target.creature;
      const before = creatureValue(g, t);
      const after = skeletonValue() + (t.hp <= 3 ? 3 : 0);
      const delta = after - before;
      if (delta < 2) return -1;
      return 3 + delta * 0.5 + learnedBias('ability:black-mage');
    }
    if (c.id === 'apostate') {
      // Transforming no longer triggers Banshee's 8 damage on summon, so the
      // old "always transform" line is a pure downgrade (14 HP caster -> 7 HP).
      // Keep Apostate unless the Banshee's 15-point suicide attack wins the race.
      const opp = g.opposite(c);
      const foeHp = enemyPlayer(g, p).hp;
      const burst = 5 + 10;
      if (!opp && foeHp > 0 && foeHp <= burst) return 5 + learnedBias('ability:apostate');
      if (c.hp <= 3 && bansheeValue(g, c.maxHp / 2) > creatureValue(g, c)) return 1;
      return -1;
    }
    const t = (c.card.spell || '').toLowerCase();
    const foes = enemies(g, p.id);
    const own = creatures(g, p.id);
    let s = 1;

    if (spec.type === 'none') {
      // No target: estimate broad effects.
      if (/deal|damage|strike|bolt|hit/.test(t)) s += 3.5;
      if (/heal|restore|health/.test(t)) s += p.hp < 34 ? 5 : 1;
      if (/all enemy|each enemy/.test(t) && foes.length) s += 2 + foes.length;
      if (/summon|tentacle|clone|skeleton|ghost/.test(t)) s += freeSlots(g, p).length ? 3 : 0;
      if (/gain|receive|restore .* element|element/.test(t)) s += 2;
      if (/sacrifice|dies|destroy all|except/i.test(t)) s -= 3;
      if (/draw|discard/.test(t)) s += 1;
    } else if (spec.type === 'enemyCreature') {
      if (!foes.length) return -1;
      s += 5;
      if (/kill|destroy|instantly|die/.test(t)) s += 5;
      if (/damage|strike|bolt|hit/.test(t)) s += 3;
      const tgt = target || pickTarget(g, p, spec, t);
      if (tgt && /damage|strike|bolt/.test(t) && tgt.creature && tgt.creature.hp <= (c.card.level || 4)) s += 2;
    } else if (spec.type === 'ownCreature') {
      if (!own.length) return -1;
      s += 3;
      if (/heal|restore|health/.test(t)) s += 3;
      if (/sacrifice|consumes|dies|kill/.test(t)) s -= 4;
      if (/attack|increase|gain/.test(t)) s += 2;
    } else if (spec.type === 'emptyOwn') {
      s += freeSlots(g, p).length ? 5 : -1;
    }

    if (/lose .*health|takes? .*damage|sacrifice|dies|destroy all/i.test(t)) s -= 3;
    if (spec.cost && spec.cost.amount) s -= spec.cost.amount * 0.35;
    return s + learnedBias('ability:' + c.id);
  }

  // Some abilities need a bespoke target. Transformation effects are the main
  // case: the "best" target is the *cheapest* body, not the strongest one.
  function pickAbilityTarget(g, p, c, spec, text) {
    if (c.id === 'black-mage') {
      const cands = g.validTargets(p, spec, c).filter(t => t.creature);
      let best = null;
      let bestDelta = -Infinity;
      for (const t of cands) {
        const body = t.creature;
        const delta = (skeletonValue() + (body.hp <= 3 ? 3 : 0)) - creatureValue(g, body);
        if (delta > bestDelta) { bestDelta = delta; best = t; }
      }
      return bestDelta >= 2 ? best : null;
    }
    return pickTarget(g, p, spec, text);
  }

  async function useAbilities(g, p, diff, beforeCard, trace) {
    let used = 0;
    const max = diff === 'easy' ? 2 : 6;
    for (let round = 0; round < max; round++) {
      const casts = [];
      for (const c of creatures(g, p.id)) {
        if (!c.card.caster || c.castUsed) continue;
        const spec = g.getAbilitySpec(c);
        if (!spec || spec.canCast === false || !canPay(p, spec.cost)) continue;
        const t = c.card.spell || '';
        // Before the card, prioritise mana/ramp abilities.
        if (beforeCard && !/gain|receive|element|mana/i.test(t)) continue;
        if (!beforeCard && /gain|receive|element|mana/i.test(t)) continue;
        const target = spec.type === 'none' ? null : pickAbilityTarget(g, p, c, spec, t);
        const sc = abilityHeuristic(g, p, c, spec, target);
        if (sc <= 0) continue;
        if (spec.type !== 'none' && !target) continue;
        casts.push({ c, spec, target, score: sc + (diff === 'hard' ? 0 : g.rng() * 0.6) });
      }
      casts.sort((a, b) => b.score - a.score);
      if (!casts.length) break;
      const best = casts[0];
      if (diff === 'easy' && g.rng() < 0.35) break;
      const res = await g.castAbility(p.id, best.c.slot, best.target);
      if (!res.ok) break;
      if (trace && trace.length < 24) {
        trace.push({
          kind: 'ability', id: best.c.id, score: Math.round(best.score * 10) / 10,
          slot: best.c.slot, target: best.target && best.target.creature
            ? best.target.creature.id + '/p' + (best.target.creature.owner + 1) : null
        });
      }
      used++;
      if (diff === 'easy' && g.rng() < 0.5) break;
    }
    return used;
  }

  function directFaceDamage(g, p, card) {
    const foes = enemies(g, p.id);
    const ep = enemyPlayer(g, p);
    switch (card.id) {
      case 'flaming-arrow': {
        const diff = (p.mana.fire || 0) - (ep.mana.fire || 0);
        return diff > 0 ? diff * 2 : 1;
      }
      case 'ice-bolt': return 10 + Math.floor((p.mana.water || 0) / 2);
      case 'lightning-bolt': return 7;
      case 'fire-storm': return foes.length * 3;
      case 'forbidden-magic': return g.allCreatures().filter(c => c.card.element === 'fire').length * 3;
      case 'unholy-word': return 10;
      case 'life-sacrifice': return (p.mana.life || 0) * 2;
      case 'steal-life': return p.mana.death || 0;
      default: return 0;
    }
  }

  /* --------------------------------------------------------------- turn */
  AI.takeTurn = function (g) { return AI.takeTurnFor(g, 1); };

  AI.takeTurnFor = async function (g, playerId) {
    const p = g.player(playerId);
    const diff = g.difficulty || 'normal';
    const trace = [];
    await g.emit({ type: 'aiThinking' });

    // Before anything else: if this turn can kill the opponent, kill them.
    if (await tryLethal(g, p, diff, trace)) {
      if (!g.aiDecisions) g.aiDecisions = [];
      if (g.aiDecisions.length < 400) {
        g.aiDecisions.push({
          turn: g.turn,
          player: playerId,
          diff,
          hp: [g.players[0].hp, g.players[1].hp],
          board: [g.creatures(0).length, g.creatures(1).length],
          card: null,
          kind: 'lethal',
          lethal: true,
          score: null,
          sim: null,
          options: [],
          trace: trace.slice()
        });
      }
      return;
    }

    // Ramp / mana abilities first so the card decision uses the new mana.
    await useAbilities(g, p, diff, true, trace);

    const options = [];
    const epNow = enemyPlayer(g, p);
    const existingFace = facePotential(g, p.id);
    for (const entry of p.deck) {
      const card = entry.card;
      if (!affordable(p, card)) continue;
      if (card.type === 'MONSTER') {
        if (!freeSlots(g, p).length) continue;
        for (const slot of freeSlots(g, p)) {
          let score = monsterValue(g, card) + placementScore(g, p, card, slot) + learnedBias('monster:' + card.id);
          // Lethal / pressure bonus.
          const ep = enemyPlayer(g, p);
          if (!g.creatureAt(0, slot) && ep.hp <= card.atk) score += 12;
          options.push({ kind: 'monster', card, slot, target: null, score });
        }
      } else {
        const spec = g.getSpellSpec(p, card);
        const target = spec.type === 'none' ? null : pickTarget(g, p, spec, textOf(card));
        if (spec.type !== 'none' && !target) continue;
        let score = spellHeuristic(g, p, card);
        const faceDamage = directFaceDamage(g, p, card);
        const lethal = existingFace + faceDamage >= epNow.hp;
        // A direct-damage spell that wins the game is always correct.
        if (lethal) score += 40;
        else if (/enemy player|enemy suffers|owner suffers/i.test(textOf(card)) && epNow.hp <= 10) score += 20;
        options.push({ kind: 'spell', card, slot: null, target, score, lethal });
      }
    }

    options.sort((a, b) => b.score - a.score);
    let choice = null;
    if (options.length) {
      if (diff === 'easy') {
        choice = options[Math.floor(g.rng() * Math.min(5, options.length))];
      } else {
        // One-ply self-play simulation: apply the candidate, finish combat,
        // and score the resulting position. This is where the "trained" strength
        // comes from; the heuristic only shortlists candidates.
        const limit = diff === 'hard' ? 18 : 12;
        let short = options.slice(0, limit);
        const extras = options.filter(o => o.lethal && !short.includes(o)).slice(0, 4);
        short = short.concat(extras);
        const sims = await Promise.all(short.map(o => simulateOption(g, p.id, o, 2)));
        short.forEach((o, i) => {
          const r = sims[i];
          o.simScore = r ? r.e : null;
          o.vScore = r ? r.v : null;
        });
        // Blend the two evaluators after min-max normalising each across the
        // shortlist: evalState is in "hp points", the net is in win probability,
        // so raw averaging would be meaningless.
        const useVN = !!(window.ValueNet && g.valueWeight > 0 &&
          (g.valueSide == null || g.valueSide === p.id));
        if (useVN) {
          const evs = short.map(o => o.simScore).filter(v => v != null);
          const vs = short.map(o => o.vScore).filter(v => v != null);
          const norm = (v, lo, hi) => (hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo));
          const eLo = evs.length ? Math.min.apply(null, evs) : 0;
          const eHi = evs.length ? Math.max.apply(null, evs) : 0;
          const vLo = vs.length ? Math.min.apply(null, vs) : 0;
          const vHi = vs.length ? Math.max.apply(null, vs) : 0;
          const w = Math.max(0, Math.min(1, g.valueWeight));
          if (g.valueBlend === 'tiebreak' && short.length > 1) {
            // Only overrule the heuristic when it is genuinely indifferent:
            // keep everything within 0.08 (of the normalised eval range) of the
            // best move and let the net order that tied group.
            const en = short.map(o => (o.simScore == null ? -1e9 : norm(o.simScore, eLo, eHi)));
            const best = Math.max.apply(null, en);
            const tied = short.map((o, i) => i).filter(i => en[i] >= best - 0.08);
            if (tied.length > 1) {
              const scored = tied.map(i => ({ i, v: short[i].vScore == null ? 0.5 : short[i].vScore }));
              scored.sort((a, b) => b.v - a.v);
              const head = scored.map(s => short[s.i]);
              let k = 0;
              for (let i = 0; i < short.length; i++) {
                if (tied.indexOf(i) >= 0) short[i] = head[k++];
              }
            }
            short.forEach(o => { o.blend = o.simScore == null ? -1e9 : o.simScore; });
          } else if (g.valueBlend === 'rank' && short.length > 1) {
            // Rank blending is scale-free: a 0.02 eval difference and a 0.02
            // probability difference count the same, so noisy net output can
            // not drown a clear heuristic preference.
            const rankOf = (key) => {
              const idxs = short.map((o, i) => i)
                .filter(i => short[i][key] != null)
                .sort((a, b) => short[b][key] - short[a][key]);
              const out = new Array(short.length).fill(0.5);
              const n = idxs.length;
              idxs.forEach((i, pos) => { out[i] = n > 1 ? 1 - pos / (n - 1) : 0.5; });
              return out;
            };
            const er = rankOf('simScore');
            const vr = rankOf('vScore');
            short.forEach((o, i) => {
              if (o.simScore == null) { o.blend = -1e9; return; }
              o.blend = w * vr[i] + (1 - w) * er[i];
            });
          } else {
            short.forEach(o => {
              if (o.simScore == null) { o.blend = -1e9; return; }
              const en = evs.length > 1 ? norm(o.simScore, eLo, eHi) : 0.5;
              const vn = (o.vScore != null && vs.length > 1) ? norm(o.vScore, vLo, vHi) : en;
              o.blend = w * vn + (1 - w) * en;
            });
          }
          short.sort((a, b) => (b.blend - a.blend) || (b.score - a.score));
        } else {
          short.sort((a, b) => {
            const av = a.simScore == null ? -1e9 : a.simScore;
            const bv = b.simScore == null ? -1e9 : b.simScore;
            return bv - av || b.score - a.score;
          });
        }
        options.length = 0;
        options.push(...short);
        choice = options[0];
        // Exploration is only used by the offline self-play sampler: it keeps
        // the state distribution wide enough to learn a value function from.
        // Live play always keeps g.aiExplore at 0.
        if (g.aiExplore > 0 && options.length > 1 && g.rng() < g.aiExplore) {
          const k = 1 + Math.floor(g.rng() * Math.min(3, options.length - 1));
          choice = options[k];
        }
      }
    }

    AI.last = {
      diff,
      options: options.slice(0, 8).map(o => ({
        id: o.card.id, kind: o.kind, slot: o.slot, score: Math.round(o.score * 10) / 10,
        sim: o.simScore == null ? null : Math.round(o.simScore),
        v: o.vScore == null ? null : Math.round(o.vScore * 100) / 100
      })),
      choice: choice ? choice.card.id : null
    };
    if (choice && (choice.simScore != null || choice.score > 0.5)) {
      if (choice.kind === 'monster') {
        await g.playCard(p.id, choice.card.id, choice.slot, null);
      } else {
        const spec = g.getSpellSpec(p, choice.card);
        if (spec.type === 'none' || choice.target) {
          await g.playCard(p.id, choice.card.id, null, choice.target);
        }
      }
    }

    // Then all remaining useful abilities.
    await useAbilities(g, p, diff, false, trace);
    // Hard AI squeezes one extra pass for repeatable / newly affordable casts.
    if (diff === 'hard') await useAbilities(g, p, diff, false, trace);

    if (!g.aiDecisions) g.aiDecisions = [];
    if (g.aiDecisions.length < 400) {
      g.aiDecisions.push({
        turn: g.turn,
        player: playerId,
        diff,
        hp: [g.players[0].hp, g.players[1].hp],
        board: [g.creatures(0).length, g.creatures(1).length],
        card: choice ? choice.card.id : null,
        kind: choice ? choice.kind : null,
        score: choice ? Math.round(choice.score * 10) / 10 : null,
        sim: choice && choice.simScore != null ? Math.round(choice.simScore) : null,
        options: options.slice(0, 8).map(o => ({
          id: o.card.id, kind: o.kind, slot: o.slot,
          score: Math.round(o.score * 10) / 10,
          sim: o.simScore == null ? null : Math.round(o.simScore),
          v: o.vScore == null ? null : Math.round(o.vScore * 100) / 100
        })),
        trace: trace.slice()
      });
    }

    await g.endTurn();
  };

  // One fast heuristic turn (no simulations), used for opponent modelling.
  AI.fastTurn = async function (g, playerId) {
    const p = g.player(playerId);
    const diff = 'normal';
    await useAbilities(g, p, diff, true);
    const options = [];
    const ep = enemyPlayer(g, p);
    const existingFace = facePotential(g, p.id);
    for (const entry of p.deck) {
      const card = entry.card;
      if (!affordable(p, card)) continue;
      if (card.type === 'MONSTER') {
        for (const slot of freeSlots(g, p)) {
          let score = monsterValue(g, card) + placementScore(g, p, card, slot);
          if (!g.creatureAt(g.enemy(p.id), slot) && ep.hp <= card.atk) score += 12;
          options.push({ kind: 'monster', card, slot, target: null, score });
        }
      } else {
        const spec = g.getSpellSpec(p, card);
        const target = spec.type === 'none' ? null : pickTarget(g, p, spec, textOf(card));
        if (spec.type !== 'none' && !target) continue;
        let score = spellHeuristic(g, p, card);
        if (existingFace + directFaceDamage(g, p, card) >= ep.hp) score += 40;
        options.push({ kind: 'spell', card, slot: null, target, score });
      }
    }
    options.sort((a, b) => b.score - a.score);
    const choice = options[0];
    if (choice && choice.score > 0.5) {
      if (choice.kind === 'monster') await g.playCard(p.id, choice.card.id, choice.slot, null);
      else {
        const spec = g.getSpellSpec(p, choice.card);
        if (spec.type === 'none' || choice.target) await g.playCard(p.id, choice.card.id, null, choice.target);
      }
    }
    await useAbilities(g, p, diff, false);
    await g.endTurn();
  };
})();
