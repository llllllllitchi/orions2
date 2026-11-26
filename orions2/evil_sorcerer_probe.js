/* 第五轮：全量法术扫描 —— 哪些法术能作用于 Evil Sorcerer */
const fs = require('fs'), vm = require('vm');
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['cards2-data.js', 'effects2.js', 'engine.js']) vm.runInContext(fs.readFileSync('js/' + f, 'utf8'), ctx, { filename: f });
const W = ctx.window;
const CARD = id => W.CARDS.find(c => c.id === id);

async function run(spellId) {
  const g = new W.Game({ rng: () => 0.5 });
  g.turn = 9;
  const es = await g.summon(0, CARD('evil-sorcerer'), 2, { charge: true });
  for (const e of ['fire', 'water', 'air', 'earth', 'life', 'death']) { g.player(0).mana[e] = 40; g.player(1).mana[e] = 40; }
  const fx = W.EFFECTS[spellId];
  const before = { hp: es.hp, maxHp: es.maxHp, poison: es.poison, stun: es.stun, silenced: es.silenced, buffs: es.buffs.slice(), flags: JSON.stringify(es.flags), atk: g.attackValue(es) };
  await fx.spell(g, g.player(1), { creature: es, slot: 2 });
  const after = { hp: es.hp, maxHp: es.maxHp, alive: es.alive, poison: es.poison, stun: es.stun, silenced: es.silenced, buffs: es.buffs.slice(), flags: JSON.stringify(es.flags), atk: g.attackValue(es) };
  const changes = [];
  if (!after.alive) changes.push('被击杀');
  if (after.hp !== before.hp) changes.push('HP ' + before.hp + '→' + after.hp);
  if (after.maxHp !== before.maxHp) changes.push('最大HP ' + before.maxHp + '→' + after.maxHp);
  if (after.poison !== before.poison) changes.push('毒 ' + after.poison);
  if (after.stun !== before.stun) changes.push('眩晕 ' + after.stun);
  if (after.silenced) changes.push('沉默');
  if (after.buffs.join() !== before.buffs.join()) changes.push('buff: ' + after.buffs.join('/'));
  if (after.flags !== before.flags) changes.push('flags: ' + after.flags);
  if (after.atk !== before.atk) changes.push('攻击 ' + before.atk + '→' + after.atk);
  return changes;
}

(async () => {
  const spells = Object.keys(W.EFFECTS).filter(k => typeof W.EFFECTS[k].spell === 'function');
  const hit = [], none = [], err = [];
  for (const id of spells) {
    try {
      const ch = await run(id);
      if (ch.length) hit.push(id + ' → ' + ch.join('，'));
      else none.push(id);
    } catch (e) { err.push(id + ': ' + e.message); }
  }
  console.log('法术总数 ' + spells.length);
  console.log('\n【对 Evil Sorcerer 有实际作用】' + hit.length + ' 个');
  hit.forEach(x => console.log('  ' + x));
  console.log('\n【完全无效（免疫或本就不打它）】' + none.length + ' 个');
  console.log('  ' + none.join(', '));
  if (err.length) { console.log('\n【异常】'); err.forEach(x => console.log('  ' + x)); }
})();
