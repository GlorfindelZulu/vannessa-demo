/* Vannessa — Dr. Vannessa mascot (spec: docs/vannessa_mascot_spec.md).
 *
 * Two halves in one classic script:
 *   1. a PURE core — mood, event detection, bubble queue. No DOM; Node-tested by
 *      mascot_test.mjs through the module.exports branch at the bottom.
 *   2. a DOM layer (browser only) — her spot at the bottom of the intake column,
 *      bubbles, and two backends
 *      (Rive, placeholder) behind one tiny contract: setMood(n) / fire(name) / destroy().
 *
 * Decoration only: every entry point app.js calls is wrapped there in try/catch, and
 * nothing here writes to S.
 */
(function (root) {
  'use strict';

  /* ================================================================ pure core */

  // Values are a contract with the .riv file (`mood` Number input). Never renumber.
  const MOOD = Object.freeze({
    idle: 0, perks_up: 1, ready: 2, working: 3, checking: 4,
    celebrate: 5, done_flags: 6, concerned: 7, disconnected: 8
  });
  const CELEBRATE_HOLD_MS = 8000;
  const COALESCE_MS = 3000;

  const jobList = S => (S && S.jobs ? Array.from(S.jobs.values()) : []);
  const anyStaged = S => !!(S && S.staged) &&
    Array.from(S.staged.values()).some(e => e && !e.consumed && !e.removed);

  function chipText(job) {
    return (job.chips || []).map(c => (c ? String(c.label || '') + ' ' + String(c.detail || '') : '')).join(' ');
  }
  function isUsageLimitPark(job) { return /usage limit/i.test(chipText(job)); }
  function isScan(job) { return /scan|no extractable text/i.test(chipText(job)); }

  /* Scans are caught by the survey and park in STAGING (upload entries), never as jobs;
     jobs (app.js normJob) carry no survey. */
  function stagedScans(S) {
    const out = [];
    if (S && S.staged) S.staged.forEach(e => {
      if (e && !e.removed && !e.consumed && e.rec && e.rec.survey && e.rec.survey.scanned) out.push(e.rec);
    });
    return out;
  }
  function uploadLabel(name) {
    const base = String(name || '').replace(/\.pdf$/i, '');
    const m = base.match(/\(([^)]+)\)\s*$/);
    return (m ? m[1] : base).trim() || 'This file';
  }

  /* Spec §1, top to bottom, first match wins. */
  function mascotMood(S, ui) {
    ui = ui || {};
    const jobs = jobList(S);
    const batch = S && S.batch;
    const open = !!(batch && !batch.done);
    const finished = !!(batch && batch.done);
    const has = pred => jobs.some(pred);

    if (S && S.conn === 'gone') return MOOD.disconnected;
    if (ui.dragging) return MOOD.perks_up;
    if (open && has(j => j.state === 'failed' || j.state === 'parked')) return MOOD.concerned;
    if (has(j => j.state === 'active' && j.stage === 'qa')) return MOOD.checking;
    if (has(j => j.state === 'active' && (j.stage === 'transcribe' || j.stage === 'build'))) return MOOD.working;
    if (finished && has(j => j.state === 'flags' || j.state === 'parked' || j.state === 'failed')) return MOOD.done_flags;
    if (finished && ui.doneAt != null && ui.now - ui.doneAt < CELEBRATE_HOLD_MS &&
        has(j => j.state === 'ok') &&
        jobs.every(j => j.state === 'ok' || j.state === 'skipped' || j.state === 'cancelled')) {
      return MOOD.celebrate;
    }
    if (!open && anyStaged(S)) return MOOD.ready;
    return MOOD.idle;
  }

  /* Diff the previous snapshot against S. The first call (prev === null) only seeds:
     a reload must not replay bubbles for things that already happened. */
  function detectEvents(prev, S) {
    const batch = (S && S.batch) || null;
    const jobs = jobList(S);
    const jobStates = {};
    jobs.forEach(j => { jobStates[j.id] = j.state; });
    const scans = stagedScans(S);
    const snap = {
      batchId: batch ? batch.id : null,
      done: !!(batch && batch.done),
      jobStates,
      scanIds: scans.map(r => r.upload_id),
      greeted: prev ? prev.greeted : false
    };
    const events = [];

    if (!prev) {
      if (!anyStaged(S) && !(batch && !batch.done) && !(S && S.conn === 'gone')) {
        snap.greeted = true;
        events.push({ kind: 'greet' });
      }
      return { events, snap };
    }

    const sameBatch = !!batch && batch.id === prev.batchId;
    const before = sameBatch ? prev.jobStates : {};
    jobs.forEach(j => {
      if (before[j.id] === j.state) return;
      if (j.state === 'failed' || (j.state === 'parked' && !isUsageLimitPark(j))) {
        events.push({ kind: 'needs', jobId: j.id, drug: j.drug_label, scan: isScan(j) });
      }
    });
    const seenScans = new Set(prev.scanIds || []);
    scans.forEach(rec => {
      if (seenScans.has(rec.upload_id)) return;
      events.push({ kind: 'needs', jobId: 'upload:' + rec.upload_id, drug: uploadLabel(rec.name), scan: true });
    });
    if (sameBatch && batch.done && !prev.done) {
      // same counts as app.js's tab title (doneFiledCount; needYou + parked + parked uploads)
      const parkedUploads = S.parkedUploads ? S.parkedUploads.size : 0;
      const end = {
        kind: 'end',
        n: jobs.filter(j => j.stage === 'done' && (j.state === 'ok' || j.state === 'flags')).length,
        k: jobs.filter(j => j.state === 'failed' || j.state === 'parked').length + parkedUploads,
        flagged: jobs.filter(j => j.state === 'flags').length
      };
      if (end.n || end.k) events.push(end);    // nothing built, nothing pending: no verdict
    }
    return { events, snap };
  }

  /* Spec §3 copy and durations — exact. */
  function bubbleText(e) {
    switch (e.kind) {
      case 'greet': return "Hi! Drop some criteria PDFs and I'll get started.";
      case 'start': return 'On it — ' + e.n + (e.n === 1 ? ' drug.' : ' drugs.');
      case 'end':
        if (e.k) return e.n + ' filed — ' + e.k + (e.k === 1 ? ' needs you.' : ' need you.');
        return e.flagged ? 'All ' + e.n + ' filed — a few have flags.' : 'All ' + e.n + ' filed. Clean pass!';
      case 'needs': return e.scan ? e.drug + ' is a scan — needs manual entry.' : e.drug + ' needs a look.';
      default: return '';
    }
  }
  function bubbleMs(e) {
    switch (e.kind) {
      case 'greet': return 6000;
      case 'start': return 4000;
      case 'end': return e.k || e.flagged ? 7000 : 6000;
      default: return 7000;
    }
  }
  const RANK = { greet: 1, start: 1, needs: 2, end: 3 };

  class BubbleQueue {
    constructor() { this.cur = null; this.spoken = new Set(); }
    reset() { this.cur = null; this.spoken.clear(); }
    /* A new batch forgets who has spoken but keeps the bubble on screen: POST
       /api/start can resolve (say start) before the SSE batch event arrives. */
    newBatch() { this.spoken.clear(); }
    push(e, now) {
      const live = this.cur && now < this.cur.until ? this.cur : null;
      if (e.kind === 'needs') {
        if (this.spoken.has(e.jobId)) return;
        this.spoken.add(e.jobId);
        if (live && live.event.kind === 'needs' && now - live.firstAt <= COALESCE_MS) {
          live.count += 1;
          live.text = live.count + ' drugs need a look.';
          live.until = now + 7000;
          return;
        }
      }
      const rank = RANK[e.kind] || 0;
      if (live && rank < live.rank) return;
      this.cur = { event: e, text: bubbleText(e), until: now + bubbleMs(e), rank, firstAt: now, count: 1 };
    }
    current(now) {
      return this.cur && now < this.cur.until ? { text: this.cur.text, until: this.cur.until } : null;
    }
  }

  /* Spec §4: the .riv must expose exactly these state-machine inputs. Returns the
     names that are missing or wrongly typed (names are case-sensitive). */
  const REQUIRED_INPUTS = [['mood', 'number'], ['wave', 'trigger'], ['nod', 'trigger']];
  function missingInputs(inputs) {
    return REQUIRED_INPUTS
      .filter(([name, type]) => !(inputs || []).some(i => i.name === name && i.type === type))
      .map(([name]) => name);
  }

  const core = { MOOD, CELEBRATE_HOLD_MS, mascotMood, detectEvents, isUsageLimitPark, isScan,
                 BubbleQueue, bubbleText, bubbleMs, missingInputs };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
    return;
  }
  root.VannessaMascotCore = core;
  if (typeof document === 'undefined') return;

  /* ================================================================ DOM layer */

  const reduceMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* Placeholder: a shape-built chibi so moods, placement and bubbles can be judged in
     the real app before the commissioned .riv exists. Rough on purpose. */
  const PLACEHOLDER_SVG =
    '<svg class="mp" viewBox="0 0 120 120" aria-hidden="true">' +
      '<g class="mp-all">' +
        '<path class="mp-hair-back" d="M30 50c0-22 13-36 30-36s30 14 30 36v38c0 6-5 9-10 7l-4-2H44l-4 2c-5 2-10-1-10-7z" fill="#3B2A20"/>' +
        '<path class="mp-coat" d="M36 86c4-8 13-12 24-12s20 4 24 12l4 30H32z" fill="#FFFFFF" stroke="#DCD9D3" stroke-width="1.2"/>' +
        '<path class="mp-shirt" d="M52 75l8 14 8-14z" fill="#C98B7E"/>' +
        '<circle class="mp-necklace" cx="60" cy="84" r=".9" fill="#C9A227"/>' +
        '<g class="mp-head">' +
          '<circle cx="60" cy="48" r="27" fill="#C68E6A"/>' +
          '<path class="mp-bangs" d="M33 46c1-17 13-27 27-27 15 0 26 10 27 25-9-3-17-9-21-17-6 9-18 16-33 19z" fill="#3B2A20"/>' +
          '<path class="mp-brows" d="M45 41q5-3 10 0M65 41q5-3 10 0" stroke="#2A1D16" stroke-width="2" fill="none" stroke-linecap="round"/>' +
          '<g class="mp-eyes"><ellipse cx="50" cy="50" rx="3.4" ry="4.2" fill="#3A2418"/><ellipse cx="70" cy="50" rx="3.4" ry="4.2" fill="#3A2418"/>' +
            '<circle cx="51.2" cy="48.6" r="1.1" fill="#fff"/><circle cx="71.2" cy="48.6" r="1.1" fill="#fff"/></g>' +
          '<circle cx="44" cy="58" r="3.6" fill="#E8A79A" opacity=".55"/><circle cx="76" cy="58" r="3.6" fill="#E8A79A" opacity=".55"/>' +
          '<circle class="mp-stud" cx="56.4" cy="56.5" r=".9" fill="#E6C65A"/>' +
          '<path class="mp-mouth" d="M52 61q8 7 16 0" stroke="#7A3B2E" stroke-width="2" fill="#fff" stroke-linejoin="round"/>' +
        '</g>' +
        '<g class="mp-clip"><rect x="68" y="84" width="22" height="28" rx="3" fill="#A97C50"/>' +
          '<rect x="71" y="88" width="16" height="21" rx="1.5" fill="#FBFAF8"/>' +
          '<rect x="75" y="82" width="8" height="4" rx="1.5" fill="#6E6B66"/>' +
          '<path d="M73.5 93h11M73.5 97h11M73.5 101h7" stroke="#CFCBC4" stroke-width="1.2"/></g>' +
      '</g>' +
    '</svg>';

  function PlaceholderBackend(stage) {
    const wrap = document.createElement('div');
    wrap.className = 'mascot-ph';
    wrap.innerHTML = PLACEHOLDER_SVG;
    stage.appendChild(wrap);
    const fxTimers = {};
    return {
      kind: 'placeholder',
      setMood(n) { wrap.setAttribute('data-mood', String(n)); },
      fire(name) {
        wrap.classList.add('fx-' + name);
        clearTimeout(fxTimers[name]);
        fxTimers[name] = setTimeout(() => wrap.classList.remove('fx-' + name), 900);
      },
      resize() {},
      destroy() { wrap.remove(); }
    };
  }

  /* The runtime (~2.6 MB with its wasm) is only fetched once a character file exists. */
  function loadRuntime() {
    if (root.rive) return Promise.resolve(root.rive);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/rive.js';
      s.onload = () => (root.rive ? resolve(root.rive) : reject(new Error('the Rive runtime did not load')));
      s.onerror = () => reject(new Error('the Rive runtime did not load'));
      document.head.appendChild(s);
    });
  }

  function RiveBackend(stage, buffer, R) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      stage.appendChild(canvas);
      let r = null;
      const fail = why => {
        try { if (r) r.cleanup(); } catch (e) { /* half-built */ }
        canvas.remove();
        reject(new Error(why));
      };
      R.RuntimeLoader.setWasmUrl('/vendor/rive.wasm');
      R.RuntimeLoader.setWasmFallbackUrl(null);       // default fallback is a CDN — never
      const T = R.StateMachineInputType;
      const typeName = t => (t === T.Number ? 'number' : t === T.Trigger ? 'trigger' : t === T.Boolean ? 'boolean' : String(t));
      r = new R.Rive({
        buffer, canvas, artboard: 'Vannessa', stateMachine: 'Mascot', autoplay: true,
        onLoadError: e => fail('the .riv did not load (' + ((e && e.data) || e) + ')'),
        onLoad: () => {
          const ins = r.stateMachineInputs('Mascot') || [];
          const miss = missingInputs(ins.map(i => ({ name: i.name, type: typeName(i.type) })));
          if (miss.length) { fail('the .riv is missing inputs: ' + miss.join(', ')); return; }
          r.resizeDrawingSurfaceToCanvas();
          const input = name => ins.find(i => i.name === name);
          let pauseT = null;
          resolve({
            kind: 'rive',
            setMood(n) {
              input('mood').value = n;
              if (reduceMotion.matches) {       // still pose: let one frame render, then hold
                r.play();
                clearTimeout(pauseT);
                pauseT = setTimeout(() => r.pause(), 60);
              }
            },
            fire(name) { const t = input(name); if (t) t.fire(); },
            resize() { r.resizeDrawingSurfaceToCanvas(); },
            destroy() { clearTimeout(pauseT); r.cleanup(); canvas.remove(); }
          });
        }
      });
    });
  }

  /* Rive when mascot/vannessa.riv exists and checks out; otherwise the placeholder.
     A missing .riv is expected until the art arrives, so it falls back silently. */
  function selectBackend(stage) {
    const placeholder = () => PlaceholderBackend(stage);
    const fallback = err => {
      if (root.console) console.warn('Vannessa mascot: ' + err.message + ' — using placeholder');
      return placeholder();
    };
    // Demo build: no character file ships on static hosting — go straight to the
    // placeholder instead of probing (keeps the console free of a 404).
    void fallback; void loadRuntime; void RiveBackend;
    return Promise.resolve(placeholder());
  }

  const M = {
    el: null, stage: null, bubble: null, backend: null, dead: false,
    prevSnap: null, queue: new BubbleQueue(), lastMood: -1, waved: false,
    batchId: undefined, batchDone: false, doneAt: null, doneSeen: new Set(),
    celebTimer: null, bubbleTimer: null, lastS: null, lastUi: null
  };

  function kill() {
    M.dead = true;
    try { M.backend && M.backend.destroy(); } catch (e) { /* already broken */ }
    if (M.el) M.el.remove();
    if (M.bubble) M.bubble.remove();
    document.body.classList.remove('has-mascot');
  }

  function init() {
    const home = document.getElementById('mascotHome');
    if (!home || M.el) return;
    M.el = document.createElement('div');
    M.el.id = 'mascot';
    M.el.className = 'mascot';
    M.el.setAttribute('aria-hidden', 'true');
    M.stage = document.createElement('div');
    M.stage.className = 'mascot-stage';
    M.el.appendChild(M.stage);
    M.bubble = document.createElement('div');
    M.bubble.className = 'mascot-bubble';
    M.bubble.setAttribute('aria-hidden', 'true');
    document.body.appendChild(M.bubble);
    home.appendChild(M.el);
    document.body.classList.add('has-mascot');
    root.addEventListener('resize', () => { if (!M.dead) placeBubble(); });

    selectBackend(M.stage).then(b => {
      if (M.dead) { b.destroy(); return; }
      M.backend = b;
      if (M.lastMood >= 0) b.setMood(M.lastMood);
      if (!M.waved) { M.waved = true; b.fire('wave'); }
    }).catch(err => {
      if (root.console) console.warn('Vannessa mascot: placeholder failed — mascot hidden', err);
      kill();
    });
  }

  /* Bubble sits above her, centred, tail pointing down; kept on screen horizontally.
     position:fixed on <body>, so the scrolling intake column can't clip it. */
  function placeBubble() {
    if (!M.bubble || !M.bubble.classList.contains('is-shown')) return;
    const r = M.el.getBoundingClientRect();
    const w = M.bubble.offsetWidth, h = M.bubble.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, root.innerWidth - w - 8));
    M.bubble.style.left = Math.round(left) + 'px';
    M.bubble.style.top = Math.round(r.top - h - 6) + 'px';
  }

  function renderBubble(now) {
    clearTimeout(M.bubbleTimer);
    const c = M.queue.current(now);
    if (!c) { M.bubble.classList.remove('is-shown'); return; }
    M.bubble.textContent = c.text;
    M.bubble.classList.add('is-shown');
    placeBubble();
    M.bubbleTimer = setTimeout(() => { if (!M.dead) renderBubble(Date.now()); }, c.until - now + 20);
  }

  function update(S, ui) {
    if (M.dead || !M.el) return;
    ui = ui || {};
    const now = Date.now();
    const batch = S.batch || null;
    const bid = batch ? batch.id : null;

    if (M.batchId !== undefined && bid !== M.batchId) {
      if (bid) M.queue.newBatch();
      M.doneSeen.clear();
      M.doneAt = null;
    }
    if (batch && batch.done && M.prevSnap && !(M.batchDone && bid === M.batchId)) M.doneAt = now;
    if (batch && !batch.done) M.doneAt = null;

    S.jobs.forEach(j => {
      if (j.stage !== 'done' || M.doneSeen.has(j.id)) return;
      M.doneSeen.add(j.id);
      if (M.prevSnap && batch && !batch.done && M.backend) M.backend.fire('nod');
    });

    const r = detectEvents(M.prevSnap, S);
    M.prevSnap = r.snap;
    r.events.forEach(e => M.queue.push(e, now));
    M.batchId = bid;
    M.batchDone = !!(batch && batch.done);

    const mood = mascotMood(S, { dragging: !!ui.dragging, now, doneAt: M.doneAt });
    if (mood !== M.lastMood) {
      M.lastMood = mood;
      M.el.setAttribute('data-mood', String(mood));
      if (M.backend) M.backend.setMood(mood);
    }
    M.lastS = S;
    M.lastUi = ui;
    if (mood === MOOD.celebrate && !M.celebTimer) {
      M.celebTimer = setTimeout(() => {
        M.celebTimer = null;
        try { if (M.lastS) update(M.lastS, M.lastUi); } catch (e) { /* decoration only */ }
      }, Math.max(0, M.doneAt + CELEBRATE_HOLD_MS - now) + 50);
    }
    renderBubble(now);
  }

  function say(e) {
    if (M.dead || !M.el) return;
    const now = Date.now();
    M.queue.push(e, now);
    renderBubble(now);
  }

  root.VannessaMascot = { init, update, say };
})(typeof window !== 'undefined' ? window : this);
