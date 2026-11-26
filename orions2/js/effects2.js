/* Card behaviours for Orions. Each entry may define:
   spell(g,p,target) / cast(g,self,target) and passive hooks. */
(function () {
  'use strict';

  const ELEMENTS = ['fire', 'water', 'air', 'earth', 'life', 'death'];
  const CARD = () => window.CARD_BY_ID;

  function tok(id) { return CARD()[id]; }
  function resolve(g, p, target) {
    if (!target) return null;
    if (target.creature) return target.creature;
    if (target.player) return null;
    const pid = target.side === 'own' ? p.id : g.enemy(p.id);
    return g.creatureAt(pid, target.slot);
  }
  function resolveSlot(g, p, target) {
    if (!target) return null;
    if (target.slot != null) return target.slot;
    return null;
  }
  function friends(g, c) { return g.creatures(c.owner).filter(x => x !== c); }
  function foes(g, c) { return g.enemyCreatures(c.owner); }
  function living(list) { return list.filter(x => x.card.element !== 'death'); }
  function undead(list) { return list.filter(x => x.card.element === 'death'); }
  function lowestHp(list) {
    return list.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || null;
  }
  function atkOf(c) {
    return Math.max(0, (c.baseAtk || 0) + (c.atkBonus || 0) + (c.tempAtk || 0));
  }
  function strongest(list) {
    return list.slice().sort((a, b) => (b.card.level * 100 + atkOf(b)) - (a.card.level * 100 + atkOf(a)))[0] || null;
  }
  function weakest(list) {
    return list.slice().sort((a, b) => (a.card.level * 100 + atkOf(a)) - (b.card.level * 100 + atkOf(b)))[0] || null;
  }
  function adjacentFoes(g, c) {
    const b = g.boardOf(g.enemy(c.owner));
    return [b[c.slot - 1], b[c.slot + 1]].filter(Boolean);
  }
  async function dmg(g, c, n, opts) {
    if (!c || !c.alive) return 0;
    return g.damageCreature(c, n, opts || { kind: 'spell' });
  }
  async function dmgPlayer(g, p, n, opts) {
    return g.damagePlayer(p, n, opts || { kind: 'spell' });
  }
  function guardianFirst(list) {
    return list.slice().sort((a, b) => a.id === 'guardian' ? -1 : (b.id === 'guardian' ? 1 : 0));
  }
  async function allEnemies(g, owner, n, opts) {
    for (const c of guardianFirst(g.enemyCreatures(owner))) {
      await dmg(g, c, n, Object.assign({ kind: 'spell', area: true }, opts));
    }
  }
  async function allCreatures(g, n, opts, filter, owner) {
    const list = (owner === 0 || owner === 1) ? g.allCreatures(owner) : g.allCreatures();
    for (const c of guardianFirst(list)) {
      if (filter && !filter(c)) continue;
      await dmg(g, c, n, Object.assign({ kind: 'spell', area: true }, opts));
    }
  }
  function countAir(g) { return g.allCreatures().filter(c => c.card.element === 'air').length; }

  const E = {};
  window.EFFECTS = E;

  /* ================================================================ FIRE */
  E['fire-spikes'] = {
    spell: async (g, p) => { await allEnemies(g, p.id, 3); }
  };
  E['forbidden-magic'] = {
    spell: async (g, p) => {
      const fire = g.allCreatures().filter(c => c.card.element === 'fire').length;
      const n = fire * 3;
      if (n > 0) await dmgPlayer(g, g.player(g.enemy(p.id)), n);
    }
  };
  E['wall-of-fire'] = {
    canAttack: async () => false, // 墙不参与战斗阶段
    onSummon: async (g, c) => { await allEnemies(g, c.owner, 4); },
    onTurnStart: async (g, c) => { await dmg(g, c, 4, { kind: 'ability', element: 'fire' }); }
  };
  E['blood-ritual'] = {
    spell: async (g, p) => {
      await g.gain(p, 'fire', 10);
      for (const c of g.creatures(p.id).slice()) await dmg(g, c, 3, { kind: 'spell', element: 'fire' });
    }
  };
  E['cerberus'] = {
    attackTargets: (g, c) => {
      const out = [];
      const o = g.opposite(c);
      if (o) out.push({ creature: o });
      else out.push({ player: g.enemy(c.owner) });
      for (const a of adjacentFoes(g, c)) out.push({ creature: a, mult: 0.5 });
      return out;
    }
  };
  E['flaming-arrow'] = {
    spell: async (g, p) => {
      const e = g.player(g.enemy(p.id));
      const diff = p.mana.fire - e.mana.fire;
      await dmgPlayer(g, e, diff > 0 ? diff * 2 : 1);
    }
  };
  E['imp'] = {
    onDamaged: async () => {},
    onDeath: async (g, c) => { await dmgPlayer(g, g.player(g.enemy(c.owner)), 4); }
  };
  E['demon'] = {
    castTarget: 'none',
    cast: async (g, c) => {
      const p = g.player(c.owner);
      await g.gain(p, 'fire', 2);
    }
  };
  E['devil'] = {
    castTarget: 'ownCreature',
    castFilter: c => c.card.element === 'fire' && c.id !== 'devil',
    cast: async (g, self, target) => {
      const p = g.player(self.owner);
      const t = resolve(g, p, target);
      if (!t) return;
      await g.kill(t, { kind: 'sacrifice', source: self });
      await g.gain(p, 'fire', 3);
      await g.healPlayer(p, 3);
    },
    onDeath: async (g, c) => { await dmgPlayer(g, g.player(c.owner), 10); }
  };
  E['fire-burst'] = {
    spell: async (g, p) => {
      const n = Math.floor(g.preCostMana(p, 'fire') / 2);
      for (const c of guardianFirst(g.enemyCreatures(p.id))) await dmg(g, c, n, { kind: 'spell', element: 'fire', area: true });
      const own = Math.floor(n / 2);
      for (const c of guardianFirst(g.creatures(p.id))) await dmg(g, c, own, { kind: 'spell', element: 'fire', area: true });
    }
  };
  E['ritual-flame'] = {
    spell: async (g, p) => {
      for (const c of g.allCreatures(p.id).slice()) {
        c.buffs = [];
        c.blessed = false;
        c.flags.airshield = false;
        if (c.card.element === 'fire') await g.healCreature(c, 2);
        else await dmg(g, c, 2, { kind: 'spell', element: 'fire' });
      }
    }
  };
  E['berserker'] = {
    repeatable: true,
    castTarget: 'none',
    castCost: { element: 'fire', amount: 0 },
    castCheck: (g, c) => {
      if (c.hp <= 4) return false;
      const o = g.opposite(c);
      return !(o && (o.id === 'evil-sorcerer' || o.id === 'red-drake' || o.id === 'ethereal'));
    },
    castReason: '生命值低于或等于 4，或对面免疫 Berserk 伤害，无法使用 Berserk。',
    cast: async (g, c) => {
      if (c.hp <= 4) return;
      const o = g.opposite(c);
      c.hp -= 6;
      await g.emit({ type: 'damage', player: c.owner, slot: c.slot, amount: 6, hp: c.hp, maxHp: c.maxHp, creature: c, kind: 'cost' });
      if (c.hp <= 0) { await g.kill(c, {}); return; }
      if (o) await dmg(g, o, 4, { kind: 'ability', element: 'fire', source: c, physical: true });
      else await dmgPlayer(g, g.player(g.enemy(c.owner)), 4, { kind: 'ability', element: 'fire', source: c });
    },
    onDeath: async () => {}
  };
  E['blind'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) {
        if (g.isWall(c) || c.id === 'evil-sorcerer') continue;
        c.atkBonus -= 2;
        c.stun += 1;
        await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'blind' });
      }
    }
  };
  E['red-drake'] = {
    onSummon: async (g, c) => { await allEnemies(g, c.owner, 3); }
  };
  E['fireball'] = {
    spell: async (g, p) => {
      const n = p.mana.fire + 3;
      await allEnemies(g, p.id, n, { element: 'fire' });
    }
  };
  E['salamander'] = {};
  E['blade-master'] = {
    castTarget: 'none',
    castCost: { element: 'fire', amount: 0 },
    cast: async (g, c) => {
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 2, { kind: 'ability', element: 'fire', source: c });
    }
  };
  E['diablo'] = {
    onAnyDeath: async (g, c, dead) => {
      if (dead.card.element === 'fire') await g.gain(g.player(c.owner), 'fire', 5);
    },
    castTarget: 'ownCreature',
    castFilter: (c, self) => c.card.element === 'fire' && c !== self,
    castCost: { element: 'fire', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await g.healCreature(t, 3);
      await g.buffAtk(t, 2, true);
    }
  };
  E['efreet'] = {
    onSummon: async (g, c) => {
      for (const e of g.enemyCreatures(c.owner).filter(x => x.card.element === 'water').slice()) {
        await dmg(g, e, 6, { kind: 'ability', element: 'fire', source: c });
      }
    },
    castTarget: 'ownCreature',
    castCost: { element: 'fire', amount: 2 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) await g.addBuff(t, 'fireshield');
    }
  };
  E['infernal'] = {
    onSummon: async (g, c) => {
      const fires = g.creatures(c.owner).filter(x => x !== c && x.card.element === 'fire');
      if (fires.length) {
        const w = weakest(fires);
        await g.kill(w, { kind: 'sacrifice', source: c });
      } else {
        c.hp = Math.ceil(c.maxHp / 2);
        await g.emit({ type: 'damage', player: c.owner, slot: c.slot, amount: Math.floor(c.maxHp / 2), hp: c.hp, maxHp: c.maxHp, creature: c, kind: 'cost' });
      }
    }
  };
  E['armageddon'] = {
    spell: async (g, p) => {
      await allCreatures(g, 25, { element: 'fire' }, null, p.id);
      await dmgPlayer(g, g.player(g.enemy(p.id)), 25, { kind: 'spell' });
      await dmgPlayer(g, p, 25, { kind: 'spell' });
    }
  };
  E['firelord'] = {
    onTurnStart: async (g, c) => {
      await g.gain(g.player(c.owner), 'fire', 1);
      await g.gain(g.player(g.enemy(c.owner)), 'fire', 1);
    },
    onDeath: async (g, c) => {
      await dmgPlayer(g, g.player(c.owner), 8);
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 8);
    },
    castTarget: 'anyCreature',
    castCost: { element: 'fire', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      if (g.isWall(t) || t.id === 'evil-sorcerer') return; // 墙/Evil 不受魔法攻击加成
      t.atkBonus += Math.ceil(t.baseAtk / 2);
      t.bloodlust = true;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'bloodlust' });
    }
  };
  E['vulcan'] = {
    onSummon: async (g, c) => {
      const p = g.player(g.enemy(c.owner));
      await g.gain(p, 'fire', -3);
      const o = g.opposite(c);
      if (o && o.id === 'vulcan') await dmg(g, o, 9, { kind: 'ability', element: 'fire', source: c });
    },
    castTarget: 'none',
    castCost: { element: 'fire', amount: 0 },
    cast: async (g, c) => {
      const amount = Math.floor(c.hp / 2);
      await g.kill(c, { kind: 'sacrifice' });
      await allCreatures(g, amount, { element: 'fire' }, null, c.owner);
    }
  };

  /* ================================================================ WATER */
  E['refresh'] = { spell: async (g, p) => { await g.healPlayer(p, 5); await g.gain(p, 'water', 2); } };
  E['tentacle'] = {
    attackTargets: (g, c) => {
      const all = g.enemyCreatures(c.owner);
      return all.length ? all.map(x => ({ creature: x })) : [{ player: g.enemy(c.owner) }];
    }
  };
  E['poison'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) {
        if (c.card.element === 'death') continue;
        await g.poisonCreature(c, 2);
        await dmg(g, c, 1, { kind: 'spell', element: 'water' });
      }
    }
  };
  E['sea-justice'] = {
    spell: async (g, p) => {
      for (const c of guardianFirst(g.enemyCreatures(p.id))) await dmg(g, c, Math.max(0, atkOf(c) - 1), { kind: 'spell', element: 'water', area: true });
    }
  };
  E['nixie'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'water', 1); },
    castTarget: 'none',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, c) => {
      const p = g.player(c.owner);
      await g.gain(p, 'water', 1);
    }
  };
  E['sea-monster'] = {
    afterAttackPlayer: async (g, c) => {
      const b = g.boardOf(c.owner);
      for (let s = c.slot + 1; s < 5; s++) {
        if (!b[s]) {
          b[c.slot] = null;
          c.slot = s;
          b[s] = c;
          await g.emit({ type: 'move', player: c.owner, slot: s, creature: c });
          break;
        }
      }
    },
    afterAttack: async (g, c) => {
      const b = g.boardOf(c.owner);
      for (let s = c.slot + 1; s < 5; s++) {
        if (!b[s]) {
          b[c.slot] = null;
          c.slot = s;
          b[s] = c;
          await g.emit({ type: 'move', player: c.owner, from: s - 1, slot: s, creature: c });
          break;
        }
      }
    },
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'sea-monster',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await dmg(g, t, 6, { kind: 'ability', element: 'water', source: self });
      await g.buffAtk(self, 2, true);
    }
  };
  E['solitude'] = {
    spell: async (g, p) => {
      const own = g.creatures(p.id);
      if (own.length === 1) { await g.buffAtk(own[0], 5, true); await g.healCreature(own[0], 3); }
    }
  };
  E['ice-guard'] = {};
  E['ice-wall'] = {
    canAttack: async () => false, // 墙不参与战斗阶段
    onTurnStart: async (g, c) => { await dmg(g, c, 2, { kind: 'ability', element: 'water' }); },
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'ice-wall',
    castCost: { element: 'water', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      const b = g.boardOf(self.owner);
      const a = self.slot, bb = t.slot;
      b[a] = t; t.slot = a;
      b[bb] = self; self.slot = bb;
      await g.emit({ type: 'move', player: self.owner, from: bb, slot: a, creature: self });
      await g.emit({ type: 'move', player: t.owner, from: a, slot: bb, creature: t });
      self.hp -= 1;
      await g.emit({ type: 'damage', player: self.owner, slot: self.slot, amount: 1, hp: self.hp, maxHp: self.maxHp, creature: self, kind: 'cost' });
      if (self.hp <= 0) await g.kill(self, {});
    }
  };
  E['rust'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) {
        if (c.id === 'evil-sorcerer') continue;
        c.flags.rust = true;
        await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'rust' });
      }
    }
  };
  E['scylla'] = {
    onSummon: async (g, c) => {
      await g.gain(g.player(c.owner), 'water', 3);
      await g.gain(g.player(g.enemy(c.owner)), 'water', 3);
    },
    onSummonAny: async (g, c, summoned) => {
      if (summoned.owner !== c.owner && summoned.card.element === 'water') {
        await g.gain(g.player(summoned.owner), 'water', 1);
      }
    },
    onSpellCast: async (g, c, caster, card) => {
      if (caster.id !== c.owner && card.element === 'water') await g.gain(g.player(caster.id), 'water', 1);
    },
    castTarget: 'none',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, c) => {
      await g.healCreature(c, 5);
      await g.gain(g.player(g.enemy(c.owner)), 'water', 2);
    }
  };
  E['water-troll'] = {
    onTurnStart: async (g, c) => { await g.healCreature(c, 3); },
    castTarget: 'none',
    castCost: { element: 'water', amount: 2 },
    cast: async (g, c) => {
      const o = g.opposite(c);
      if (o) await dmg(g, o, 2, { kind: 'ability', element: 'water', source: c });
      for (const a of adjacentFoes(g, c)) await dmg(g, a, 2, { kind: 'ability', element: 'water', source: c });
    }
  };
  E['elementalist'] = {
    castTarget: 'enemyCreature',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      self.flags.magicLink = t.uid;
      t.flags.magicLinkSource = self.uid;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'magiclink' });
    },
    onDamaged: async (g, c, amount, opts) => {
      // The link transfers the damage once. If the transferred hit came from
      // another link (chain > 0) it must not bounce back, or two linked
      // Elementalists would ping-pong forever.
      const chain = (opts && opts.chain) || 0;
      if (chain > 0 || !c.flags.magicLink) return;
      const t = g.allCreatures().find(x => x.uid === c.flags.magicLink);
      if (t && t.alive) {
        await dmg(g, t, amount, { kind: 'ability', element: 'water', source: c, chain: chain + 1 });
      }
    }
  };
  E['ice-bolt'] = {
    spell: async (g, p) => {
      await dmgPlayer(g, g.player(g.enemy(p.id)), 10 + Math.floor(p.mana.water / 2), { kind: 'spell', element: 'water' });
      await dmgPlayer(g, p, 6, { kind: 'spell', element: 'water' });
    }
  };
  E['poison-storm'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) await g.poisonCreature(c, 3);
    }
  };
  E['tsunami'] = {
    spell: async (g, p) => {
      for (const c of guardianFirst(g.enemyCreatures(p.id))) {
        await dmg(g, c, c.card.level, { kind: 'spell', element: 'water', area: true });
      }
    }
  };
  E['tython'] = {
    onTurnStart: async (g, c) => {
      await g.buffAtk(c, 1, true);
      await dmg(g, c, 2, { kind: 'ability', element: 'water' });
    },
    castTarget: 'none',
    castCost: { element: 'water', amount: 0 },
    castCheck: (g, c) => !c.sick && c.stun <= 0,
    castReason: '本回合不能攻击，无法施放 Disperse。',
    cast: async (g, c) => {
      const hp = c.hp;
      for (const f of g.creatures(c.owner).slice()) await g.healCreature(f, hp);
      await g.kill(c, { kind: 'sacrifice' });
    }
  };
  E['wash-away'] = {
    spell: async (g, p) => {
      const pool = g.enemyCreatures(p.id).filter(c => c.card.level < 6);
      pool.sort((a, b) => (a.card.level) - (b.card.level));
      for (const c of pool.slice(0, 2)) await g.kill(c, { kind: 'destroy' });
    }
  };
  E['giant-turtle'] = {
    castTarget: 'none',
    castCost: { element: 'water', amount: 3 },
    cast: async (g, c) => { c.flags.invincible = true; c.flags.invincibleUntil = g.turn + 1; await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'invincible' }); },
    onAttack: async (g, c, target, amount) => {
      if (target && target.hp <= 9) { await g.kill(target, { kind: 'attack', source: c }); return 0; }
      return amount;
    }
  };
  E['poseidon'] = {
    onSummonAny: async (g, c, summoned) => {
      if (summoned.card.element !== 'water') return;
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 4, { kind: 'ability', element: 'water', source: c });
      await g.healPlayer(g.player(c.owner), 2);
    },
    onSpellCast: async (g, c, caster, card) => {
      if (card.element !== 'water') return;
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 4, { kind: 'ability', element: 'water', source: c });
      await g.healPlayer(g.player(c.owner), 2);
    }
  };
  E['acid-storm'] = {
    spell: async (g, p) => {
      for (const c of guardianFirst(g.allCreatures(p.id))) {
        await dmg(g, c, 15, { kind: 'spell', element: 'water', area: true });
      }
      await g.healPlayer(p, 5);
    }
  };
  E['waterfall'] = {
    onSummonAny: async (g, c, summoned) => {
      if (summoned.card.element === 'water') await g.healCreature(c, 3);
    },
    onSpellCast: async (g, c, caster, card) => {
      if (card.element === 'water') await g.healCreature(c, 3);
    }
  };
  E['ice-wizard'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'water', 2); },
    castTarget: 'none',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, c) => {
      const p = g.player(c.owner);
      await g.healPlayer(p, p.mana.water * 2);
      await g.gain(p, 'water', -p.mana.water);
    }
  };
  E['ocean-lord'] = {
    onAttack: async (g, c, target, amount) => {
      if (target && target.card.element === 'water' && target.baseAtk > 1) {
        target.baseAtk = 1;
        await g.emit({ type: 'buff', player: target.owner, slot: target.slot, creature: target, kind: 'weaken' });
      }
      return amount;
    },
    onDeath: async (g, c) => {
      const slot = c.slot;
      if (!g.player(c.owner).board[slot]) await g.summon(c.owner, tok('tentacle'), slot, { reason: 'Ocean Lord' });
    },
    castTarget: 'emptyOwn',
    castCost: { element: 'water', amount: 3 },
    cast: async (g, c, target) => {
      const slot = target && target.slot;
      if (slot != null) await g.summon(c.owner, tok('tentacle'), slot, { reason: 'Ocean Lord' });
    }
  };
  E['paralyze'] = {
    spell: async (g, p) => {
      const e = g.player(g.enemy(p.id));
      e.skip = true;
      for (const c of g.creatures(e.id).slice()) if (c.id !== 'evil-sorcerer') c.stun += 1;
    }
  };
  E['leviathan'] = {
    onAttack: async (g, c) => {
      for (const e of guardianFirst(g.enemyCreatures(c.owner))) await dmg(g, e, 1, { kind: 'ability', element: 'water', source: c, area: true });
    },
    castTarget: 'none',
    castCost: { element: 'water', amount: 0 },
    castCheck: (g, c) => g.player(c.owner).mana.water > 6,
    castReason: '需要超过 6 点水元素。',
    cast: async (g, c) => {
      const p = g.player(c.owner);
      await g.healPlayer(p, 4);
    }
  };
  E['hydra'] = {
    attackTargets: (g, c) => {
      const out = [];
      const o = g.opposite(c);
      if (o) out.push({ creature: o });
      else out.push({ player: g.enemy(c.owner) });
      for (const a of adjacentFoes(g, c)) out.push({ creature: a });
      return out;
    },
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'water', -2); },
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'hydra',
    castCost: { element: 'water', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await g.healCreature(self, Math.floor(t.hp / 2));
      await g.kill(t, { kind: 'sacrifice', source: self });
    }
  };
  E['kraken'] = {
    onAttack: async (g, c, target) => {
      if (!target) return;
      const b = g.boardOf(target.owner);
      const order = target.slot < 2 ? [1, 2, 3, 4, 0] : [3, 2, 1, 0, 4];
      for (const s of order) {
        if (!b[s]) {
          b[target.slot] = null;
          target.slot = s;
          b[s] = target;
          await g.emit({ type: 'move', player: target.owner, slot: s, creature: target });
          return;
        }
        if (s === order[order.length - 1]) await dmg(g, target, 10, { kind: 'ability', element: 'water', source: c });
      }
    },
    castTarget: 'none',
    castCost: { element: 'water', amount: 3 },
    cast: async (g, c) => {
      const p = g.player(c.owner);
      const others = g.allCreatures().filter(x => x !== c);
      for (const x of others.slice()) {
        await g.kill(x, { kind: 'destroy' });
        for (const e of ELEMENTS) await g.gain(p, e, -1);
      }
    }
  };

  /* ================================================================ AIR */
  E['fairy'] = {
    onDeath: async (g, c) => {
      for (const f of g.creatures(c.owner).slice()) await g.buffAtk(f, 1, true);
    },
    castTarget: 'none',
    castCost: { element: 'air', amount: 1 },
    cast: async (g, c) => {
      const enemies = g.enemyCreatures(c.owner);
      if (!enemies.length) return;
      enemies.sort((a, b) => g.attackValue(b) - g.attackValue(a));
      const s = enemies[0];
      await dmgPlayer(g, g.player(s.owner), g.attackValue(s), { kind: 'ability', element: 'air', source: c });
    }
  };
  E['nymph'] = { onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'air', 1); } };
  E['starfall'] = {
    spell: async (g, p) => {
      const n = g.enemyCreatures(p.id).length * 2;
      if (n) await allEnemies(g, p.id, n, { element: 'air' });
    }
  };
  E['air-shield'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) await g.addBuff(c, 'airshield');
    }
  };
  E['healing-wind'] = {
    spell: async (g, p) => {
      const all = g.allCreatures();
      const air = all.filter(c => c.card.element === 'air').length;
      await g.healPlayer(p, all.length + 2 * air);
      await g.gain(p, 'air', 2);
    }
  };
  E['lightning-bolt'] = {
    spell: async (g, p) => {
      await dmgPlayer(g, g.player(g.enemy(p.id)), 7, { kind: 'spell', element: 'air' });
      const foes = g.enemyCreatures(p.id);
      if (foes.length) {
        foes.sort((a, b) => b.card.level - a.card.level);
        await dmg(g, foes[0], 7, { kind: 'spell', element: 'air' });
      }
    }
  };
  E['gargoyle'] = {
    castTarget: 'none',
    castCost: { element: 'air', amount: 3 },
    cast: async (g, c) => {
      c.flags.petrified = true;
      await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'petrify' });
    }
  };
  E['shadow-clone'] = {
    onSummon: async (g, c) => {
      const clones = g.creatures(c.owner).filter(x => x.id === 'shadow-clone');
      if (clones.length > 3) for (const x of clones) await g.kill(x, { kind: 'destroy' });
    },
    onDamaged: async (g, c, amount) => {
      if (g._cloneBurst || c.flags.cloneBurst) return;
      g._cloneBurst = true;
      c.flags.cloneBurst = true;
      try {
        const clones = g.creatures(c.owner).filter(x => x.id === 'shadow-clone' && x !== c && x.alive);
        for (const x of clones) await dmg(g, x, amount, { kind: 'ability' });
      } finally {
        c.flags.cloneBurst = false;
        g._cloneBurst = false;
      }
    },
    castTarget: 'emptyOwn',
    castCost: { element: 'air', amount: 2 },
    cast: async (g, c, target) => {
      const slot = target && target.slot;
      if (slot != null) await g.summon(c.owner, c.card, slot, { reason: 'Shadow Clone' });
    }
  };
  E['phoenix'] = {
    onDeath: async (g, c, opts) => {
      const el = opts && opts.element;
      if (el === 'fire') {
        const slot = c.slot;
        if (!g.player(c.owner).board[slot]) {
          const nc = await g.summon(c.owner, c.card, slot, { reason: 'rebirth' });
          if (nc) { nc.hp = nc.maxHp; }
        }
      }
    }
  };
  E['soul-of-winds'] = {
    onTurnStart: async (g, c) => { await dmg(g, c, 20, { kind: 'ability', element: 'air' }); }
  };
  E['astral-cloud'] = {};
  E['manticore'] = {
    castTarget: 'enemyCreature',
    castCost: { element: 'air', amount: 2 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t || t.id === 'evil-sorcerer') return;
      t.silenced = true;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'silence' });
    }
  };
  E['spellbreaker'] = {
    spell: async (g, p) => {
      g.player(p.id).spellImmune = true;
      for (const c of g.creatures(p.id).slice()) c.flags.spellImmune = true;
    }
  };
  E['black-wind'] = {
    spell: async (g, p) => {
      const e = strongest(g.enemyCreatures(p.id));
      if (e) await g.kill(e, { kind: 'destroy' });
    }
  };
  E['guardian'] = {
    onTurnStart: async (g, c) => { await dmg(g, c, 4, { kind: 'ability', element: 'air' }); },
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'guardian',
    castCost: { element: 'air', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      self.flags.protectSlot = t.slot;
      self.flags.protectUntil = g.turn + 2;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'protect' });
    }
  };
  E['wings-of-wisdom'] = {
    spell: async (g, p) => {
      for (const e of ELEMENTS) if (e !== 'air') await g.gain(p, e, 2);
      await g.healPlayer(p, 10);
    }
  };
  E['chain-lightning'] = {
    spell: async (g, p) => {
      const n = g.preCostMana(p, 'air');
      for (const c of guardianFirst(g.enemyCreatures(p.id))) await dmg(g, c, n, { kind: 'spell', element: 'air', area: true });
    }
  };
  E['lightning-lord'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'air', 1); },
    onSpellCast: async (g, c, caster, card) => {
      if (card.element === 'air' && caster.id === c.owner) await g.healCreature(c, 2);
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'air', amount: 3 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) {
        const p = g.player(self.owner);
        await dmg(g, t, g.preCostMana(p, 'air'), { kind: 'ability', element: 'air', source: self });
      }
    }
  };
  E['moonlight'] = {
    spell: async (g) => { for (const c of g.allCreatures(g.active).slice()) await g.healCreature(c, c.maxHp); }
  };
  E['zeus'] = {
    castTarget: 'enemyCreature',
    castFilter: c => c.card.level < 7,
    castCost: { element: 'air', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) await dmg(g, t, 4, { kind: 'ability', element: 'air', source: self });
    },
    onKill: async (g, c) => { await g.gain(g.player(c.owner), 'air', 1); }
  };
  E['kronos'] = {
    castTarget: 'enemyCreature',
    // Aging is a one-time curse: a creature that has already aged cannot be
    // aged again (otherwise Kronos could halve the same body every turn).
    castFilter: c => !c.flags.aged,
    castCost: { element: 'air', amount: 3 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t || t.flags.aged) return;
      t.flags.aged = true;
      t.maxHp = Math.max(1, Math.floor(t.maxHp / 2));
      t.hp = Math.min(t.hp, t.maxHp);
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'aging' });
    }
  };
  E['titan'] = {
    onSummon: async (g, c) => { await g.gain(g.player(g.enemy(c.owner)), 'air', -3); },
    castTarget: 'none',
    castCost: { element: 'air', amount: 1 },
    cast: async (g, c) => {
      for (const e of guardianFirst(g.enemyCreatures(c.owner).filter(x => x.card.element === 'earth'))) {
        await dmg(g, e, 3, { kind: 'ability', element: 'air', source: c, area: true });
      }
      await g.gain(g.player(c.owner), 'air', -1);
    }
  };
  E['plague'] = {
    spell: async (g) => {
      for (const c of g.allCreatures(g.active).slice()) {
        c.hp = 1;
        await g.emit({ type: 'damage', player: c.owner, slot: c.slot, amount: 0, hp: 1, maxHp: c.maxHp, creature: c, kind: 'plague' });
      }
    }
  };

  /* ================================================================ EARTH */
  E['satyr'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'earth', 1); },
    castTarget: 'none',
    castCost: { element: 'earth', amount: 0 },
    cast: async (g, c) => {
      const o = g.opposite(c);
      await g.kill(c, { kind: 'sacrifice' });
      if (o) await dmg(g, o, 10, { kind: 'ability', element: 'earth' });
      else await dmgPlayer(g, g.player(g.enemy(c.owner)), 5, { kind: 'ability', element: 'earth' });
    }
  };
  E['forest-spirit'] = {
    castTarget: 'none',
    castCost: { element: 'earth', amount: 2 },
    cast: async (g, c) => { await g.healPlayer(g.player(c.owner), 5); }
  };
  E['silence'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        await g.healCreature(c, 3);
        c.stun += 1;
      }
    }
  };
  E['dryad'] = {
    onSummonAny: async (g, c, summoned) => { if (summoned.card.element === 'earth') await g.healCreature(c, 2); },
    onSpellCast: async (g, c, caster, card) => { if (card.element === 'earth') await g.healCreature(c, 2); }
  };
  E['empower'] = {
    spell: async (g, p) => { for (const c of g.creatures(p.id).slice()) await g.buffAtk(c, 2, true); }
  };
  E['dispercer'] = {
    onDeath: async (g, c) => { for (const e of ELEMENTS) await g.gain(g.player(c.owner), e, 1); }
  };
  E['earth-chant'] = {
    spell: async (g, p) => {
      await g.gain(p, 'earth', 8);
      for (const e of ELEMENTS) if (e !== 'earth') await g.gain(p, e, -1);
    }
  };
  E['golem'] = {
    onTurnStart: async (g, c) => {
      const p = g.player(c.owner);
      if (p.mana.earth < 3) await dmg(g, c, 3, { kind: 'ability', element: 'earth' });
      else await g.healCreature(c, 3);
    }
  };
  E['revival'] = {
    spell: async (g, p) => {
      let n = 0;
      for (const c of g.creatures(p.id).slice()) { await g.healCreature(c, 4); n++; }
      await g.healPlayer(p, n * 2);
    }
  };
  E['scareling'] = {
    onTurnStart: async (g, c) => { await g.healCreature(c, 2); },
    canAttack: (g, c) => c.hp >= 7
  };
  E['centaur'] = {
    charge: true,
    castTarget: 'none',
    castCost: { element: 'earth', amount: 1 },
    cast: async (g, c) => {
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 3, { kind: 'ability', element: 'earth', source: c });
    }
  };
  E['giant-spider'] = {
    onSummon: async (g, c) => {
      if (g.creatures(c.owner).some(x => x !== c && x.card.element === 'earth')) await g.buffAtk(c, 3, true);
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'earth', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t && t.id !== 'evil-sorcerer') {
        // The web sticks to the creature, so moving it (Ice Wall and friends)
        // does not shake the debuff off.
        t.stun += 1;
        t.flags.web = true;
        await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'web' });
      }
    }
  };
  E['kobold'] = {
    onAttackPlayer: async (g, c, amount) => {
      await g.gain(g.player(g.enemy(c.owner)), 'earth', -1);
      return amount;
    }
  };
  E['quicksands'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).filter(x => x.card.level < 5).slice()) await g.kill(c, { kind: 'destroy' });
    }
  };
  E['restructure'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) { await g.buffMaxHp(c, 3); await g.healCreature(c, 6); }
    }
  };
  E['absolute-defence'] = {
    spell: async (g, p) => { for (const c of g.creatures(p.id).slice()) c.flags.absolute = true; }
  };
  E['elven-archer'] = {
    castTarget: 'enemyCreature',
    castCost: { element: 'earth', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) await dmg(g, t, 5, { kind: 'ability', element: 'earth', source: self, physical: true });
    }
  };
  E['enchanter'] = {
    onTurnStart: async (g, c) => {
      const dying = c.hp <= 3;
      for (const f of g.creatures(c.owner).slice()) await g.healCreature(f, 1);
      if (dying) {
        await g.kill(c, { kind: 'ability' });
        for (const f of g.creatures(c.owner).slice()) await g.healCreature(f, 5);
      }
    },
    castTarget: 'none',
    castCost: { element: 'earth', amount: 2 },
    cast: async (g, c) => { await g.healCreature(c, 4); }
  };
  E['ent'] = {
    attackTargets: (g, c) => {
      const o = g.opposite(c);
      return [{ player: g.enemy(c.owner) }].concat(o ? [{ creature: o }] : []);
    },
    castTarget: 'none',
    castCost: { element: 'earth', amount: 0 },
    cast: async (g, c) => {
      for (const e of guardianFirst(g.enemyCreatures(c.owner))) await dmg(g, e, 1, { kind: 'ability', element: 'earth', source: c, area: true });
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 1, { kind: 'ability', element: 'earth', source: c });
      await dmg(g, c, 2, { kind: 'ability', element: 'earth' });
    }
  };
  E['force-of-nature'] = {
    spell: async (g, p) => {
      for (const c of guardianFirst(g.enemyCreatures(p.id))) {
        await dmg(g, c, Math.floor(c.hp / 2), { kind: 'spell', element: 'earth', area: true });
      }
    }
  };
  E['python'] = {
    onAttack: async (g, c, target) => {
      if (target && g.attackValue(target) >= 3) await g.buffAtk(target, -1, true);
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'earth', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t && t.hp <= 5) await g.kill(t, { kind: 'destroy', source: self });
    }
  };
  E['earthquake'] = {
    spell: async (g, p) => {
      for (const c of guardianFirst(g.enemyCreatures(p.id))) {
        const before = c.alive;
        await dmg(g, c, 12, { kind: 'spell', element: 'earth', area: true });
        if (before) await g.gain(p, 'earth', 1);
      }
    }
  };
  E['echidna'] = {
    onAttack: async (g, c, target) => {
      if (target) await g.poisonCreature(target, 2);
    },
    onTurnStart: async (g, c) => {
      for (const x of g.allCreatures().filter(y => y.poison > 0)) {
        await dmg(g, x, 1, { kind: 'ability', element: 'earth', source: c });
      }
    }
  };
  E['polymorph'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).filter(x => x.card.level < 8).slice()) {
        c.card = tok('satyr');
        c.id = 'satyr';
        c.name = 'SATYR';
        c.card.element;
        await g.emit({ type: 'polymorph', player: c.owner, slot: c.slot, creature: c });
      }
    }
  };
  E['elemental'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'earth', 2); },
    castTarget: 'ownCreature',
    castCost: { element: 'earth', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) await g.addBuff(t, 'stoneskin');
    }
  };

  /* ================================================================ LIFE */
  E['magic-healer'] = {};
  E['ice-guard'] = {};
  E['astral-cloud'] = {};
  E['vampire'] = {};
  E['peace'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) await g.buffAtk(c, -1, true);
    }
  };
  E['priest'] = {
    onTurnStart: async (g, c) => {
      const p = g.player(c.owner);
      await g.gain(p, 'life', 2);
      await g.gain(p, 'death', -2);
    },
    onSpellCast: async (g, c, caster, card) => {
      if (card.element === 'death' && caster.id === c.owner) await g.gain(g.player(c.owner), 'life', -3);
    }
  };
  E['swordsman'] = {
    canAttack: (g, c) => {
      const o = g.opposite(c);
      return !(o && o.card.element === 'life');
    }
  };
  E['apostate'] = {
    onTurnStart: async (g, c) => {
      const p = g.player(c.owner);
      await g.gain(p, 'life', -2);
      await g.gain(p, 'death', 1);
    },
    castTarget: 'none',
    castCost: { element: 'life', amount: 0 },
    cast: async (g, c) => {
      const slot = c.slot;
      const owner = c.owner;
      const b = await g.transform(owner, slot, tok('banshee'), { reason: 'Apostate' });
      if (b) { b.hp = Math.ceil(b.maxHp / 2); }
    }
  };
  E['bless'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        if (c.blessed || c.id === 'evil-sorcerer') continue;
        c.blessed = true;
        await g.buffAtk(c, 1, true);
        await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'blessed' });
      }
    }
  };
  E['pure-heart'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        if (c.card.element === 'death' || c.id === 'evil-sorcerer') continue;
        await g.buffAtk(c, 2, true);
        c.flags.pureHeart = true;
        await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'pureheart' });
      }
    }
  };
  E['cure-wounds'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        const missing = c.maxHp - c.hp;
        if (missing > 0) await g.healCreature(c, Math.floor(missing / 2));
      }
    }
  };
  E['hermit'] = {
    onTurnStart: async (g, c) => { await g.healCreature(c, 2); },
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'hermit',
    castCost: { element: 'life', amount: 4 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      t.flags.giftOfLife = true;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'gift' });
      await g.kill(self, { kind: 'sacrifice' });
    }
  };
  E['pegasus'] = {
    onSummon: async (g, c) => {
      for (const f of g.creatures(c.owner).slice()) { await g.healCreature(f, 3); await g.removeDebuffs(f); }
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'life', amount: 2 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await dmg(g, t, 5, { kind: 'ability', element: 'life', source: self });
      if (t.card.element === 'death') await dmg(g, self, 3, { kind: 'ability', element: 'life' });
    }
  };
  E['rejuvenation'] = {
    spell: async (g, p) => {
      const n = g.preCostMana(p, 'life');
      await g.healPlayer(p, n * 3);
      await g.gain(p, 'life', -n);
      for (const c of g.creatures(p.id).filter(x => x.blessed)) await g.healCreature(c, 3);
    }
  };
  E['ethereal'] = {
    onSummonAny: async (g, c, summoned) => {
      if (summoned.owner === c.owner && (summoned.card.element === 'life' || summoned.card.element === 'earth')) {
        await g.healPlayer(g.player(c.owner), 3);
      }
    }
  };
  E['monk'] = {
    onTurnStart: async (g, c) => {
      for (const f of g.creatures(c.owner)) await g.healCreature(f, 1);
      await g.healPlayer(g.player(c.owner), 2);
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'life', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      if (g.isWall(t)) return; // 墙不受攻击改变（max(1,..) 会让 0 攻反而+1）
      const cur = g.attackValue(t);
      const next = Math.max(1, cur - 2);
      t.atkBonus += next - cur;
      await g.emit({ type: 'buff', player: t.owner, slot: t.slot, creature: t, kind: 'weaken' });
    }
  };
  E['purify'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) await g.healCreature(c, 4);
      for (const c of guardianFirst(g.enemyCreatures(p.id))) await dmg(g, c, 4, { kind: 'spell', element: 'life', area: true });
    }
  };
  E['eternal-light'] = {
    spell: async (g, p) => {
      await g.healPlayer(p, 5);
      for (const c of g.creatures(p.id).slice()) await g.healCreature(c, 5);
      for (const c of guardianFirst(g.enemyCreatures(p.id).filter(x => x.card.element === 'death'))) await dmg(g, c, 5, { kind: 'spell', element: 'life', area: true });
    }
  };
  E['life-sacrifice'] = {
    spell: async (g, p) => {
      const n = p.mana.life;
      await dmgPlayer(g, p, n, { kind: 'cost' });
      await dmgPlayer(g, g.player(g.enemy(p.id)), n * 2, { kind: 'spell', element: 'life' });
    }
  };
  E['paladin'] = {
    castTarget: 'enemyCreature',
    castFilter: c => c.card.element === 'death',
    castCost: { element: 'life', amount: 2 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t || t.card.element !== 'death') return;
      await g.kill(t, { kind: 'destroy', source: self });
      await dmg(g, self, 10, { kind: 'ability', element: 'life' });
      await g.gain(g.player(self.owner), 'life', -2);
    }
  };
  E['valor'] = {
    onTurnStart: async (g, c) => { await g.healCreature(c, 1); },
    onAttack: async (g, c, target, amount) => {
      if (target && target.card.element === 'death') await g.healCreature(c, 4);
      return amount;
    },
    castTarget: 'none',
    castCost: { element: 'life', amount: 3 },
    cast: async (g, c) => {
      await g.healCreature(c, 5);
      for (const f of g.creatures(c.owner).filter(x => x !== c)) await g.healCreature(f, 2);
      for (const e of g.enemyCreatures(c.owner).slice()) await g.healCreature(e, 1);
    }
  };
  E['armor-of-god'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        if (c.id === 'evil-sorcerer') continue;
        await g.removeDebuffs(c);
        await g.healCreature(c, 6);
        c.blessed = true;
        await g.buffAtk(c, 1, true);
      }
    }
  };
  E['unicorn'] = {
    onSummon: async (g, c) => {
      for (const f of g.creatures(c.owner).slice()) { f.poison = 0; }
    },
    castTarget: 'none',
    castCost: { element: 'life', amount: 2 },
    cast: async (g, c) => {
      for (const e of g.enemyCreatures(c.owner).slice()) {
        e.blessed = false;
        e.buffs = [];
        e.atkBonus = 0;
        await g.emit({ type: 'cleanse', player: e.owner, slot: e.slot, creature: e });
      }
    }
  };
  E['avatar'] = {
    onSummon: async (g, c) => {
      const p = g.player(c.owner);
      c.maxHp = p.hp;
      c.hp = p.hp;
      for (const other of g.creatures(c.owner)) {
        if (other !== c && other.id === 'avatar') await g.kill(other, { kind: 'destroy' });
      }
    }
  };
  E['gods-wrath'] = {
    spell: async (g, p) => {
      let n = 0;
      for (const c of g.allCreatures(p.id).filter(x => x.card.element === 'death').slice()) {
        await g.kill(c, { kind: 'destroy' });
        n++;
      }
      await g.gain(p, 'life', n * 3);
      await g.healPlayer(p, n);
    }
  };
  E['knight'] = {
    onTurnStart: async (g, c) => {
      const own = g.creatures(c.owner);
      const low = lowestHp(own);
      if (low) await g.healCreature(low, 2);
    },
    onAbilityCast: async (g, c, caster) => {
      if (caster.card.element === 'death') await dmg(g, caster, 3, { kind: 'ability', element: 'life', source: c });
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'life', amount: 3 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await dmg(g, t, 6, { kind: 'ability', element: 'life', source: self });
      const foes = g.enemyCreatures(self.owner).filter(x => x !== t);
      if (foes.length) {
        const share = Math.max(1, Math.floor(6 / foes.length));
        for (const f of foes) await dmg(g, f, share, { kind: 'ability', element: 'life', source: self });
      }
    }
  };
  E['chimera'] = {
    onSummonAny: async (g, c, summoned) => {
      if (summoned.owner === c.owner) await g.healPlayer(g.player(c.owner), summoned.card.level);
    }
  };

  /* ================================================================ DEATH */
  E['ghost'] = {
    castTarget: 'none',
    castCost: { element: 'death', amount: 0 },
    cast: async (g, c) => {
      await dmgPlayer(g, g.player(c.owner), 2, { kind: 'cost' });
      await g.gain(g.player(c.owner), 'death', 1);
    }
  };
  E['skeleton'] = {
    onTurnStart: async (g, c) => {
      await g.gain(g.player(c.owner), 'death', 1);
      await g.healCreature(c, 1);
    },
    onAttack: async (g, c, target, amount) => {
      if (target && target.hp <= 6) amount += 2;
      return amount;
    }
  };
  E['curse'] = {
    spell: async (g, p) => {
      const e = g.player(g.enemy(p.id));
      for (const el of ELEMENTS) await g.gain(e, el, -1);
    }
  };
  E['undead-swarm'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).filter(x => x.card.element === 'death')) {
        const o = g.opposite(c);
        if (o) await dmg(g, o, g.attackValue(c), { kind: 'attack', element: 'death', source: c });
      }
    }
  };
  E['zombie'] = {
    onKill: async (g, c) => {
      c.hp = c.maxHp;
      c.maxHp += 3;
      c.hp += 3;
      await g.emit({ type: 'heal', player: c.owner, slot: c.slot, amount: 3, hp: c.hp, maxHp: c.maxHp, creature: c });
    }
  };
  E['shadow'] = {
    castTarget: 'ownCreature',
    castFilter: c => c.id !== 'shadow',
    castCost: { element: 'death', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      // Blend: max HP +10 does not itself heal; the separate +10 current HP
      // is applied afterwards so a full-health target still gains 10 current HP.
      await g.buffMaxHp(t, 10);
      await g.healCreature(t, 10);
      await g.kill(self, { kind: 'sacrifice' });
    }
  };
  E['evil-sorcerer'] = {
    castTarget: 'none',
    castCost: { element: 'death', amount: 1 },
    cast: async (g, c) => {
      const o = g.opposite(c);
      if (o) await dmg(g, o, 2, { kind: 'ability', element: 'death', source: c });
    }
  };
  E['steal-life'] = {
    spell: async (g, p) => {
      const e = g.player(g.enemy(p.id));
      const n = g.preCostMana(p, 'death');
      if (n <= 0) return;
      await dmgPlayer(g, e, n, { kind: 'spell', element: 'death' });
      await g.healPlayer(p, n);
    }
  };
  E['werewolf'] = {
    onDeath: async (g, c) => {
      const slot = c.slot;
      if (!g.player(c.owner).board[slot]) await g.summon(c.owner, tok('ghost'), slot, { reason: 'Werewolf' });
    },
    castTarget: 'none',
    castCost: { element: 'death', amount: 3 },
    // Blood Rage doubles the attack value for the rest of the turn. It does not
    // grant an attack: summoning sickness still applies, but the doubled value
    // stays useful (UNDEAD SWARM hits for attackValue without a normal attack).
    cast: async (g, c) => {
      c.tempAtk += g.attackValue(c);
      await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'bloodrage' });
    }
  };
  E['assassin'] = {
    castTarget: 'enemyCreature',
    castCost: { element: 'death', amount: 4 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t && t.hp <= 9) await g.kill(t, { kind: 'destroy', source: self });
    }
  };
  E['banshee'] = {
    onSummon: async (g, c) => { await dmgPlayer(g, g.player(g.enemy(c.owner)), 8, { kind: 'ability', element: 'death', source: c }); },
    onAttackPlayer: async (g, c, amount) => {
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 10, { kind: 'ability', element: 'death', source: c });
      await g.kill(c, { kind: 'sacrifice' });
      return 0;
    }
  };
  E['black-mage'] = {
    onTurnStart: async (g, c) => {
      const p = g.player(c.owner);
      if (p.mana.death <= 2) await g.gain(p, 'death', 3 - p.mana.death);
    },
    onAbilityCast: async (g, c, caster) => {
      if (caster.owner !== c.owner) await dmg(g, caster, 4, { kind: 'ability', element: 'death', source: c });
    },
    castTarget: 'ownCreature',
    castFilter: c => c.card.element !== 'death',
    castCost: { element: 'death', amount: 0 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      const slot = t.slot;
      const sk = await g.transform(t.owner, slot, tok('skeleton'), { reason: 'Extract Soul' });
      if (sk) sk.hp = 10;
    }
  };
  E['enslave'] = {
    spell: async (g, p) => {
      const e = strongest(g.enemyCreatures(p.id));
      if (!e) return;
      const free = g.freeSlots(p.id);
      if (free.length < 2) { await g.kill(e, { kind: 'destroy' }); return; }
      const slot = free[0];
      const old = e.slot;
      g.boardOf(g.enemy(p.id))[old] = null;
      e.owner = p.id;
      e.slot = slot;
      e.sick = true;
      g.player(p.id).board[slot] = e;
      await g.emit({ type: 'move', player: p.id, slot, creature: e });
    }
  };
  E['dark-lord'] = {
    onAnyDeath: async (g, c) => {
      await g.healPlayer(g.player(c.owner), 3);
      await g.healCreature(c, 2);
    }
  };
  E['death-rage'] = {
    spell: async (g, p) => {
      for (const c of g.creatures(p.id).slice()) {
        if (c.id === 'evil-sorcerer') continue;
        c.deathRage = true;
        c.temp.deathRage = true;
        await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'deathrage' });
      }
    }
  };
  E['necromancer'] = {
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'death', 1); },
    onSpellCast: async (g, c, caster, card) => {
      if (card.element === 'death' && caster.id === c.owner) await g.buffAtk(c, 2, true);
    },
    castTarget: 'emptyOwn',
    castCost: { element: 'death', amount: 0 },
    castCheck: (g) => !!g.necroDeath,
    castReason: '还没有生物在 Necromancer 在场时死亡。',
    cast: async (g, c, target) => {
      g.necroDeath = false;
      const slot = target && target.slot;
      if (slot != null) await g.summon(c.owner, tok('ghost'), slot, { reason: 'Dark Summon' });
    }
  };
  E['total-weakness'] = {
    spell: async (g, p) => {
      for (const c of g.enemyCreatures(p.id).slice()) {
        if (c.id === 'evil-sorcerer') continue;
        c.atkBonus -= Math.floor(atkOf(c) / 2);
      }
    }
  };
  E['unholy-word'] = {
    spell: async (g, p) => {
      const e = g.player(g.enemy(p.id));
      await dmgPlayer(g, e, 10, { kind: 'spell', element: 'death' });
      for (const el of ELEMENTS) await g.gain(e, el, -2);
    }
  };
  E['vampire'] = {};
  E['lich'] = {
    onSummon: async (g, c) => {
      const b = g.boardOf(g.enemy(c.owner));
      const targets = [c.slot - 1, c.slot, c.slot + 1]
        .filter(s => s >= 0 && s < 5 && b[s]).map(s => b[s]);
      for (const t of guardianFirst(targets)) {
        await dmg(g, t, 10, { kind: 'ability', element: 'death', source: c, area: true });
      }
    },
    castTarget: 'none',
    castCost: { element: 'death', amount: 0 },
    cast: async (g, c) => {
      await dmgPlayer(g, g.player(g.enemy(c.owner)), 7, { kind: 'ability', element: 'death', source: c });
    }
  };
  E['raise-dead'] = {
    spell: async (g, p) => {
      const n = Math.min(5, p.mana.death);
      for (let i = 0; i < n; i++) {
        const free = g.freeSlots(p.id);
        if (!free.length) break;
        await g.summon(p.id, tok('skeleton'), free[0], { reason: 'Raise Dead' });
      }
      await g.gain(p, 'death', -p.mana.death);
    }
  };
  E['cover-of-darkness'] = {
    spell: async (g, p) => {
      for (const c of g.allCreatures(p.id).slice()) {
        if (c.card.element === 'death') await g.healCreature(c, 5);
        else await dmg(g, c, 13, { kind: 'spell', element: 'death' });
      }
    }
  };
  E['dark-druid'] = {
    onAnyDeath: async (g, c, dead) => {
      if (dead.owner !== c.owner) await g.healPlayer(g.player(c.owner), dead.card.level);
    },
    onSpellCast: async (g, c, caster, card) => {
      if (caster.id !== c.owner) await dmgPlayer(g, g.player(caster.id), card.level, { kind: 'ability', element: 'death', source: c });
    }
  };
  E['grim-reaper'] = {
    onAnyDeath: async (g, c) => { await g.gain(g.player(c.owner), 'death', 1); },
    castTarget: 'enemyCreature',
    castFilter: c => c.card.level <= 3,
    castCost: { element: 'death', amount: 3 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (!t) return;
      await g.kill(t, { kind: 'destroy', source: self });
    }
  };
  E['chaos-vortex'] = {
    spell: async (g, p) => {
      for (const c of g.allCreatures(p.id).slice()) {
        await g.kill(c, { kind: 'destroy' });
        await g.gain(p, 'death', 1);
      }
    }
  };

  /* ================================================================ ORIONS 2 EXTRAS */
  E['disperser'] = E['dispercer'];
  E['earthchant'] = E['earth-chant'];
  E['moon-cast'] = E['moonlight'];

  E['lava-spider'] = {
    onTurnStart: async (g, c) => {
      c.maxHp += 2;
      await g.emit({ type: 'buff', player: c.owner, slot: c.slot, creature: c, kind: 'maxhp', amount: 2 });
      await g.healCreature(c, 2);
    },
    castTarget: 'enemyCreature',
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t) await dmg(g, t, 4, { kind: 'ability', element: 'fire', source: self });
    }
  };

  E['fire-storm'] = {
    spell: async (g, p) => {
      const foes = g.enemyCreatures(p.id);
      for (const c of guardianFirst(foes)) await dmg(g, c, 9, { kind: 'spell', element: 'fire', area: true });
      if (foes.length) await dmgPlayer(g, g.player(g.enemy(p.id)), foes.length * 3, { kind: 'spell', element: 'fire' });
    }
  };

  E['bloody-wind'] = {
    spell: async (g, p) => {
      const foes = g.enemyCreatures(p.id);
      if (!foes.length) return;
      foes.sort((a, b) => b.card.level - a.card.level);
      await g.kill(foes[0], { kind: 'destroy' });
    }
  };

  E['moloch'] = {
    onSummon: async (g, c) => {
      for (const e of guardianFirst(g.enemyCreatures(c.owner))) {
        await dmg(g, e, e.card.level, { kind: 'ability', element: 'earth', source: c, area: true });
      }
    },
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'earth', 1); }
  };

  E['mega-worm'] = {
    onTurnStart: async (g, c) => {
      for (const f of g.creatures(c.owner).slice()) {
        await dmg(g, f, 3, { kind: 'ability', element: 'earth', source: c });
      }
    }
  };

  E['slug'] = {
    onAttack: async (g, c, target) => {
      if (target && target.card.element !== 'death') await g.poisonCreature(target, 1);
    },
    castTarget: 'enemyCreature',
    castCost: { element: 'death', amount: 1 },
    cast: async (g, self, target) => {
      const t = resolve(g, g.player(self.owner), target);
      if (t && t.card.element !== 'death') await g.poisonCreature(t, 1);
    }
  };

  E['elemental-water'] = {
    onSummon: async (g, c) => {
      for (const f of g.creatures(c.owner).filter(x => x.card.element === 'water')) await g.buffMaxHp(f, 3);
    },
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'water', 1); }
  };

  E['elemental-fire'] = {
    onSummon: async (g, c) => {
      const o = g.opposite(c);
      if (o) await dmg(g, o, 9, { kind: 'ability', element: 'fire', source: c });
      await g.gain(g.player(g.enemy(c.owner)), 'fire', -3);
    },
    onTurnStart: async (g, c) => { await g.gain(g.player(c.owner), 'fire', 1); }
  };
})();

