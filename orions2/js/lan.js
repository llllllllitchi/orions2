/* Orions II LAN client: EventSource in + POST relay out. */
(function () {
  'use strict';

  const LAN = {
    base: '',
    code: '',
    role: '',
    mode: '',
    connected: false,
    peer: false,
    closed: false,
    es: null,
    pc: null,
    dc: null,
    handler: null,
    error: ''
  };
  window.LAN = LAN;

  function normalizeBase(raw) {
    let b = String(raw || '').trim();
    if (!b) {
      if (location.protocol === 'file:') {
        try { b = localStorage.getItem('orions2lanServer') || ''; } catch (e) {}
        if (!b) b = 'http://127.0.0.1:8901';
      } else {
        b = location.origin;
      }
    }
    b = b.replace(/\/+$/, '');
    return b;
  }

  function emit(msg) {
    if (LAN.handler) {
      try { LAN.handler(msg); } catch (e) { console.error(e); }
    }
  }

  function encodeDesc(desc) {
    const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
    return 'O2D1.' + btoa(unescape(encodeURIComponent(json)));
  }

  function decodeDesc(code) {
    const s = String(code || '').replace(/\s+/g, '');
    if (s.indexOf('O2D1.') !== 0) throw new Error('配对码格式不对');
    const json = decodeURIComponent(escape(atob(s.slice(5))));
    const d = JSON.parse(json);
    if (!d || !d.type || !d.sdp) throw new Error('配对码内容不完整');
    return d;
  }

  function waitIce(pc) {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') finish();
      });
      setTimeout(finish, 3500);
    });
  }

  function wireDC(dc) {
    LAN.dc = dc;
    dc.onopen = function () {
      if (LAN.closed) return;
      LAN.connected = true;
      LAN.peer = true;
      emit({ type: 'connection', state: 'open' });
      emit({ type: 'peer', peer: true, side: LAN.role });
    };
    dc.onmessage = function (ev) {
      if (LAN.closed) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || msg.type === 'ping') return;
      if (msg.type === 'hello') LAN.peer = !!msg.peer;
      if (msg.type === 'peer') LAN.peer = !!msg.peer;
      emit(msg);
    };
    dc.onclose = function () {
      if (LAN.closed) return;
      LAN.connected = false;
      LAN.peer = false;
      emit({ type: 'peer', peer: false, side: LAN.role });
      emit({ type: 'connection', state: 'error', reason: '直连已断开' });
    };
    dc.onerror = function () {
      if (LAN.closed) return;
      emit({ type: 'connection', state: 'error', reason: '直连出错' });
    };
  }

  function makePC() {
    const pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
    pc.onconnectionstatechange = function () {
      if (LAN.closed) return;
      if (pc.connectionState === 'failed') {
        emit({ type: 'connection', state: 'error', reason: '直连失败，请重新生成配对码' });
      }
    };
    return pc;
  }

  LAN.directHost = async function (opts) {
    opts = opts || {};
    LAN.close();
    LAN.closed = false;
    LAN.mode = 'direct';
    LAN.role = 'host';
    LAN.code = 'DIRECT';
    LAN.handler = opts.onEvent || null;
    LAN.connected = false;
    LAN.peer = false;
    const pc = makePC();
    LAN.pc = pc;
    const dc = pc.createDataChannel('orions', { ordered: true });
    wireDC(dc);
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return encodeDesc(pc.localDescription);
  };

  LAN.directGuest = async function (offerCode, opts) {
    opts = opts || {};
    LAN.close();
    LAN.closed = false;
    LAN.mode = 'direct';
    LAN.role = 'guest';
    LAN.code = 'DIRECT';
    LAN.handler = opts.onEvent || null;
    LAN.connected = false;
    LAN.peer = false;
    const pc = makePC();
    LAN.pc = pc;
    pc.ondatachannel = function (ev) { wireDC(ev.channel); };
    const offer = decodeDesc(offerCode);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    return encodeDesc(pc.localDescription);
  };

  LAN.directAccept = async function (answerCode) {
    if (!LAN.pc || LAN.role !== 'host') throw new Error('不是直连房主');
    await LAN.pc.setRemoteDescription(decodeDesc(answerCode));
    return true;
  };

  LAN.connect = function (opts) {
    opts = opts || {};
    LAN.close();
    LAN.mode = 'http';
    LAN.base = normalizeBase(opts.server);
    LAN.code = String(opts.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    LAN.role = opts.role === 'guest' ? 'guest' : 'host';
    LAN.handler = opts.onEvent || null;
    LAN.connected = false;
    LAN.peer = false;
    LAN.closed = false;
    LAN.error = '';
    if (LAN.code.length < 4) {
      emit({ type: 'connection', state: 'error', reason: '房间码至少 4 位' });
      return;
    }
    try {
      if (location.protocol === 'file:') localStorage.setItem('orions2lanServer', LAN.base);
    } catch (e) {}
    const url = LAN.base + '/lan/events?room=' + encodeURIComponent(LAN.code) + '&side=' + LAN.role;
    try {
      LAN.es = new EventSource(url);
    } catch (e) {
      emit({ type: 'connection', state: 'error', reason: '浏览器不支持局域网连接' });
      return;
    }
    LAN.es.onopen = function () {
      if (LAN.closed) return;
      LAN.connected = true;
      emit({ type: 'connection', state: 'open' });
    };
    LAN.es.onmessage = function (ev) {
      if (LAN.closed) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || msg.type === 'ping') return;
      if (msg.type === 'hello') {
        LAN.peer = !!msg.peer;
      } else if (msg.type === 'peer') {
        LAN.peer = !!msg.peer;
      }
      emit(msg);
    };
    LAN.es.onerror = function () {
      if (LAN.closed) return;
      LAN.connected = false;
      emit({ type: 'connection', state: 'error', reason: '局域网连接中断，正在重连…' });
    };
  };

  LAN.send = function (msg) {
    if (LAN.mode === 'direct') {
      if (LAN.closed || !LAN.dc || LAN.dc.readyState !== 'open') {
        return Promise.resolve({ ok: false, error: 'direct not connected' });
      }
      try {
        LAN.dc.send(JSON.stringify(msg));
        return Promise.resolve({ ok: true });
      } catch (e) {
        return Promise.resolve({ ok: false, error: 'direct send failed' });
      }
    }
    if (!LAN.base || !LAN.code || LAN.closed) return Promise.resolve({ ok: false, error: 'not connected' });
    const url = LAN.base + '/lan/send?room=' + encodeURIComponent(LAN.code) + '&side=' + LAN.role;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    }).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .catch(function () { return { ok: false, error: 'network' }; });
  };

  LAN.close = function () {
    LAN.closed = true;
    LAN.connected = false;
    LAN.peer = false;
    if (LAN.dc) {
      try { LAN.dc.close(); } catch (e) {}
      LAN.dc = null;
    }
    if (LAN.pc) {
      try { LAN.pc.close(); } catch (e) {}
      LAN.pc = null;
    }
    if (LAN.es) {
      try { LAN.es.close(); } catch (e) {}
      LAN.es = null;
    }
    LAN.base = '';
    LAN.code = '';
    LAN.mode = '';
  };
})();
