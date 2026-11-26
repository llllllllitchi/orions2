/* Shared Node harness: boots the browser scripts in a VM with a fake window.
 * Used by the offline tools (self-play, training, A/B testing).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = [
  'js/cards2-data.js',
  'js/effects2.js',
  'js/engine.js',
  'js/cards2-zh.js',
  'js/ai-learned.js',
  'js/ai.js',
  'js/value-net.js',
  'js/value-net-weights.js'
];

function loadEnv(opts) {
  opts = opts || {};
  const sandbox = {
    console,
    Math, Date, JSON, Number, Object, Array, String, Boolean, Promise,
    Set, Map, Proxy, Symbol, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  const ctx = vm.createContext(sandbox);
  for (const rel of SCRIPTS) {
    if (rel === 'js/value-net-weights.js' && !opts.withWeights) continue;
    const abs = rel === 'js/value-net-weights.js' && opts.weightsPath
      ? path.resolve(opts.weightsPath)
      : path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

/* Deterministic PRNG (mulberry32) so every experiment is reproducible. */
function mkRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deckIdsFor(ctx, seed, side) {
  const rng = mkRng(seed * 7919 + side * 104729 + 13);
  const cards = ctx.CARDS;
  const by = {};
  for (const el of ctx.ELEMENTS) by[el] = cards.filter(c => c.element === el).map(c => c.id);
  const out = [];
  for (const el of ctx.ELEMENTS) {
    const list = by[el].slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = list[i]; list[i] = list[j]; list[j] = t;
    }
    out.push(...list.slice(0, 4));
  }
  return out;
}

function makeGame(ctx, opts) {
  opts = opts || {};
  const seed = opts.seed == null ? 1 : opts.seed;
  const g = new ctx.Game({
    difficulty: opts.difficulty || 'normal',
    rng: mkRng(seed * 2654435761 + 7),
    challenge: opts.challenge || 'none',
    firstPlayer: opts.firstPlayer == null ? seed % 2 : opts.firstPlayer,
    deckIds: opts.deckIds || deckIdsFor(ctx, seed, 0),
    opponentDeckIds: opts.opponentDeckIds || deckIdsFor(ctx, seed, 1)
  });
  if (opts.valueWeight) g.valueWeight = opts.valueWeight;
  if (opts.valueSide != null) g.valueSide = opts.valueSide;
  if (opts.aiExplore) g.aiExplore = opts.aiExplore;
  if (opts.valueBlend) g.valueBlend = opts.valueBlend;
  if (opts.simDisabledSide != null) g.simDisabledSide = opts.simDisabledSide;
  return g;
}

/* Plays a whole duel. Both sides are driven by AI.takeTurnFor.
 * onDecision(g, playerId) fires before each side's turn is planned.
 * Returns the finished Game. */
async function playMatch(ctx, opts) {
  const g = makeGame(ctx, opts);
  const AI = ctx.AI;
  const maxTurns = opts.maxTurns || 400;
  // Safety net for offline batches: a runaway effect loop should abort one
  // game instead of eating all memory.
  const logCap = opts.logCap || 6000;
  let logged = 0;
  const baseLog = g.log;
  g.log = function () {
    if (++logged > logCap) {
      const err = new Error('log overflow in seed ' + (opts.seed == null ? '?' : opts.seed));
      err.code = 'LOG_OVERFLOW';
      throw err;
    }
    return baseLog.apply(g, arguments);
  };
  await g.start();
  let guard = 0;
  while (g.winner == null && guard++ < maxTurns) {
    const me = g.active;
    if (opts.onDecision) opts.onDecision(g, me);
    if (g.phase !== 'play') break;
    await AI.takeTurnFor(g, me);
  }
  return g;
}

module.exports = { ROOT, loadEnv, mkRng, deckIdsFor, makeGame, playMatch };
