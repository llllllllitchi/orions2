/* Orions 2 — tiny offline trainer.
 *
 * The opponent AI is heuristic + one-ply simulation, not a neural net, so
 * "training" here means fitting a small bias term per card onto recorded
 * decisions. The algorithm is outcome-weighted behaviour cloning (a one-step
 * REINFORCE): a card that was actually chosen in a game the AI won gets a
 * positive nudge, a card chosen in a lost game a negative one. Biases are
 * clamped and normalised by sample count so a single lucky duel cannot
 * dominate the heuristics.
 *
 * Works in the browser (window.AITrainer) and in Node (module.exports) so the
 * same code path is used by the in-game button and tools/train-ai.js.
 */
(function (root) {
  'use strict';

  const CLAMP = 2.5;
  const MIN_SAMPLES = 4;

  function ensure(map, key) {
    let s = map[key];
    if (!s) { s = map[key] = { n: 0, sum: 0, wins: 0 }; }
    return s;
  }

  function push(map, key, value, won) {
    const s = ensure(map, key);
    s.n += 1;
    s.sum += value;
    if (won) s.wins += 1;
  }

  // A decision is worth training on when the AI actually committed to it and we
  // know the final result of that duel.
  function train(records, opts) {
    opts = opts || {};
    const stats = {};
    let games = 0;
    let decisions = 0;

    for (const rec of records || []) {
      const meta = rec && rec.meta;
      if (!meta || meta.winner == null) continue;
      const winner = meta.winner;
      const list = rec.decisions || [];
      if (!list.length) continue;
      games++;

      for (const d of list) {
        if (!d || d.player == null) continue;
        const won = d.player === winner;
        if (d.card) {
          decisions++;
          // Agreement with the heuristic's own top pick means the decision was
          // "on policy", so it carries more signal than a forced/random play.
          let agree = 1;
          const top = d.options && d.options[0];
          if (top && top.id !== d.card) agree = 0.45;
          const key = (d.kind === 'monster' ? 'monster:' : 'spell:') + d.card;
          push(stats, key, (won ? 1 : -0.6) * (0.5 + 0.5 * agree), won);
        }
        for (const t of d.trace || []) {
          if (!t || !t.id) continue;
          decisions++;
          push(stats, 'ability:' + t.id, (won ? 1 : -0.6) * 0.8, won);
        }
      }
    }

    const bias = {};
    const report = [];
    for (const key of Object.keys(stats)) {
      const s = stats[key];
      if (s.n < MIN_SAMPLES) continue;
      let v = (s.sum / s.n) * 2.2;
      // Shrink towards zero for thin evidence.
      v *= Math.min(1, Math.sqrt(s.n / 12));
      v = Math.max(-CLAMP, Math.min(CLAMP, v));
      if (Math.abs(v) < 0.05) continue;
      bias[key] = Math.round(v * 100) / 100;
      report.push({ key, bias: bias[key], n: s.n, winRate: Math.round((s.wins / s.n) * 100) });
    }
    report.sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));

    return {
      version: 1,
      trainedAt: new Date().toISOString(),
      games,
      decisions,
      model: opts.model || 'outcome-weighted-bc',
      bias,
      top: report.slice(0, 24)
    };
  }

  const api = { train, MIN_SAMPLES };
  root.AITrainer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
