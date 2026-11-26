/* Orions 2 — learned AI weights.
 *
 * `window.AI_LEARNED.bias` is a flat map of small score adjustments keyed by
 * "spell:<cardId>", "monster:<cardId>" or "ability:<cardId>". It is produced by
 * training on archived duels (in-game "重新训练 AI" button, or
 * `node tools/train-ai.js <records.json>`) and loaded from localStorage at boot.
 * With no data the map is empty and the heuristics behave exactly as before.
 */
(function () {
  'use strict';
  window.AI_LEARNED = { version: 0, games: 0, bias: {} };
  try {
    const raw = localStorage.getItem('orions2.aiLearned.v1');
    if (raw) {
      const w = JSON.parse(raw);
      if (w && w.bias && typeof w.bias === 'object') window.AI_LEARNED = w;
    }
  } catch (e) {}

  window.saveLearned = function (weights) {
    window.AI_LEARNED = weights;
    try { localStorage.setItem('orions2.aiLearned.v1', JSON.stringify(weights)); } catch (e) {}
  };
})();
