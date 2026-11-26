#!/usr/bin/env node
/* Orions 2 — trains the small value network from self-play rows.
 *
 * Pure JS (no native deps): one/two hidden tanh layers, sigmoid output,
 * binary cross-entropy, Adam, early stopping on a held-out split.
 *
 * Usage:
 *   node tools/train-value-net.js --data tools/data/selfplay.json \
 *        --hidden 24,12 --epochs 40 --out js/value-net-weights.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNet(sizes, rng) {
  const layers = [];
  for (let i = 1; i < sizes.length; i++) {
    const nIn = sizes[i - 1], nOut = sizes[i];
    const W = [];
    const b = new Float64Array(nOut);
    const scale = Math.sqrt(2 / nIn);
    for (let j = 0; j < nOut; j++) {
      const row = new Float64Array(nIn);
      for (let k = 0; k < nIn; k++) row[k] = (rng() * 2 - 1) * scale;
      W.push(row);
    }
    layers.push({ W, b });
  }
  return { layers, sizes };
}

function forward(net, x) {
  let v = x;
  const acts = [v];
  for (let li = 0; li < net.layers.length; li++) {
    const L = net.layers[li];
    const out = new Float64Array(L.b.length);
    const last = li === net.layers.length - 1;
    for (let j = 0; j < L.b.length; j++) {
      const row = L.W[j];
      let s = L.b[j];
      for (let k = 0; k < row.length; k++) s += row[k] * v[k];
      out[j] = last ? s : Math.tanh(s);
    }
    v = out;
    acts.push(v);
  }
  return { out: v[0], acts };
}

function sigmoid(z) {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function auc(pairs) {
  const list = pairs.slice().sort((a, b) => a[0] - b[0]);
  let pos = 0, neg = 0;
  for (const p of list) p[1] ? pos++ : neg++;
  if (!pos || !neg) return 0.5;
  let rankSum = 0;
  for (let i = 0; i < list.length; i++) {
    // average ranks for ties
    let j = i;
    while (j + 1 < list.length && list[j + 1][0] === list[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (list[k][1]) rankSum += avgRank;
    i = j;
  }
  return (rankSum - pos * (pos + 1) / 2) / (pos * neg);
}

function metrics(net, data, mean, std) {
  let loss = 0, correct = 0, brier = 0;
  const pairs = [];
  for (const row of data) {
    const x = new Float64Array(row.x.length);
    for (let i = 0; i < x.length; i++) x[i] = (row.x[i] - mean[i]) / (std[i] || 1);
    const p = sigmoid(forward(net, x).out);
    const t = row.y;
    loss += -(t * Math.log(Math.max(1e-7, p)) + (1 - t) * Math.log(Math.max(1e-7, 1 - p)));
    brier += (p - t) * (p - t);
    if ((p >= 0.5 ? 1 : 0) === t) correct++;
    pairs.push([p, t]);
  }
  const n = data.length || 1;
  return {
    n: data.length,
    loss: loss / n,
    brier: brier / n,
    acc: correct / n,
    auc: auc(pairs)
  };
}

function main() {
  const dataFiles = arg('data', path.join(__dirname, 'data', 'selfplay.json')).split(',');
  const hidden = arg('hidden', '24,12').split(',').map(Number).filter(n => n > 0);
  const epochs = parseInt(arg('epochs', '40'), 10);
  const batchSize = parseInt(arg('batch', '64'), 10);
  const lr0 = parseFloat(arg('lr', '0.004'));
  const l2 = parseFloat(arg('l2', '0.00002'));
  const seed = parseInt(arg('seed', '7'), 10);
  const outFile = path.resolve(arg('out', path.join(__dirname, '..', 'js', 'value-net-weights.js')));
  const reportFile = path.resolve(arg('report', path.join(__dirname, 'value-net-report.json')));

  const ctx = loadEnv();
  const featureNames = ctx.ValueNet.FEATURES;
  const rows = [];
  for (const f of dataFiles) {
    const payload = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (payload.meta && payload.meta.features &&
        payload.meta.features.join(',') !== featureNames.join(',')) {
      console.error('feature mismatch in ' + f + ' — regenerate the samples.');
      process.exit(2);
    }
    for (const r of payload.rows) rows.push(r);
  }
  if (rows.length < 500) {
    console.error('not enough rows (' + rows.length + '), sample more games first.');
    process.exit(2);
  }

  const rng = mulberry32(seed);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
  }
  const cut = Math.floor(rows.length * 0.9);
  const train = rows.slice(0, cut);
  const val = rows.slice(cut);

  const nIn = featureNames.length;
  const mean = new Float64Array(nIn);
  const std = new Float64Array(nIn);
  for (const row of train) for (let i = 0; i < nIn; i++) mean[i] += row.x[i];
  for (let i = 0; i < nIn; i++) mean[i] /= train.length;
  for (const row of train) for (let i = 0; i < nIn; i++) std[i] += (row.x[i] - mean[i]) ** 2;
  for (let i = 0; i < nIn; i++) std[i] = Math.sqrt(std[i] / train.length) || 1;

  const X = train.map(row => {
    const x = new Float64Array(nIn);
    for (let i = 0; i < nIn; i++) x[i] = (row.x[i] - mean[i]) / (std[i] || 1);
    return x;
  });
  const Y = Float64Array.from(train.map(r => r.y));

  const net = makeNet([nIn, ...hidden, 1], rng);
  // Adam state
  const mW = net.layers.map(L => L.W.map(r => new Float64Array(r.length)));
  const vW = net.layers.map(L => L.W.map(r => new Float64Array(r.length)));
  const mB = net.layers.map(L => new Float64Array(L.b.length));
  const vB = net.layers.map(L => new Float64Array(L.b.length));
  let step = 0;

  const idx = new Int32Array(train.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;

  let best = null;
  let bestVal = Infinity;
  let badEpochs = 0;
  const history = [];

  for (let ep = 1; ep <= epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    let epLoss = 0;
    const lr = lr0 * (0.5 + 0.5 * (1 - (ep - 1) / epochs));

    for (let start = 0; start < idx.length; start += batchSize) {
      const end = Math.min(idx.length, start + batchSize);
      const n = end - start;
      const gW = net.layers.map(L => L.W.map(r => new Float64Array(r.length)));
      const gB = net.layers.map(L => new Float64Array(L.b.length));

      for (let s = start; s < end; s++) {
        const bi = idx[s];
        const x = X[bi];
        const y = Y[bi];
        const { out, acts } = forward(net, x);
        const p = sigmoid(out);
        epLoss += -(y * Math.log(Math.max(1e-7, p)) + (1 - y) * Math.log(Math.max(1e-7, 1 - p)));

        // dL/dz for sigmoid+BCE = p - y
        let delta = new Float64Array([p - y]);
        for (let li = net.layers.length - 1; li >= 0; li--) {
          const L = net.layers[li];
          const aPrev = acts[li];
          for (let j = 0; j < L.b.length; j++) {
            const d = delta[j];
            if (!d) continue;
            gB[li][j] += d;
            const row = gW[li][j];
            for (let k = 0; k < aPrev.length; k++) row[k] += d * aPrev[k];
          }
          if (li > 0) {
            const prev = new Float64Array(net.layers[li - 1].b.length);
            for (let k = 0; k < prev.length; k++) {
              let s2 = 0;
              for (let j = 0; j < L.b.length; j++) s2 += delta[j] * L.W[j][k];
              prev[k] = s2 * (1 - acts[li][k] * acts[li][k]);
            }
            delta = prev;
          }
        }
      }

      step++;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;
      for (let li = 0; li < net.layers.length; li++) {
        const L = net.layers[li];
        for (let j = 0; j < L.b.length; j++) {
          const row = L.W[j];
          for (let k = 0; k < row.length; k++) {
            const g = gW[li][j][k] / n + l2 * row[k];
            mW[li][j][k] = b1 * mW[li][j][k] + (1 - b1) * g;
            vW[li][j][k] = b2 * vW[li][j][k] + (1 - b2) * g * g;
            const mh = mW[li][j][k] / (1 - Math.pow(b1, step));
            const vh = vW[li][j][k] / (1 - Math.pow(b2, step));
            row[k] -= lr * mh / (Math.sqrt(vh) + eps);
          }
          const gb = gB[li][j] / n;
          mB[li][j] = b1 * mB[li][j] + (1 - b1) * gb;
          vB[li][j] = b2 * vB[li][j] + (1 - b2) * gb * gb;
          const mhb = mB[li][j] / (1 - Math.pow(b1, step));
          const vhb = vB[li][j] / (1 - Math.pow(b2, step));
          L.b[j] -= lr * mhb / (Math.sqrt(vhb) + eps);
        }
      }
    }

    const vm = metrics(net, val, mean, std);
    history.push({ epoch: ep, trainLoss: epLoss / train.length, valLoss: vm.loss, valAuc: vm.auc });
    if (vm.loss < bestVal - 1e-5) {
      bestVal = vm.loss;
      badEpochs = 0;
      best = {
        layers: net.layers.map(L => ({
          W: L.W.map(r => Array.from(r, x => Math.round(x * 1e5) / 1e5)),
          b: Array.from(L.b, x => Math.round(x * 1e5) / 1e5)
        }))
      };
    } else if (++badEpochs >= 6) {
      break;
    }
    process.stdout.write('\r epoch ' + ep + ' · train ' + (epLoss / train.length).toFixed(4) +
      ' · val ' + vm.loss.toFixed(4) + ' · valAUC ' + vm.auc.toFixed(3) + '   ');
  }
  process.stdout.write('\n');

  const finalNet = { layers: best.layers };
  const trainM = metrics(finalNet, train, mean, std);
  const valM = metrics(finalNet, val, mean, std);

  const payload = {
    schema: 'orions2-value-net/v1',
    version: 1,
    trainedAt: new Date().toISOString(),
    in: nIn,
    hidden: hidden,
    features: featureNames,
    mean: Array.from(mean, v => Math.round(v * 1e6) / 1e6),
    std: Array.from(std, v => Math.round(v * 1e6) / 1e6),
    rows: rows.length,
    train: trainM,
    val: valM,
    layers: best.layers
  };
  const banner = '/* AUTO-GENERATED by tools/train-value-net.js — ' + payload.trainedAt +
    ' · ' + rows.length + ' states. Do not edit by hand. */\n';
  fs.writeFileSync(outFile, banner + 'window.VALUE_NET = ' + JSON.stringify({
    version: 1, in: nIn, hidden, features: featureNames,
    mean: payload.mean, std: payload.std, layers: best.layers
  }) + ';\n');
  fs.writeFileSync(reportFile, JSON.stringify({ ...payload, history }, null, 2));

  const size = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log('rows ' + rows.length + ' (train ' + train.length + ' / val ' + val.length + ')');
  console.log('val: loss ' + valM.loss.toFixed(4) + ' · auc ' + valM.auc.toFixed(4) +
    ' · acc ' + (valM.acc * 100).toFixed(1) + '% · brier ' + valM.brier.toFixed(4));
  console.log('train: loss ' + trainM.loss.toFixed(4) + ' · auc ' + trainM.auc.toFixed(4) +
    ' · acc ' + (trainM.acc * 100).toFixed(1) + '%');
  console.log('wrote ' + outFile + ' (' + size + ' KB)');
}

main();
