#!/usr/bin/env node
/* Orions 2 — self-play sampler for the value network.
 *
 * Both sides are driven by the normal heuristic AI, with a small amount of
 * score-based exploration so the states are not all from one narrow line.
 * At every decision point we snapshot the state features (from the point of
 * view of the side that is about to move) and later label that row with the
 * eventual result of the duel.
 *
 * Usage:
 *   node tools/selfplay.js --games 2000 --seed 1 --explore 0.12 \
 *        --out tools/data/selfplay.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnv, playMatch } = require('./lib/env.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

async function main() {
  const games = parseInt(arg('games', '1000'), 10);
  const seed0 = parseInt(arg('seed', '1'), 10);
  const explore = parseFloat(arg('explore', '0.12'));
  const mirror = arg('mirror', '0') === '1';
  const diff = arg('diff', 'normal');
  const out = path.resolve(arg('out', path.join(__dirname, 'data', 'selfplay.json')));

  if (!fs.existsSync(path.dirname(out))) fs.mkdirSync(path.dirname(out), { recursive: true });

  const ctx = loadEnv();
  const rows = [];
  const featureNames = ctx.ValueNet.FEATURES;
  let p0Wins = 0, p1Wins = 0, turns = 0, skipped = 0;
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const samples = [];
    let g;
    try {
      g = await playMatch(ctx, {
        seed: seed0 + i,
        difficulty: diff,
        aiExplore: explore,
        onDecision: (game, me) => {
          const x = ctx.ValueNet.featurize(game, me);
          if (x.length !== featureNames.length) return;
          // Mirroring the same position for the other side is free symmetry
          // augmentation: the game is symmetric up to who moves first.
          const xm = mirror ? ctx.ValueNet.featurize(game, 1 - me) : null;
          samples.push({ me, x, xm });
        }
      });
    } catch (err) {
      skipped++;
      console.warn('skip seed ' + (seed0 + i) + ': ' + err.message);
      continue;
    }
    if (g.winner == null) { skipped++; continue; }
    turns += g.turn;
    if (g.winner === 0) p0Wins++; else p1Wins++;
    for (const s of samples) {
      // Skip rows recorded for a side that is not actually the winner/loser
      // in a finished game (they still carry a valid label: did that side win).
      const y = s.me === g.winner ? 1 : 0;
      rows.push({ y, x: s.x.map(v => Math.round(v * 1000) / 1000) });
      if (s.xm) rows.push({ y: 1 - y, x: s.xm.map(v => Math.round(v * 1000) / 1000) });
    }
    if ((i + 1) % 200 === 0) {
      const rate = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write('\r' + (i + 1) + '/' + games + ' games · ' + rows.length +
        ' rows · ' + rate + 's');
    }
  }
  process.stdout.write('\n');

  const payload = {
    schema: 'orions2-selfplay/v1',
    createdAt: new Date().toISOString(),
    meta: {
      games,
      seed: seed0,
      explore,
      mirror,
      difficulty: diff,
      features: featureNames,
      p0Wins,
      p1Wins,
      avgTurns: games ? Math.round((turns / games) * 10) / 10 : 0,
      skipped
    },
    rows
  };
  fs.writeFileSync(out, JSON.stringify(payload));
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log('wrote ' + out + ' (' + rows.length + ' rows, ' + mb + ' MB)');
  console.log('games ' + (p0Wins + p1Wins) + ' · p0 ' + p0Wins + ' / p1 ' + p1Wins +
    ' · avg turns ' + payload.meta.avgTurns + ' · label mean ' +
    (rows.length ? (rows.reduce((s, r) => s + r.y, 0) / rows.length).toFixed(3) : '-'));
}

main().catch(err => { console.error(err); process.exit(1); });
