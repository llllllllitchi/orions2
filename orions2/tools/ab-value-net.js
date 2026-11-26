#!/usr/bin/env node
/* Orions 2 — A/B duel harness.
 *
 * Arm A: the current heuristic AI (evalState + 1-ply simulation).
 * Arm B: the same AI, with the value network blended into the shortlist score.
 * Sides alternate each game and both arms always receive the same deck pair,
 * so the only difference between arms is the evaluator.
 *
 * Usage:
 *   node tools/ab-value-net.js --games 2000 --weight 0.5 --diff normal
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnv, playMatch, deckIdsFor } = require('./lib/env.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

function wilson(k, n, z) {
  if (!n) return [0, 0];
  z = z || 1.96;
  const p = k / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

async function main() {
  const games = parseInt(arg('games', '600'), 10);
  const weight = parseFloat(arg('weight', '0.5'));
  const diff = arg('diff', 'normal');
  const seed0 = parseInt(arg('seed', '9001'), 10);
  const explore = parseFloat(arg('explore', '0'));
  const outFile = arg('out', '');
  const blend = arg('blend', 'minmax');
  // --disableSimB makes arm B play with the (buggy) no-simulation behaviour;
  // used once to measure how much the clone fix is worth.
  const disableSimB = arg('disableSimB', '0') === '1';

  const ctx = loadEnv({ withWeights: true, weightsPath: arg('weights', '') || undefined });
  if (!ctx.VALUE_NET) {
    console.error('no weights loaded — run tools/train-value-net.js first.');
    process.exit(2);
  }

  let bWins = 0, aWins = 0, bad = 0, turns = 0;
  let bFirstWins = 0, bFirstGames = 0, bSecondWins = 0, bSecondGames = 0;
  const t0 = Date.now();

  for (let i = 0; i < games; i++) {
    const sideB = i % 2;            // B plays p0 on even games, p1 on odd
    const seed = seed0 + i;
    const deck0 = deckIdsFor(ctx, seed, 0);
    const deck1 = deckIdsFor(ctx, seed, 1);
    const firstPlayer = (i >> 1) % 2; // balance who starts
    const g = await playMatch(ctx, {
      seed,
      difficulty: diff,
      deckIds: deck0,
      opponentDeckIds: deck1,
      firstPlayer,
      valueWeight: weight,
      valueSide: sideB,
      valueBlend: blend,
      simDisabledSide: disableSimB ? sideB : null,
      aiExplore: explore
    });
    if (g.winner == null) { bad++; continue; }
    turns += g.turn;
    const bWon = g.winner === sideB;
    if (bWon) bWins++; else aWins++;
    if (firstPlayer === sideB) { bFirstGames++; if (bWon) bFirstWins++; }
    else { bSecondGames++; if (bWon) bSecondWins++; }
    if ((i + 1) % 100 === 0) {
      process.stdout.write('\r' + (i + 1) + '/' + games + ' · B ' + bWins + ' / A ' + aWins +
        ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }
  process.stdout.write('\n');

  const n = bWins + aWins;
  const rate = n ? bWins / n : 0;
  const [lo, hi] = wilson(bWins, n);
  const z = n ? (rate - 0.5) / Math.sqrt(0.25 / n) : 0;
  const pValue = n ? 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))) : 1;

  console.log('weight ' + weight + ' · blend ' + blend + ' · difficulty ' + diff + ' · games ' + n +
    (bad ? ' (+' + bad + ' unfinished)' : ''));
  console.log('B (net) ' + bWins + ' — A (heuristic) ' + aWins);
  console.log('B win rate ' + (rate * 100).toFixed(1) + '%   95% CI ' +
    (lo * 100).toFixed(1) + '–' + (hi * 100).toFixed(1) + '%   z=' + z.toFixed(2) +
    '  p=' + pValue.toFixed(3));
  console.log('B going first  ' + bFirstWins + '/' + bFirstGames +
    ' (' + (bFirstGames ? (100 * bFirstWins / bFirstGames).toFixed(1) : '-') + '%)');
  console.log('B going second ' + bSecondWins + '/' + bSecondGames +
    ' (' + (bSecondGames ? (100 * bSecondWins / bSecondGames).toFixed(1) : '-') + '%)');
  console.log('avg turns ' + (n ? (turns / n).toFixed(1) : '-'));

  const verdict = rate > 0.55 && lo > 0.5 ? 'KEEP' : (rate < 0.45 && hi < 0.5 ? 'REJECT' : 'INCONCLUSIVE');
  console.log('verdict: ' + verdict);

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), JSON.stringify({
      weight, blend, difficulty: diff, games: n, unfinished: bad,
      bWins, aWins, rate, ci: [lo, hi], z, pValue,
      first: { wins: bFirstWins, games: bFirstGames },
      second: { wins: bSecondWins, games: bSecondGames },
      avgTurns: n ? turns / n : 0,
      verdict,
      createdAt: new Date().toISOString()
    }, null, 2));
    console.log('report → ' + path.resolve(outFile));
  }
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

main().catch(err => { console.error(err); process.exit(1); });
