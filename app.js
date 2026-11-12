/* Vannessa — ePA Builder frontend.
   Vanilla JS, no frameworks, no network beyond the local API.
   All dynamic strings go through textContent (filenames are hostile).
   Mock mode: ?mock=1 runs a scripted batch entirely client-side. */
(() => {
'use strict';

/* ---------------- utilities ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function fmtBytes(b) {
  if (b == null || isNaN(b)) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}
function fmtDur(ms) {
  if (ms == null || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}
function fmtMinApprox(sec) {
  if (sec == null) return '';
  if (sec < 90) return '~1 min';
  return '~' + Math.round(sec / 60) + ' min';
}
function parseTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}
function nowMs() { return Date.now(); }

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* deterministic pastel tile per drug (hash of label) */
const TILE_COLORS = ['var(--tile-lavender)', 'var(--tile-mint)', 'var(--tile-butter)',
                     'var(--tile-sky)', 'var(--tile-blush)', 'var(--tile-sand)'];
function tileColor(label) {
  let h = 0;
  const s = String(label || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

/* ---------------- constants & copy ---------------- */
// Demo build: mock mode is the default (no backend on static hosting); ?mock=0 disables.
const MOCK = new URLSearchParams(location.search).get('mock') !== '0';

const CHIP_CLASS = {
  clean: 'mint', ok: 'mint', mint: 'mint',
  incomplete: 'butter', butter: 'butter',
  date: 'lavender', lavender: 'lavender',
  update: 'slate', slate: 'slate',
  fail: 'blush', failed: 'blush', blush: 'blush',
  parked: 'gray', skipped: 'gray', note: 'gray', gray: 'gray', cancelled: 'gray'
};
const INCOMPLETE_COPY = 'incomplete — pending quantity limits';

const LEGEND = [
  { kind: 'clean', label: 'clean', text: 'Every check passed. Filed without caveats.' },
  { kind: 'incomplete', label: INCOMPLETE_COPY, text: 'The source says quantity limits exist and none are transcribed (no formulary source in this flow). Check before delivering.' },
  { kind: 'date', label: 'date', text: 'A date is blank, malformed, or out of order. Verify against the PDF before delivering.' },
  { kind: 'update', label: 'update', text: 'Re-transcription of an existing drug. The old spec is backed up to _backups/; the superseded .docx in its old Group folder is not touched.' },
  { kind: 'fail', label: 'failed', text: 'Build or QA stopped this one. Nothing is altered to force a pass — it needs Willie. Details live in the card drawer.' },
  { kind: 'parked', label: 'parked', text: 'Waiting on a decision, a duplicate, a scan, or Willie. Parked cards are kept, never lost.' }
];

const STAGE_COPY = {
  queued: 'Waiting for a transcription slot',
  survey: 'Reading dates and limits from page 1',
  transcribe: 'Transcribing the criteria — verbatim, flags instead of fixes',
  validate: 'Validating the spec — three layers, sixteen attributes',
  fidelity: 'Comparing every line against the source',
  build: 'Building the document',
  qa: 'Running the checks — nothing ships on a fail',
  done: 'Filed'
};

const GHOST_COPY = {
  queue: 'Files wait here for a transcription slot.',
  transcribe: 'Two at a time — verbatim, flags instead of fixes.',
  build: 'The .docx is assembled here, one at a time.',
  qa: 'Every check must pass — nothing ships on a fail.',
  done: 'The first document lands here.',
  parked: 'Decisions, duplicates and dead ends wait here — kept, never lost.'
};

const COL_ORDER = ['queue', 'transcribe', 'build', 'qa', 'done', 'parked'];
const STAGE_ORDER = { queued: 0, survey: 0, transcribe: 1, validate: 1, fidelity: 1, build: 2, qa: 3, done: 4 };
const RETRYABLE = new Set(['timeout', 'crash', 'limit', 'bad-output', 'interrupted']);

const FAVICON = {
  base: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231E1E1E'/%3E%3Ctext x='16' y='22' font-family='-apple-system,sans-serif' font-size='17' font-weight='700' fill='white' text-anchor='middle'%3EV%3C/text%3E%3C/svg%3E",
  done: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2315603D'/%3E%3Ctext x='16' y='22' font-family='-apple-system,sans-serif' font-size='17' font-weight='700' fill='white' text-anchor='middle'%3EV%3C/text%3E%3C/svg%3E",
  attention: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231E1E1E'/%3E%3Ctext x='14' y='22' font-family='-apple-system,sans-serif' font-size='17' font-weight='700' fill='white' text-anchor='middle'%3EV%3C/text%3E%3Ccircle cx='25' cy='7' r='5' fill='%23F3B8B0'/%3E%3C/svg%3E"
};

/* ---------------- state ---------------- */
const S = {
  speed: 1,                    // mock speed divisor
  conn: 'idle',                // idle | live | reconnecting | gone
  batch: null,
  jobs: new Map(),             // id -> job
  jobSeq: [],                  // ids, arrival order
  staged: new Map(),           // localKey -> staged upload (pre-start)
  stagedSeq: 0,
  parkedUploads: new Map(),    // key -> staged upload parked at start
  nextGroupHint: null,
  interrupted: null,
  interruptedDismissed: false,
  history: [],
  firstParkNotified: false,
  batchEndNotified: false,
  summaryShown: false,
  drawer: { open: false, jobId: null, uploadKey: null, opener: null },
  historyOpen: false,
  legendOpen: false,
  lastLive: '',
  goneTimer: null,
  es: null
};
/* live mode's boot render runs on an empty S; a snapshot arriving after that would
   look like a brand-new batch to the mascot and replay old events as bubbles.
   Set by the first applySnapshot (live) or once initMock has seeded its state. */
let mascotLive = false;

/* ---------------- DOM refs ---------------- */
const D = {
  live: $('#live'),
  headerNote: $('#headerNote'),
  mockBadge: $('#mockBadge'),
  mockCtl: $('#mockCtl'),
  speed1: $('#mockSpeed1'),
  speed4: $('#mockSpeed4'),
  connBadge: $('#connBadge'),
  connText: $('#connText'),
  etaChip: $('#etaChip'),
  batchWrap: $('#batchWrap'),
  batchBar: $('#batchBar'),
  countLine: $('#countLine'),
  stopBtn: $('#stopBtn'),
  banners: $('#banners'),
  workspace: $('#workspace'),
  dropzone: $('#dropzone'),
  dzDest: $('#dzDest'),
  picker: $('#picker'),
  staging: $('#staging'),
  stagingTitle: $('#stagingTitle'),
  stagingDest: $('#stagingDest'),
  stagingList: $('#stagingList'),
  addMoreBtn: $('#addMoreBtn'),
  startBtn: $('#startBtn'),
  startNote: $('#startNote'),
  legendBtn: $('#legendBtn'),
  legendPop: $('#legendPop'),
  doneSummary: $('#doneSummary'),
  board: $('#board'),
  scrim: $('#scrim'),
  drawer: $('#drawer'),
  drawerInner: $('#drawerInner'),
  historyPanel: $('#historyPanel'),
  historyInner: $('#historyInner'),
  toasts: $('#toasts'),
  favicon: $('#favicon'),
  railFolder: $('#railFolder'),
  railHistory: $('#railHistory'),
  railHelp: $('#railHelp')
};
const COL_BODY = {};
const COL_HEAD = {};
COL_ORDER.forEach(c => {
  const col = $('.col[data-col="' + c + '"]');
  COL_BODY[c] = $('.col-body', col);
  COL_HEAD[c] = { count: $('[data-count]', col), wait: $('[data-wait]', col) };
});

/* ---------------- toasts & live region ---------------- */
const toastTimers = [];
function toast(msg) {
  const t = el('div', 'toast', msg);
  D.toasts.appendChild(t);
  while (D.toasts.children.length > 3) D.toasts.removeChild(D.toasts.firstChild);
  setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
}
function announce(msg) {
  if (msg === S.lastLive) return;
  S.lastLive = msg;
  D.live.textContent = msg;
}

function copyText(text, okMsg) {
  const done = () => toast(okMsg || 'Copied to clipboard.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select the text in the drawer instead.'); }
  document.body.removeChild(ta);
}

function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try { new Notification(title, { body: body, silent: false }); } catch (e) { /* ignore */ }
}
function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
}

/* ---------------- normalization (defensive against server shape drift) ---------------- */
function prettyDrug(j) {
  if (j.drug_label) return j.drug_label;
  if (j.module) return String(j.module).replace(/^content_/, '');
  const n = String(j.name_original || j.name || '').replace(/\.pdf$/i, '');
  return n || 'unknown';
}
function normJob(raw) {
  const j = raw || {};
  const job = {
    id: String(j.id != null ? j.id : (j.job_id != null ? j.job_id : '')),
    upload_id: j.upload_id != null ? String(j.upload_id) : null,
    name_original: String(j.name_original || j.name || ''),
    module: j.module || null,
    decision: j.decision || '',
    stage: String(j.stage || 'queued'),
    state: String(j.state || 'waiting'),
    status_line: String(j.status_line || ''),
    chips: Array.isArray(j.chips) ? j.chips.filter(Boolean) : [],
    rounds: j.rounds || {},
    started: j.started || null,
    ended: j.ended || null,
    size: j.size != null ? j.size : null,
    error_class: j.error_class || (j.error && j.error.class) || null,
    queue_note: j.queue_note || ''
  };
  job.drug_label = String(j.drug_label || prettyDrug(job));
  return job;
}
function normBatch(raw) {
  if (!raw) return null;
  const b = raw;
  return {
    id: b.id != null ? String(b.id) : null,
    group: b.group || null,
    group_path: b.group_path || null,
    started: b.started || null,
    done: !!b.done,
    counts: b.counts || {},
    eta_s: (b.eta_s === 0 || b.eta_s) ? Number(b.eta_s) : null,
    eta_low_s: (b.eta_low_s === 0 || b.eta_low_s) ? Number(b.eta_low_s) : null,
    eta_high_s: (b.eta_high_s === 0 || b.eta_high_s) ? Number(b.eta_high_s) : null,
    paused: b.paused || null,
    caffeinated: !!b.caffeinated
  };
}
function batchRunning() {
  /* engine parity (_is_running_locked): a restored interrupted batch has done=null
     but no waiting/active jobs - it is NOT running. Paused counts as running. */
  const b = S.batch;
  if (!b || b.done) return false;
  if (b.paused) return true;
  let live = false;
  S.jobs.forEach(j => { if (j.state === 'waiting' || j.state === 'active') live = true; });
  return live;
}

function isUpdateJob(job) {
  return /^update/.test(String(job.decision || '')) ||
         job.chips.some(c => (c && (c.kind === 'update' || c.kind === 'slate')));
}
function colFor(job) {
  if (job.state === 'parked') return 'parked';
  if (job.state === 'skipped') return 'done';
  const st = job.stage;
  if (st === 'queued' || st === 'survey') return 'queue';
  if (st === 'transcribe' || st === 'validate' || st === 'fidelity') return 'transcribe';
  if (st === 'build') return 'build';
  if (st === 'qa') return 'qa';
  if (st === 'done') return 'done';
  return 'queue';
}
function progressOf(job) {
  if (job.stage === 'done' || job.state === 'skipped') return 5;
  const o = STAGE_ORDER[job.stage];
  return o == null ? 0 : o;
}
function jobTerminal(job) {
  return ['ok', 'flags', 'parked', 'failed', 'cancelled', 'skipped'].indexOf(job.state) !== -1;
}
function statusText(job) {
  if (job.status_line) return job.status_line;
  if (job.state === 'skipped') return 'Skipped — duplicate of an earlier upload';
  if (job.state === 'cancelled') return 'Cancelled';
  if (job.state === 'parked') return 'Parked';
  if (job.state === 'failed') return 'Stopped — open for detail';
  if (job.stage === 'done') {
    const inc = job.chips.some(c => c && c.kind === 'incomplete');
    if (inc) return 'Filed — incomplete, pending quantity limits';
    return S.batch && S.batch.group ? 'Filed to Group' + S.batch.group : 'Filed';
  }
  return STAGE_COPY[job.stage] || '';
}

/* ---------------- header / title / eta / segments ---------------- */
function totalJobs() { return S.jobs.size; }
function countBy(pred) { let n = 0; S.jobs.forEach(j => { if (pred(j)) n++; }); return n; }

function doneFiledCount() { return countBy(j => j.stage === 'done' && (j.state === 'ok' || j.state === 'flags')); }
function needYouCount() { return countBy(j => j.state === 'failed'); }
function parkedJobCount() { return countBy(j => j.state === 'parked'); }
function skippedCount() { return countBy(j => j.state === 'skipped'); }
function cancelledCount() { return countBy(j => j.state === 'cancelled'); }
function activeCount() { return countBy(j => j.state === 'active'); }
function incompleteCount() { return countBy(j => j.chips.some(c => c && c.kind === 'incomplete')); }
function dateFlagCount() { return countBy(j => j.chips.some(c => c && c.kind === 'date')); }
function settledCount() {
  return doneFiledCount() + skippedCount() + needYouCount() + parkedJobCount() + cancelledCount();
}

function renderHeader() {
  const running = batchRunning();
  const b = S.batch;
  const N = totalJobs();

  /* segmented bar: fill_i = share of cards past stage i */
  if (b && N > 0) {
    D.batchWrap.hidden = false;
    const segs = $$('.seg > i', D.batchBar);
    for (let i = 0; i < 5; i++) {
      const past = countBy(j => progressOf(j) > i);
      segs[i].style.setProperty('--p', String(past / N));
    }
    D.batchBar.classList.toggle('is-complete', !!b.done);
    const done = doneFiledCount() + skippedCount();
    D.countLine.textContent = done + ' of ' + N + ' done';
  } else {
    D.batchWrap.hidden = true;
  }

  /* ETA chip — honest: tilde, "estimating" until the engine has samples */
  if (running) {
    D.etaChip.hidden = false;
    if (b.paused) D.etaChip.textContent = 'paused';
    else if (b.eta_low_s != null && b.eta_high_s != null)
      D.etaChip.textContent = '~' + Math.max(1, Math.round(b.eta_low_s / 60)) + '–' + Math.max(1, Math.round(b.eta_high_s / 60)) + ' min left';
    else if (b.eta_s != null) D.etaChip.textContent = fmtMinApprox(b.eta_s) + ' left';
    else D.etaChip.textContent = 'estimating…';
  } else D.etaChip.hidden = true;

  D.stopBtn.hidden = !running;

  /* header note */
  if (running) {
    D.headerNote.textContent = 'Safe to close this tab — Vannessa keeps working on your Mac.' +
      (b.caffeinated ? ' Keeping the Mac awake for the batch.' : '');
  } else if (b && b.done) {
    D.headerNote.textContent = 'Batch finished. Drop more PDFs to start the next one.';
  } else {
    D.headerNote.textContent = 'Drop criteria PDFs to begin.';
  }

  /* tab title + favicon */
  if (running) {
    const done = doneFiledCount() + skippedCount();
    document.title = '▶ ' + done + '/' + N + ' — Vannessa';
    D.favicon.href = FAVICON.base;
  } else if (b && b.done) {
    const need = needYouCount() + parkedJobCount() + S.parkedUploads.size;
    if (need > 0) { document.title = need + ' need you — Vannessa'; D.favicon.href = FAVICON.attention; }
    else { document.title = '✓ done — Vannessa'; D.favicon.href = FAVICON.done; }
  } else {
    document.title = 'Vannessa — ePA Builder';
    D.favicon.href = FAVICON.base;
  }

  /* live region: batch-level only, on change */
  if (b && N) {
    const done = doneFiledCount() + skippedCount();
    let msg = done + ' of ' + N + ' done';
    const act = activeCount();
    if (act) msg += ', ' + act + ' in flight';
    const parked = parkedJobCount() + S.parkedUploads.size;
    if (parked) msg += ', ' + parked + ' parked';
    if (b.paused) msg += '. Paused on the Claude usage limit.';
    if (b.done) msg = 'Batch finished. ' + msg + '.';
    announce(msg);
  }

  /* workspace / drop zone mode */
  D.workspace.classList.toggle('is-running', running);
  D.dropzone.classList.toggle('is-slim', running);
  const dzTitle = $('h2', D.dropzone);
  const dzSub = $('.dz-sub', D.dropzone);
  if (running) {
    dzTitle.textContent = 'Add PDFs → next batch';
    clear(dzSub);
    dzSub.appendChild(document.createTextNode('They stage here and start after this batch. '));
  } else {
    dzTitle.textContent = 'Drop criteria PDFs';
    clear(dzSub);
    dzSub.appendChild(document.createTextNode('or '));
    dzSub.appendChild(el('span', 'linklike', 'browse files'));
    dzSub.appendChild(document.createTextNode(' — several at once is fine'));
  }
  renderConn();
}

function renderConn() {
  if (MOCK) { D.connBadge.hidden = true; return; }
  D.connBadge.hidden = S.conn === 'idle';
  D.connBadge.dataset.state = S.conn;
  D.connText.textContent = S.conn === 'live' ? 'Live' : (S.conn === 'reconnecting' ? 'Reconnecting…' : 'Offline');
}

/* ---------------- banners ---------------- */
function renderBanners() {
  clear(D.banners);
  if (S.conn === 'gone' && !MOCK) {
    const bn = el('div', 'banner banner-gone');
    bn.appendChild(el('b', null, "Vannessa's server isn't responding."));
    bn.appendChild(el('span', null, 'If a batch is running it keeps working on your Mac — this page just can’t see it. If the server crashed, relaunch Vannessa.command.'));
    bn.appendChild(el('span', 'banner-spacer'));
    const retry = el('button', 'btn btn-ghost btn-mini', 'Retry now');
    retry.type = 'button';
    retry.addEventListener('click', () => { reconnectNow(); });
    bn.appendChild(retry);
    D.banners.appendChild(bn);
  }
  if (S.batch && S.batch.paused) {
    const bn = el('div', 'banner banner-pause');
    bn.appendChild(el('b', null, 'Claude usage limit — paused.'));
    bn.appendChild(el('span', null, 'Resume when your window resets. Active jobs finished or parked; nothing was lost.'));
    bn.appendChild(el('span', 'banner-spacer'));
    const res = el('button', 'btn btn-primary btn-mini', 'Resume');
    res.type = 'button';
    res.addEventListener('click', () => { API.resume(); });
    bn.appendChild(res);
    D.banners.appendChild(bn);
  }
  if (S.interrupted && !S.interruptedDismissed) {
    const bn = el('div', 'banner banner-interrupted');
    bn.appendChild(el('b', null, 'Vannessa was interrupted mid-batch.'));
    bn.appendChild(el('span', null, S.interrupted.text ||
      'Finished documents stayed filed; in-flight jobs are parked with a Retry in their drawer.'));
    bn.appendChild(el('span', 'banner-spacer'));
    const dis = el('button', 'btn btn-ghost btn-mini', 'Dismiss');
    dis.type = 'button';
    dis.addEventListener('click', () => { S.interruptedDismissed = true; renderBanners(); });
    bn.appendChild(dis);
    D.banners.appendChild(bn);
  }
}

/* ---------------- done summary ---------------- */
function renderSummary() {
  const b = S.batch;
  if (!b || !b.done || totalJobs() === 0) { D.doneSummary.hidden = true; clear(D.doneSummary); return; }
  const filed = doneFiledCount();
  const need = needYouCount();
  const parked = parkedJobCount() + S.parkedUploads.size;
  const skipped = skippedCount();
  const cancelled = cancelledCount();
  const inc = incompleteCount();
  const dates = dateFlagCount();
  const clean = need === 0 && parked === 0 && inc === 0 && dates === 0 && cancelled === 0;

  clear(D.doneSummary);
  D.doneSummary.hidden = false;
  D.doneSummary.classList.toggle('is-clean', clean);
  D.doneSummary.classList.toggle('is-mixed', !clean);

  if (clean) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'check');
    svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5l4.2 4.2L19 7');
    path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2.4');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    D.doneSummary.appendChild(svg);
  }

  const groupName = b.group ? 'Group' + b.group : 'the Group folder';
  const parts = [];
  parts.push(clean ? 'All ' + filed + ' filed to ' + groupName : filed + ' filed to ' + groupName);
  if (need) parts.push(need + ' need you');
  if (parked) parts.push(parked + ' parked');
  if (skipped) parts.push(skipped + ' skipped');
  if (cancelled) parts.push(cancelled + ' cancelled');
  const line = el('div', 'sum-line');
  line.appendChild(el('div', null, parts.join(' · ')));
  const subBits = [];
  if (inc) subBits.push(inc + ' incomplete (pending quantity limits)');
  if (dates) subBits.push(dates + (dates === 1 ? ' date flag' : ' date flags'));
  if (subBits.length) {
    const sub = el('div', null, subBits.join(' · '));
    sub.style.fontSize = '12px'; sub.style.fontWeight = '400'; sub.style.color = 'var(--muted-text)';
    line.appendChild(sub);
  }
  D.doneSummary.appendChild(line);

  if (b.group_path) {
    const reveal = el('button', 'btn btn-ghost btn-mini', 'Reveal folder');
    reveal.type = 'button';
    reveal.addEventListener('click', () => API.reveal(b.group_path));
    D.doneSummary.appendChild(reveal);
  }
  const copyBtn = el('button', 'btn btn-ghost btn-mini', 'Copy flag report');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => copyText(batchFlagReport(), 'Flag report copied as markdown.'));
  D.doneSummary.appendChild(copyBtn);

  if (!S.batchEndNotified) {
    S.batchEndNotified = true;
    notify('Vannessa — batch done', parts.join(' · '));
  }
}

/* ---------------- flag reports (markdown) ---------------- */
function jobReportLines(job) {
  const lines = [];
  lines.push('## ' + job.drug_label + '  (' + job.name_original + ')');
  lines.push('- state: ' + job.state + (job.module ? ' · module: ' + job.module : ''));
  if (job.status_line) lines.push('- status: ' + job.status_line);
  job.chips.forEach(c => {
    if (!c) return;
    const label = c.kind === 'incomplete' ? INCOMPLETE_COPY : (c.label || c.kind);
    lines.push('- [' + (c.kind || 'note') + '] ' + label + (c.detail ? ' — ' + c.detail : ''));
  });
  return lines;
}

function batchFlagReport() {
  const b = S.batch || {};
  const lines = [];
  lines.push('# Vannessa flag report' + (b.group ? ' — Group' + b.group : ''));
  lines.push('');
  lines.push('- generated: ' + new Date().toLocaleString());
  if (b.group_path) lines.push('- folder: ' + b.group_path);
  const parts = [];
  parts.push(doneFiledCount() + ' filed');
  if (needYouCount()) parts.push(needYouCount() + ' need you');
  const parkedAll = parkedJobCount() + S.parkedUploads.size;
  if (parkedAll) parts.push(parkedAll + ' parked');
  if (skippedCount()) parts.push(skippedCount() + ' skipped');
  if (cancelledCount()) parts.push(cancelledCount() + ' cancelled');
  if (incompleteCount()) parts.push(incompleteCount() + ' ' + INCOMPLETE_COPY);
  if (dateFlagCount()) parts.push(dateFlagCount() + ' date flag' + (dateFlagCount() === 1 ? '' : 's'));
  lines.push('- totals: ' + parts.join(' · '));
  lines.push('');

  const buckets = [
    ['Needs Willie', j => j.state === 'failed'],
    ['Parked', j => j.state === 'parked'],
    ['Filed with flags', j => (j.state === 'flags' || (j.stage === 'done' && j.chips.some(c => c && c.kind !== 'clean' && c.kind !== 'update'))) && j.state !== 'failed' && j.state !== 'parked'],
    ['Skipped / cancelled', j => j.state === 'skipped' || j.state === 'cancelled'],
    ['Clean', j => j.state === 'ok' && !j.chips.some(c => c && c.kind !== 'clean' && c.kind !== 'update')]
  ];
  const used = new Set();
  buckets.forEach(bk => {
    const rows = [];
    S.jobSeq.forEach(id => {
      const j = S.jobs.get(id);
      if (!j || used.has(id)) return;
      if (bk[1](j)) { used.add(id); rows.push(j); }
    });
    if (!rows.length) return;
    lines.push('# ' + bk[0]);
    rows.forEach(j => { lines.push.apply(lines, jobReportLines(j)); lines.push(''); });
  });
  if (S.parkedUploads.size) {
    lines.push('# Parked before start');
    S.parkedUploads.forEach(e => {
      lines.push('## ' + e.name);
      lines.push('- ' + (e.parkNote || 'needs a decision — new drug or update?'));
      lines.push('');
    });
  }
  return lines.join('\n');
}

function cardFlagReport(job, detail) {
  const lines = jobReportLines(job);
  const d = detail || {};
  if (d.qa && Array.isArray(d.qa.notes)) d.qa.notes.forEach(n => lines.push('- QA NOTE: ' + n));
  if (Array.isArray(d.spec_flags)) d.spec_flags.forEach(f => lines.push('- ' + f));
  if (d.failure && d.failure.detail) lines.push('- failure: ' + (d.failure.kind || '') + ' — ' + d.failure.detail);
  return lines.join('\n');
}

/* ---------------- board: cards, order, FLIP ---------------- */
const CARD_EL = new Map();   // job id -> element
const GHOST_EL = {};         // col -> ghost element
COL_ORDER.forEach(c => {
  const g = el('div', 'col-ghost', GHOST_COPY[c] || '');
  GHOST_EL[c] = g;
});

function cardAria(job) {
  const bits = [job.drug_label, job.state === 'active' ? job.stage : job.state];
  job.chips.forEach(c => { if (c) bits.push(c.kind === 'incomplete' ? INCOMPLETE_COPY : (c.label || c.kind)); });
  return bits.join(', ') + '. Press Enter for detail.';
}

function buildCard(job) {
  const c = el('article', 'card');
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  c.dataset.id = job.id;
  const tile = el('span', 'tile');
  const main = el('div', 'card-main');
  main.appendChild(el('div', 'card-name'));
  main.appendChild(el('div', 'card-file'));
  const status = el('div', 'card-status');
  status.appendChild(el('span', 'status-text'));
  status.appendChild(el('span', 'elapsed'));
  main.appendChild(status);
  main.appendChild(el('div', 'card-chips'));
  c.appendChild(tile);
  c.appendChild(main);
  c.addEventListener('click', () => openDrawer(c.dataset.id, c));
  c.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(c.dataset.id, c); }
  });
  return c;
}

function chipEl(chip) {
  const kind = (chip && chip.kind) || 'note';
  const cls = CHIP_CLASS[kind] || 'gray';
  const label = kind === 'incomplete' ? INCOMPLETE_COPY : String((chip && chip.label) || kind);
  const sp = el('span', 'chip chip-' + cls, label);
  if (chip && chip.detail) sp.setAttribute('title', String(chip.detail));
  return sp;
}

function updateCardContent(job) {
  let c = CARD_EL.get(job.id);
  if (!c) { c = buildCard(job); CARD_EL.set(job.id, c); }
  const active = job.state === 'active';
  c.classList.toggle('is-active', active);
  c.classList.toggle('is-expanded', active);
  c.classList.toggle('is-dim', job.state === 'waiting');
  c.setAttribute('aria-label', cardAria(job));
  const tile = $('.tile', c);
  tile.textContent = (job.drug_label || '?').charAt(0).toUpperCase();
  tile.style.background = tileColor(job.drug_label);
  let badge = $('.tile-badge', tile);
  if (isUpdateJob(job)) {
    if (!badge) { badge = el('span', 'tile-badge', 'UPD'); tile.appendChild(badge); }
  } else if (badge) badge.remove();
  $('.card-name', c).textContent = job.drug_label;
  $('.card-file', c).textContent = job.name_original;
  $('.status-text', c).textContent = statusText(job);
  const elapsed = $('.elapsed', c);
  const startedMs = parseTs(job.started);
  if (active && startedMs) {
    c.dataset.started = String(startedMs);
    elapsed.textContent = ' · ' + fmtDur(nowMs() - startedMs);
  } else {
    delete c.dataset.started;
    elapsed.textContent = '';
  }
  const chipsBox = $('.card-chips', c);
  clear(chipsBox);
  job.chips.forEach(ch => { if (ch) chipsBox.appendChild(chipEl(ch)); });
  return c;
}

function stateRank(job) {
  if (job.state === 'active') return 0;
  if (job.state === 'waiting') return 1;
  return 2;
}

function desiredColumns() {
  const buckets = {};
  COL_ORDER.forEach(cName => { buckets[cName] = []; });
  S.jobSeq.forEach((id, idx) => {
    const j = S.jobs.get(id);
    if (!j) return;
    buckets[colFor(j)].push({ j: j, idx: idx });
  });
  COL_ORDER.forEach(cName => {
    const arr = buckets[cName];
    if (cName === 'done') {
      arr.sort((a, b) => (parseTs(b.j.ended) || 0) - (parseTs(a.j.ended) || 0) || b.idx - a.idx);
    } else if (cName === 'parked') {
      arr.sort((a, b) => a.idx - b.idx);
    } else {
      arr.sort((a, b) => stateRank(a.j) - stateRank(b.j) || a.idx - b.idx);
    }
    buckets[cName] = arr.map(x => x.j.id);
  });
  return buckets;
}

function flipBoard(mutate) {
  if (reducedMotion.matches) { mutate(); return; }
  const cards = $$('.card', D.board);
  const first = new Map();
  /* order matters: measure the ANIMATED rect first, then finish in-flight
     animations, then mutate the DOM, then measure layout, then animate. */
  cards.forEach(c => first.set(c, c.getBoundingClientRect()));
  cards.forEach(c => c.getAnimations().forEach(a => {
    try { a.finish(); } catch (e) { try { a.cancel(); } catch (e2) { /* ignore */ } }
  }));
  mutate();
  $$('.card', D.board).forEach(c => {
    const f = first.get(c);
    if (!f) return;                       // newly placed card: appear in place
    const l = c.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    c.classList.add('is-moving');
    const anim = c.animate(
      [{ transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(1.02)' },
       { transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    const settle = () => c.classList.remove('is-moving');
    anim.addEventListener('finish', settle);
    anim.addEventListener('cancel', settle);
  });
}

function syncBoard(flip) {
  /* drop cards whose jobs vanished (a new batch cleared the roster) */
  CARD_EL.forEach((cEl, id) => {
    if (!S.jobs.has(id)) { cEl.remove(); CARD_EL.delete(id); }
  });
  S.jobs.forEach(updateCardContent);
  const want = desiredColumns();

  let differs = false;
  COL_ORDER.forEach(cName => {
    const body = COL_BODY[cName];
    const current = $$('.card', body).map(x => x.dataset.id);
    const target = want[cName];
    if (current.length !== target.length ||
        current.some((id, i) => id !== target[i])) differs = true;
  });

  const mutate = () => {
    COL_ORDER.forEach(cName => {
      const body = COL_BODY[cName];
      if (GHOST_EL[cName].parentNode) GHOST_EL[cName].remove();
      want[cName].forEach(id => {
        const cEl = CARD_EL.get(id);
        if (cEl) body.appendChild(cEl);
      });
      $$('.card', body).forEach(cEl => {
        if (want[cName].indexOf(cEl.dataset.id) === -1) cEl.remove();
      });
      if (!want[cName].length) body.appendChild(GHOST_EL[cName]);
    });
  };
  if (differs) {
    if (flip) flipBoard(mutate); else mutate();
  } else {
    COL_ORDER.forEach(cName => {
      const body = COL_BODY[cName];
      if (!want[cName].length && !GHOST_EL[cName].parentNode) body.appendChild(GHOST_EL[cName]);
    });
  }

  COL_ORDER.forEach(cName => {
    const head = COL_HEAD[cName];
    if (head.count) head.count.textContent = String(want[cName].length);
    if (head.wait) {
      let note = '';
      if (cName === 'queue') {
        const waiting = want.queue.filter(id => {
          const j = S.jobs.get(id);
          return j && j.state === 'waiting';
        }).length;
        if (waiting) note = waiting + ' waiting';
      }
      head.wait.textContent = note;
    }
  });
}

/* elapsed ticker: once a second, active cards only */
setInterval(() => {
  CARD_EL.forEach(c => {
    if (!c.dataset.started) return;
    const sp = $('.elapsed', c);
    if (sp) sp.textContent = ' · ' + fmtDur(nowMs() - Number(c.dataset.started));
  });
}, 1000);

/* ---------------- drawer ---------------- */
let drawerRefreshTimer = null;

function openDrawer(jobId, opener) {
  const job = S.jobs.get(jobId);
  if (!job) return;
  S.drawer = { open: true, jobId: jobId, uploadKey: null, opener: opener || document.activeElement };
  D.scrim.hidden = false;
  D.drawer.hidden = false;
  requestAnimationFrame(() => D.drawer.classList.add('is-open'));
  clear(D.drawerInner);
  D.drawerInner.appendChild(drawerHead(job));
  D.drawerInner.appendChild(el('p', 'note-muted', 'Loading detail…'));
  refreshDrawer();
}

function closeDrawer() {
  if (!S.drawer.open) return;
  const opener = S.drawer.opener;
  S.drawer = { open: false, jobId: null, uploadKey: null, opener: null };
  D.drawer.classList.remove('is-open');
  D.drawer.hidden = true;
  D.scrim.hidden = true;
  if (opener && opener.isConnected) { try { opener.focus(); } catch (e) { /* ignore */ } }
}

function scheduleDrawerRefresh(jobId) {
  if (!S.drawer.open || S.drawer.jobId !== jobId) return;
  if (drawerRefreshTimer) return;
  drawerRefreshTimer = setTimeout(() => { drawerRefreshTimer = null; refreshDrawer(); }, 400);
}

function refreshDrawer() {
  if (!S.drawer.open || !S.drawer.jobId) return;
  const id = S.drawer.jobId;
  API.jobDetail(id).then(detail => {
    if (!S.drawer.open || S.drawer.jobId !== id) return;
    const st = D.drawerInner.scrollTop;
    renderDrawer(detail);
    D.drawerInner.scrollTop = st;
  }, err => {
    if (!S.drawer.open || S.drawer.jobId !== id) return;
    const job = S.jobs.get(id);
    clear(D.drawerInner);
    if (job) D.drawerInner.appendChild(drawerHead(job));
    D.drawerInner.appendChild(el('p', 'note-muted', 'Could not load the detail — ' + err.message));
  });
}

function drawerHead(job) {
  const head = el('div', 'drawer-head');
  const tile = el('span', 'tile', (job.drug_label || '?').charAt(0).toUpperCase());
  tile.style.background = tileColor(job.drug_label);
  head.appendChild(tile);
  const title = el('div', 'drawer-title');
  title.appendChild(el('h2', null, job.drug_label));
  title.appendChild(el('p', null, job.name_original + (job.module ? ' · ' + job.module + '.py' : '')));
  head.appendChild(title);
  const closeBtn = el('button', 'drawer-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close detail');
  closeBtn.addEventListener('click', closeDrawer);
  head.appendChild(closeBtn);
  return head;
}

function dsection(label) {
  const s = el('section', 'dsection');
  s.appendChild(el('span', 'microlabel', label));
  return s;
}

function foldSection(label) {
  const det = el('details', 'dfold');
  det.appendChild(el('summary', null, label));
  const wrap = el('div');
  det.appendChild(wrap);
  return { det: det, body: wrap };
}

function renderDrawer(detail) {
  const job = normJob((detail && detail.job) || S.jobs.get(S.drawer.jobId) || {});
  clear(D.drawerInner);
  D.drawerInner.appendChild(drawerHead(job));

  const status = el('p', 'drawer-status', statusText(job));
  D.drawerInner.appendChild(status);
  const r = detail.rounds || job.rounds || {};
  const roundsBits = [];
  if (r.transcribe > 1) roundsBits.push('transcription round ' + r.transcribe);
  if (r.buildqa > 1) roundsBits.push('build+QA round ' + r.buildqa);
  if (roundsBits.length) D.drawerInner.appendChild(el('p', 'note-muted', roundsBits.join(' · ')));
  if (job.chips.length) {
    const chips = el('div', 'drawer-chips');
    job.chips.forEach(ch => { if (ch) chips.appendChild(chipEl(ch)); });
    D.drawerInner.appendChild(chips);
  }

  /* 1 — needs attention (failure + stderr), attention-first per the ux critique */
  const failure = detail.failure;
  const build = detail.build;
  const qa = detail.qa;
  const validate = detail.validate;
  const stderrText =
    (failure && failure.stderr_tail) ||
    (build && !build.ok && (build.abort || build.stderr_tail)) ||
    (qa && (qa.kind === 'harness' || qa.kind === 'qa-fail') && qa.stderr_tail) || '';
  if (failure || (validate && validate.ok === false) ||
      (build && build.ok === false) || (qa && (qa.kind === 'qa-fail' || qa.kind === 'harness'))) {
    const s = dsection('Needs attention');
    if (failure) {
      const kind = failure.kind || 'failed';
      s.appendChild(el('p', null, oneLineFailure(kind, failure.detail)));
      if (kind === 'limit') {
        s.appendChild(el('p', 'note-muted', 'The queue is paused on the Claude usage limit. Resume (in the banner) retries this card without burning a retry.'));
      } else if (!RETRYABLE.has(kind)) {
        s.appendChild(el('p', 'note-muted', 'Nothing is altered to force a pass — this one needs Willie. The staging copy is kept for seven days.'));
      }
    }
    if (validate && validate.ok === false && Array.isArray(validate.errors)) {
      validate.errors.slice(0, 12).forEach(e2 => s.appendChild(el('p', 'qa-detail', '· ' + e2)));
    }
    if (stderrText) {
      const pre = el('pre', 'stderr-pre', stderrText);
      s.appendChild(pre);
      const cp = el('button', 'btn btn-ghost btn-mini', 'Copy stderr');
      cp.type = 'button';
      cp.addEventListener('click', () => copyText(stderrText, 'stderr copied.'));
      s.appendChild(cp);
    }
    D.drawerInner.appendChild(s);
  }

  /* 2 — what changed (update jobs) */
  if (isUpdateJob(job)) {
    const s = dsection('What changed');
    const grp = S.batch && S.batch.group ? 'Group' + S.batch.group : 'the new Group folder';
    s.appendChild(el('p', 'note-muted',
      'Updated document files to ' + grp + '. The previous .docx in its old Group folder is not touched; the old spec is backed up to _backups/.'));
    if (Array.isArray(detail.diff) && detail.diff.length) {
      const block = el('div', 'diff-block');
      detail.diff.forEach(line => {
        const t = String(line);
        let cls = 'diff-same';
        if (t.startsWith('+') && !t.startsWith('+++')) cls = 'diff-new';
        else if (t.startsWith('-') && !t.startsWith('---')) cls = 'diff-old';
        block.appendChild(el('div', cls, t));
      });
      s.appendChild(block);
    } else if (!jobTerminal(job) || job.state === 'parked' || job.state === 'failed') {
      s.appendChild(el('p', 'note-muted', 'The diff appears once a new spec exists.'));
    }
    D.drawerInner.appendChild(s);
  }

  /* 3 — QA table */
  if (qa && (Array.isArray(qa.groups) && qa.groups.length || (qa.notes && qa.notes.length))) {
    const s = dsection('QA — ' + (qa.groups ? qa.groups.length : 0) + ' checks');
    const table = el('table', 'qa-table');
    (qa.notes || []).forEach(n => {
      const tr = el('tr');
      tr.appendChild(el('td', 'qa-note', 'NOTE'));
      tr.appendChild(el('td', 'qa-detail', n));
      table.appendChild(tr);
    });
    (qa.groups || []).forEach(g => {
      const tr = el('tr');
      tr.appendChild(el('td', g.ok ? 'qa-pass' : 'qa-fail', g.ok ? 'pass' : 'FAIL'));
      const td = el('td');
      td.appendChild(el('div', null, g.label));
      (g.issues || []).forEach(i => td.appendChild(el('div', 'qa-detail', '– ' + i)));
      tr.appendChild(td);
      table.appendChild(tr);
    });
    s.appendChild(table);
    D.drawerInner.appendChild(s);
  }

  /* 4 — fidelity (side-by-side on misses) */
  const fid = detail.fidelity;
  if (fid) {
    const s = dsection('Source fidelity');
    const checked = fid.stats && fid.stats.lines_checked;
    if (fid.ok) {
      s.appendChild(el('p', null, 'Every transcribed line was found in the source' +
        (checked ? ' (' + checked + ' lines checked).' : '.')));
    } else {
      s.appendChild(el('p', null, (fid.misses || []).length + ' line(s) were not found in the source text' +
        (checked ? ' of ' + checked + ' checked.' : '.')));
      (fid.misses || []).slice(0, 8).forEach(m => {
        const pair = el('div', 'fidelity-pair');
        const left = el('div', 'fidelity-pane is-miss');
        left.appendChild(el('div', 'pane-label', 'Spec — ' + (m.field || 'line') +
          (m.cset_index != null ? ' · set ' + m.cset_index : '')));
        left.appendChild(document.createTextNode(String(m.text || '')));
        const right = el('div', 'fidelity-pane');
        right.appendChild(el('div', 'pane-label', 'Source'));
        right.appendChild(document.createTextNode(m.source_excerpt ||
          'No match in source.txt (whitespace-collapsed, case-folded search).'));
        pair.appendChild(left);
        pair.appendChild(right);
        s.appendChild(pair);
      });
    }
    (fid.warnings || []).forEach(w => s.appendChild(el('p', 'qa-detail', '⚠ ' + w)));
    D.drawerInner.appendChild(s);
  }

  /* 5 — transcription summary */
  const res = detail.result;
  const flags = detail.spec_flags || [];
  if (res || flags.length || detail.selfcheck || (detail.transcript_tail && detail.transcript_tail.length)) {
    const s = dsection('Transcription');
    if (res) {
      const bits = [];
      if (res.duration_ms != null) bits.push(fmtDur(res.duration_ms));
      if (res.num_turns != null) bits.push(res.num_turns + ' turns');
      if (res.total_cost_usd != null) bits.push('$' + Number(res.total_cost_usd).toFixed(2));
      if (res.subtype) bits.push(res.subtype);
      if (bits.length) s.appendChild(el('p', 'note-muted', 'opus · ' + bits.join(' · ')));
    }
    flags.forEach(f => s.appendChild(el('div', 'flag-para', f)));
    if (detail.selfcheck) {
      const fold = foldSection('Self-check');
      fold.body.appendChild(el('pre', 'stderr-pre', detail.selfcheck));
      s.appendChild(fold.det);
    }
    if (detail.transcript_tail && detail.transcript_tail.length) {
      const fold = foldSection('Activity tail');
      detail.transcript_tail.slice(-16).forEach(t2 =>
        fold.body.appendChild(el('div', 'tx-line', String((t2 && t2.text) || t2))));
      s.appendChild(fold.det);
    }
    D.drawerInner.appendChild(s);
  }

  /* 6 — build output */
  if (build && build.ok) {
    const s = dsection('Build');
    if (build.stats) s.appendChild(el('p', 'note-muted', build.stats));
    (build.warnings || []).forEach(w => s.appendChild(el('p', 'qa-detail', 'WARNING: ' + w)));
    (build.notes || []).forEach(n => s.appendChild(el('p', 'qa-detail', 'NOTE: ' + n)));
    if (build.wrote) s.appendChild(el('p', 'qa-detail', 'wrote ' + build.wrote));
    D.drawerInner.appendChild(s);
  }

  /* 7 — survey facts, collapsed */
  const survey = detail.survey;
  if (survey) {
    const fold = foldSection('Survey facts');
    const dl = el('dl', 'facts-grid');
    const fact = (k, v) => {
      if (v == null || v === '') return;
      dl.appendChild(el('dt', null, k));
      dl.appendChild(el('dd', null, String(v)));
    };
    fact('pages', survey.pages);
    fact('text chars', survey.chars);
    fact('size', fmtBytes(survey.size));
    fact('Revised', survey.revised || survey.revised_raw || '—');
    fact('Effective', survey.effective || survey.effective_raw || '—');
    fact('Quantity limits', survey.ql);
    fact('md5', survey.md5);
    if (survey.scanned) fact('scan?', 'little extractable text — likely an image scan');
    if (survey.dupe && survey.dupe.length) {
      fact('duplicate of', survey.dupe.map(d2 => d2.name + ' (' + d2.where + ')').join('; '));
    }
    fold.body.appendChild(dl);
    const s = dsection('Survey');
    s.appendChild(fold.det);
    D.drawerInner.appendChild(s);
  }

  /* actions */
  const actions = el('div', 'drawer-actions');
  const paths = detail.paths || {};
  const addBtn = (label, fn, primary) => {
    const b2 = el('button', primary ? 'btn btn-primary btn-mini' : 'btn btn-ghost btn-mini', label);
    b2.type = 'button';
    b2.addEventListener('click', fn);
    actions.appendChild(b2);
  };
  const docx = paths.docx || paths.staging_docx;
  if (docx) addBtn('Reveal .docx', () => API.reveal(docx));
  if (paths.spec) addBtn('Reveal spec', () => API.reveal(paths.spec));
  else if (paths.staging && (job.state === 'failed' || job.state === 'parked'))
    addBtn('Reveal staging folder', () => API.reveal(paths.staging));
  addBtn('Copy flag report', () => copyText(cardFlagReport(job, detail), 'Card report copied as markdown.'));
  const canRetry = (job.state === 'failed' || job.state === 'parked') &&
    failure && RETRYABLE.has(failure.kind) && failure.kind !== 'needs-willie';
  if (canRetry) {
    addBtn('Retry', () => {
      const msg = 'Retry ' + job.drug_label + '?\n\nIf it re-transcribes, opus runs again — about 1½–4 minutes of real usage. Three retries max, then it needs Willie.';
      if (!window.confirm(msg)) return;
      API.retry(job.id).then(res => {
        toast('Retrying ' + job.drug_label + (res && res.resumed_from ? ' from ' + res.resumed_from : '') + '.');
      }).catch(err => toast('Retry refused: ' + err.message));
    }, true);
  }
  if (job.state === 'waiting' || job.state === 'active') {
    addBtn('Cancel this card', () => {
      if (!window.confirm('Cancel ' + job.drug_label + '? Anything it already wrote in staging is kept; nothing reaches the library.')) return;
      API.cancelJob(job.id).catch(err => toast('Cancel refused: ' + err.message));
    });
  }
  if (actions.children.length) D.drawerInner.appendChild(actions);
}

function oneLineFailure(kind, detail) {
  const first = String(detail || '').split('\n')[0];
  const names = {
    timeout: 'Timed out', crash: 'The transcription process crashed',
    limit: 'Waiting — usage limit', 'bad-output': 'Bad output from the transcription',
    build: 'Build stopped', qa: 'QA failed', budget: 'Stopped at the budget cap',
    fidelity: 'Fidelity gate — lines not found in the source',
    validate: 'Spec validation failed', parked: 'Parked',
    'needs-willie': 'Retried 3 times — needs Willie'
  };
  const head = names[kind] || kind || 'Failed';
  return first ? head + ' — ' + first : head;
}

/* ---------------- legend popover ---------------- */
function buildLegend() {
  clear(D.legendPop);
  D.legendPop.appendChild(el('p', 'microlabel', 'What the chips mean'));
  LEGEND.forEach(item => {
    const row = el('div', 'legend-row');
    row.appendChild(chipEl({ kind: item.kind, label: item.label }));
    row.appendChild(el('p', null, item.text));
    D.legendPop.appendChild(row);
  });
  D.legendPop.appendChild(el('p', 'note-muted',
    'Pastels are caveats, never celebrations. Blush is the only “stop” color; nothing is altered to force a pass.'));
}

function setLegend(open) {
  S.legendOpen = open;
  D.legendPop.hidden = !open;
  D.legendBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) buildLegend();
}

/* ---------------- history panel ---------------- */
function setHistory(open) {
  S.historyOpen = open;
  D.historyPanel.hidden = !open;
  if (!open) return;
  clear(D.historyInner);
  const head = el('div', 'drawer-head');
  const title = el('div', 'drawer-title');
  title.appendChild(el('h2', null, 'Past batches'));
  title.appendChild(el('p', null, 'This session. The full log lives in gui/data/batches.jsonl.'));
  head.appendChild(title);
  const closeBtn = el('button', 'drawer-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close history');
  closeBtn.addEventListener('click', () => setHistory(false));
  head.appendChild(closeBtn);
  D.historyInner.appendChild(head);
  if (!S.history.length) {
    D.historyInner.appendChild(el('p', 'note-muted', 'No batch has finished in this session yet.'));
    return;
  }
  S.history.forEach(h => {
    const row = el('div', 'history-row');
    row.appendChild(el('span', null, h.when));
    const mid = el('span');
    mid.appendChild(el('b', null, h.group ? 'Group' + h.group : 'batch'));
    mid.appendChild(document.createTextNode(' — ' + h.line));
    row.appendChild(mid);
    D.historyInner.appendChild(row);
  });
}

function pushHistory() {
  const parts = [];
  parts.push(doneFiledCount() + ' filed');
  if (needYouCount()) parts.push(needYouCount() + ' need you');
  const parked = parkedJobCount() + S.parkedUploads.size;
  if (parked) parts.push(parked + ' parked');
  if (skippedCount()) parts.push(skippedCount() + ' skipped');
  if (cancelledCount()) parts.push(cancelledCount() + ' cancelled');
  S.history.unshift({
    when: new Date().toLocaleTimeString(),
    group: S.batch && S.batch.group,
    line: parts.join(' · ')
  });
  if (S.history.length > 20) S.history.pop();
}

/* ---------------- staging (intake) ---------------- */
const SCAN_PARK_COPY = 'No extractable text — likely a scan. Vannessa can’t transcribe images; this one needs manual entry (like Trintellix).';

function isPdfFile(f) {
  return f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
}

function findByUploadId(uid) {
  let found = null;
  S.staged.forEach(e => { if (!found && e.rec && e.rec.upload_id === uid) found = e; });
  return found;
}

function suggestDecision(rec) {
  const survey = rec.survey || {};
  if (survey.scanned && !(survey.dupe && survey.dupe.length)) return 'park';
  return rec.decision || 'park';
}

function ingest(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const zips = files.filter(f => /\.zip$/i.test(f.name || ''));
  if (zips.length) toast('Zips need unzipping first — drop the PDFs inside.');
  const pdfs = files.filter(isPdfFile);
  const rejected = files.length - pdfs.length - zips.length;
  if (rejected > 0) toast(rejected + ' non-PDF file' + (rejected > 1 ? 's' : '') + ' skipped.');
  pdfs.forEach(f => {
    if (f.size > 25 * 1024 * 1024) {
      toast(f.name + ' is over the 25 MB limit — skipped.');
      return;
    }
    const key = 'L' + (++S.stagedSeq);
    const entry = {
      key: key, name: f.name, size: f.size, file: f,
      uploading: true, error: null, rec: null,
      decision: null, includeAnyway: false,
      parkedAtStart: false, removed: false, consumed: false, parkNote: ''
    };
    S.staged.set(key, entry);
    uploadEntry(entry);
  });
  renderStaging();
}

function uploadEntry(entry) {
  entry.uploading = true;
  entry.error = null;
  API.upload(entry.file).then(rec => {
    /* a queue SSE event may have landed first and created a twin entry */
    const twin = findByUploadId(rec.upload_id);
    if (twin && twin !== entry) S.staged.delete(twin.key);
    entry.rec = rec;
    entry.uploading = false;
    entry.decision = suggestDecision(rec);
    if ((rec.survey || {}).scanned) entry.parkNote = SCAN_PARK_COPY;
    renderStaging();
  }, err => {
    entry.uploading = false;
    entry.error = err.message || 'upload failed';
    renderStaging();
  });
}

function reconcileUploads(list) {
  const seen = new Set();
  (list || []).forEach(rec => {
    if (!rec || !rec.upload_id) return;
    seen.add(rec.upload_id);
    let entry = findByUploadId(rec.upload_id);
    if (!entry) {
      /* match an in-flight local upload by name+size (response not back yet) */
      S.staged.forEach(e => {
        if (!entry && !e.rec && e.uploading && e.name === rec.name && e.size === rec.size) entry = e;
      });
    }
    if (!entry) {
      entry = {
        key: 'U' + rec.upload_id, name: rec.name || '', size: rec.size,
        file: null, uploading: false, error: null, rec: rec,
        decision: null, includeAnyway: false,
        parkedAtStart: false, removed: false, consumed: false, parkNote: ''
      };
      S.staged.set(entry.key, entry);
    }
    entry.rec = rec;
    entry.uploading = false;
    if (entry.decision == null) entry.decision = suggestDecision(rec);
    if ((rec.survey || {}).scanned && !entry.parkNote) entry.parkNote = SCAN_PARK_COPY;
  });
  S.staged.forEach(e => {
    if (e.rec && !seen.has(e.rec.upload_id)) e.consumed = true;
  });
  renderStaging();
}

function visibleEntries() {
  const out = [];
  S.staged.forEach(e => { if (!e.removed && !e.consumed) out.push(e); });
  return out;
}

function chooseDecision(entry, decision, isDupeOverride) {
  entry.decision = decision;
  if (isDupeOverride) entry.includeAnyway = decision !== 'skip';
  if (entry.rec) {
    if (entry.parkedAtStart && decision !== 'park') {
      API.resolve(entry.rec.upload_id, decision).then(res => {
        if (res && res.job_id) {
          entry.consumed = true;
          toast(entry.name + ' joined the running batch.');
        }
        renderStaging();
      }).catch(err => toast('Could not resolve: ' + err.message));
    } else if (!batchRunning()) {
      /* store the decision server-side for the next /api/start; quiet on failure */
      API.resolve(entry.rec.upload_id, decision).catch(() => {});
    }
  }
  renderStaging();
}

function decisionButtons(entry) {
  const box = el('div', 'stage-decide');
  const rec = entry.rec || {};
  const survey = rec.survey || {};
  const match = rec.match || {};
  const btn = (label, decision, pressed, isDupeOverride) => {
    const b2 = el('button', 'decide-btn', label);
    b2.type = 'button';
    b2.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b2.addEventListener('click', e => { e.stopPropagation(); chooseDecision(entry, decision, isDupeOverride); });
    box.appendChild(b2);
  };
  if (survey.dupe && survey.dupe.length) {
    btn('Skip (duplicate)', 'skip', entry.decision === 'skip', false);
    const alt = match.decision === 'update' && match.module ? 'update:' + match.module : 'new';
    btn('Run anyway', alt, entry.decision !== 'skip' && entry.decision !== 'park', true);
    return box;
  }
  if (match.decision === 'park' || entry.parkedAtStart) {
    btn('New drug', 'new', entry.decision === 'new', false);
    (match.candidates || []).slice(0, 4).forEach(c => {
      const mod = c && (c.module || c.name);
      if (!mod) return;
      btn('Update ' + mod, 'update:' + mod, entry.decision === 'update:' + mod, false);
    });
    btn('Decide later', 'park', entry.decision === 'park', false);
    return box;
  }
  return null;
}

function renderStaging() {
  const entries = visibleEntries();

  /* parked uploads = excluded at start, still undecided (the summary counts them) */
  S.parkedUploads.clear();
  S.staged.forEach(e => {
    if (e.parkedAtStart && !e.consumed && !e.removed && e.rec) {
      S.parkedUploads.set(e.rec.upload_id, e);
    }
  });

  D.staging.hidden = entries.length === 0;
  clear(D.stagingList);
  D.stagingTitle.textContent = 'Staging — ' + entries.length + ' file' + (entries.length === 1 ? '' : 's');
  const dest = batchRunning()
    ? '→ after this batch'
    : (S.nextGroupHint ? '→ Group' + S.nextGroupHint + ' (next)' : '→ next Group folder');
  D.stagingDest.textContent = entries.length ? dest : '';
  D.dzDest.textContent = S.nextGroupHint
    ? 'Files to Desktop/DrVannessa/Group' + S.nextGroupHint + ' (next free letter).'
    : 'Files to Desktop/DrVannessa — the next free Group folder (letter assigned at Start).';

  entries.forEach(entry => {
    const li = el('li', 'stage-item');
    const rec = entry.rec || {};
    const survey = rec.survey || {};
    const match = rec.match || {};
    if (entry.decision === 'park') li.classList.add('is-parked');
    if (entry.error) li.classList.add('is-error');

    const top = el('div', 'stage-top');
    if (entry.uploading) top.appendChild(el('span', 'spinner'));
    top.appendChild(el('span', 'stage-name', entry.name));
    top.appendChild(el('span', 'stage-size', fmtBytes(entry.size)));
    if (!entry.parkedAtStart) {
      const rm = el('button', 'stage-remove', '×');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + entry.name + ' from staging');
      rm.addEventListener('click', e => {
        e.stopPropagation();
        entry.removed = true;
        renderStaging();
      });
      top.appendChild(rm);
    }
    li.appendChild(top);

    if (entry.uploading) {
      li.appendChild(el('p', 'stage-sub', 'Uploading and surveying…'));
    } else if (entry.error) {
      li.appendChild(el('p', 'stage-sub is-bad', 'Upload failed — ' + entry.error));
      if (entry.file) {
        const again = el('button', 'decide-btn', 'Try again');
        again.type = 'button';
        again.addEventListener('click', () => { uploadEntry(entry); renderStaging(); });
        const box = el('div', 'stage-decide');
        box.appendChild(again);
        li.appendChild(box);
      }
    } else if (entry.rec) {
      /* plan line */
      let plan = '';
      if (entry.decision === 'skip') plan = 'Skips — duplicate already in the corpus';
      else if (entry.decision === 'new') plan = 'New drug → ' + (match.slug || 'a new content module');
      else if (String(entry.decision).startsWith('update:')) plan = 'Update of ' + String(entry.decision).slice(7);
      else plan = entry.parkedAtStart ? 'Parked — decide to enqueue it into the running batch' : 'Parked — needs a decision';
      li.appendChild(el('p', 'stage-sub', plan +
        (survey.pages ? ' · ' + survey.pages + ' page' + (survey.pages === 1 ? '' : 's') : '')));

      if (survey.scanned) li.appendChild(el('p', 'stage-sub is-warn', SCAN_PARK_COPY));
      if (survey.dupe && survey.dupe.length) {
        li.appendChild(el('p', 'stage-sub is-warn',
          'Duplicate of ' + survey.dupe.map(d2 => d2.name + ' (' + d2.where + ')').join(', ')));
      }
      if (survey.revised_raw && !survey.revised_ok) {
        li.appendChild(el('p', 'stage-sub is-warn',
          'Revised “' + survey.revised_raw + '” looks malformed — it will transcribe as a blank.'));
      }
      if (survey.effective_raw && !survey.effective_ok) {
        li.appendChild(el('p', 'stage-sub is-warn',
          'Effective “' + survey.effective_raw + '” looks malformed — it will transcribe as a blank.'));
      }
      const buttons = decisionButtons(entry);
      if (buttons) {
        li.appendChild(buttons);
        if (match.reason) li.appendChild(el('p', 'decide-why', match.reason));
      }
    }
    D.stagingList.appendChild(li);
  });

  updateStartUI(entries);
  renderHeader();
  mascotTick();             // staging changes (drops, scans, decisions) skip renderAll
}

function updateStartUI(entries) {
  entries = entries || visibleEntries();
  const uploading = entries.filter(e => e.uploading).length;
  const failed = entries.filter(e => e.error).length;
  const ready = entries.filter(e => e.rec && !e.error && e.decision !== 'park');
  const parked = entries.filter(e => e.rec && e.decision === 'park').length;

  if (batchRunning()) {
    D.startBtn.textContent = 'Start next batch';
    D.startBtn.disabled = true;
    D.startNote.textContent = entries.length
      ? 'A batch is running — these wait and start afterwards.' : '';
    return;
  }
  D.startBtn.textContent = ready.length ? 'Start ' + ready.length : 'Start batch';
  D.startBtn.disabled = ready.length === 0 || uploading > 0;
  const noteBits = [];
  if (uploading) noteBits.push(uploading + ' still surveying');
  if (parked) noteBits.push(parked + ' need' + (parked === 1 ? 's' : '') + ' a decision — they stay parked and can join later');
  if (failed) noteBits.push(failed + ' failed to upload');
  if (ready.length) noteBits.push('You can close this tab once it starts — Vannessa keeps working.');
  D.startNote.textContent = noteBits.join(' · ');
}

function startBatch() {
  const entries = visibleEntries();
  const payload = [];
  entries.forEach(e => {
    if (!e.rec || e.error || e.uploading) return;
    if (e.decision === 'park') return;          // parked chips stay out of the batch
    const item = { upload_id: e.rec.upload_id, decision: e.decision };
    if (e.includeAnyway) item.include_anyway = true;
    payload.push(item);
  });
  if (!payload.length || batchRunning()) return;
  requestNotifPermission();                      // permission asked at first Start
  D.startBtn.disabled = true;
  API.start({ uploads: payload }).then(res => {
    S.batchEndNotified = false;
    S.firstParkNotified = false;
    S.summaryShown = false;
    S.interruptedDismissed = false;
    payload.forEach(it => {
      const e = findByUploadId(it.upload_id);
      if (e) e.consumed = true;
    });
    S.staged.forEach(e => {
      if (!e.consumed && !e.removed && e.rec && e.decision === 'park') e.parkedAtStart = true;
    });
    toast('Batch started' + (res && res.group ? ' — filing to Group' + res.group : '') + '.');
    try { window.VannessaMascot && VannessaMascot.say({ kind: 'start', n: payload.length }); } catch (err) { /* decoration only */ }
    renderStaging();
  }).catch(err => {
    toast('Start refused: ' + err.message);
    updateStartUI();
  });
}

/* ---------------- API (real server) ---------------- */
function parseResponse(res) {
  return res.text().then(txt => {
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && (data.error || data.message || data.detail)) || txt || ('HTTP ' + res.status);
      throw new Error(String(msg).slice(0, 500));
    }
    return data;
  });
}
function postJSON(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }).then(parseResponse);
}
const RealAPI = {
  upload: f => fetch('/api/upload?name=' + encodeURIComponent(f.name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: f
  }).then(parseResponse),
  start: p => postJSON('/api/start', p),
  resolve: (uid, decision) => postJSON('/api/resolve', { upload_id: uid, decision: decision }),
  retry: id => postJSON('/api/retry', { job_id: id }),
  cancelBatch: () => postJSON('/api/cancel', { scope: 'batch' }),
  cancelJob: id => postJSON('/api/cancel', { job_id: id }),
  resume: () => postJSON('/api/resume', {}).catch(err => toast('Resume failed — ' + err.message)),
  reveal: p => postJSON('/api/reveal', { path: p }).catch(err => toast('Reveal failed — ' + err.message)),
  jobDetail: id => fetch('/api/job/' + encodeURIComponent(id)).then(parseResponse)
};

/* ---------------- shared update handlers (SSE + mock both land here) ---------------- */
function renderAll(flip) {
  renderHeader();
  renderBanners();
  renderSummary();
  syncBoard(flip);
  renderStaging();          // ends with mascotTick()
}

/* Mascot (mascot.js) is decoration: every call is guarded, and it only starts
   listening once S holds real state (see mascotLive). */
function mascotTick() {
  if (!mascotLive || !window.VannessaMascot) return;
  try {
    VannessaMascot.update(S, { dragging: D.dropzone.classList.contains('is-over') });
  } catch (err) { /* decoration only */ }
}

function handleJobUpdate(job, opts) {
  const prev = S.jobs.get(job.id);
  if (!prev) S.jobSeq.push(job.id);
  S.jobs.set(job.id, job);
  if (job.state === 'parked' && (!prev || prev.state !== 'parked') && !S.firstParkNotified) {
    const isLimitPark = job.chips.some(c => c && /usage limit/i.test(String(c.label || '')));
    if (!isLimitPark) {
      S.firstParkNotified = true;
      notify('Vannessa — a card parked', job.drug_label + ': ' + statusText(job));
    }
  }
  renderAll(!opts || opts.flip !== false);
  scheduleDrawerRefresh(job.id);
}

function handleBatchUpdate(batch) {
  const prevDone = !!(S.batch && S.batch.done);
  const prevId = S.batch && S.batch.id;
  S.batch = batch;
  if (batch && batch.id && prevId && batch.id !== prevId) {
    /* a new batch superseded the old roster: the server cleared its jobs but the
       stream never says so. Drop ours; job events repopulate. In real mode also
       refetch the snapshot once, in case a job event beat this batch event. */
    S.jobs.clear();
    S.jobSeq.length = 0;
    if (!MOCK) {
      fetch('/api/state').then(parseResponse).then(applySnapshot).catch(() => {});
    }
  }
  if (batch && batch.done && !prevDone) pushHistory();
  if (batch && !batch.done && prevDone) {
    /* a parked chip was resolved into a finished batch: it reopened */
    S.batchEndNotified = false;
    S.summaryShown = false;
  }
  renderAll(false);
}

function handleBanners(list) {
  const ib = (list || []).find(b2 => b2 && b2.kind === 'interrupted');
  if (ib) {
    const changed = !S.interrupted || S.interrupted.text !== ib.text;
    S.interrupted = { text: ib.text || '' };
    if (changed) S.interruptedDismissed = false;
  } else {
    S.interrupted = null;
    S.interruptedDismissed = false;
  }
  renderBanners();
}

function handleUpdate(evt) {
  if (!evt || !evt.kind) return;
  if (evt.kind === 'job' && evt.job) handleJobUpdate(normJob(evt.job), { flip: true });
  else if (evt.kind === 'batch' && evt.batch) handleBatchUpdate(normBatch(evt.batch));
  else if (evt.kind === 'queue') reconcileUploads(evt.uploads || []);
  else if (evt.kind === 'banner') handleBanners(evt.banners || []);
}

function applySnapshot(state) {
  state = state || {};
  S.batch = normBatch(state.batch);
  S.jobs = new Map();
  S.jobSeq = [];
  (state.jobs || []).forEach(raw => {
    const j = normJob(raw);
    if (!j.id) return;
    S.jobs.set(j.id, j);
    S.jobSeq.push(j.id);
  });
  if (S.batch && S.batch.done) S.batchEndNotified = true;   // don't re-ping on reload
  if (countBy(j => j.state === 'parked') > 0) S.firstParkNotified = true;
  handleBanners(state.banners || []);
  reconcileUploads(state.uploads || []);
  mascotLive = true;
  renderAll(false);
  scheduleDrawerRefresh(S.drawer.jobId);
}

/* ---------------- SSE client ---------------- */
function armGoneTimer() {
  if (S.goneTimer || MOCK) return;
  S.goneTimer = setTimeout(() => {
    S.goneTimer = null;
    S.conn = 'gone';
    renderConn();
    renderBanners();
    mascotTick();           // no job events arrive on a dead stream, so tick it here
  }, 12000);
}
function clearGoneTimer() {
  if (S.goneTimer) { clearTimeout(S.goneTimer); S.goneTimer = null; }
}
function connectSSE() {
  if (S.es) { try { S.es.close(); } catch (e) { /* ignore */ } }
  const es = new EventSource('/api/events');
  S.es = es;
  es.addEventListener('snapshot', e => {
    S.conn = 'live';
    clearGoneTimer();
    try { applySnapshot(JSON.parse(e.data)); } catch (err) { /* torn snapshot: next one wins */ }
    renderConn();
    renderBanners();
  });
  es.addEventListener('update', e => {
    let d = null;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    handleUpdate(d);
  });
  es.onopen = () => {
    S.conn = 'live';
    clearGoneTimer();
    renderConn();
    renderBanners();
    mascotTick();
  };
  es.onerror = () => {
    if (S.conn !== 'gone') { S.conn = 'reconnecting'; renderConn(); }
    armGoneTimer();
  };
}
function reconnectNow() {
  S.conn = 'reconnecting';
  clearGoneTimer();
  renderConn();
  renderBanners();
  connectSSE();
}

/* ---------------- global wiring ---------------- */
/* a missed drop must never navigate the tab into the PDF */
['dragover', 'drop'].forEach(t => window.addEventListener(t, e => e.preventDefault()));

['dragover', 'dragenter'].forEach(t =>
  D.dropzone.addEventListener(t, e => { e.preventDefault(); D.dropzone.classList.add('is-over'); mascotTick(); }));
['dragleave', 'drop'].forEach(t =>
  D.dropzone.addEventListener(t, e => { e.preventDefault(); D.dropzone.classList.remove('is-over'); mascotTick(); }));
D.dropzone.addEventListener('drop', e => ingest(e.dataTransfer.files));
D.dropzone.addEventListener('click', () => D.picker.click());
D.dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); D.picker.click(); }
});
D.picker.addEventListener('change', () => { ingest(D.picker.files); D.picker.value = ''; });
D.addMoreBtn.addEventListener('click', () => D.picker.click());
D.startBtn.addEventListener('click', startBatch);

D.stopBtn.addEventListener('click', () => {
  if (!window.confirm('Stop the whole batch? Active jobs are killed; finished documents stay filed; staging copies are kept.')) return;
  API.cancelBatch().then(res => {
    toast('Stopping — ' + ((res && res.cancelled) || 0) + ' job(s) cancelled.');
  }).catch(err => toast('Stop refused: ' + err.message));
});

D.legendBtn.addEventListener('click', e => { e.stopPropagation(); setLegend(!S.legendOpen); });
D.railHelp.addEventListener('click', e => { e.stopPropagation(); setLegend(true); });
document.addEventListener('click', e => {
  if (S.legendOpen && !D.legendPop.contains(e.target) && e.target !== D.legendBtn) setLegend(false);
});
D.railHistory.addEventListener('click', () => setHistory(true));
D.railFolder.addEventListener('click', () => {
  const p = S.batch && S.batch.group_path;
  if (p) API.reveal(p);
  else toast('No output folder yet — it appears when a batch starts.');
});
D.scrim.addEventListener('click', closeDrawer);
D.historyPanel.addEventListener('click', e => { if (e.target === D.historyPanel) setHistory(false); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (S.legendOpen) { setLegend(false); return; }
  if (S.historyOpen) { setHistory(false); return; }
  if (S.drawer.open) closeDrawer();
});

function setSpeed(x) {
  S.speed = x;
  D.speed1.setAttribute('aria-pressed', x === 1 ? 'true' : 'false');
  D.speed4.setAttribute('aria-pressed', x === 4 ? 'true' : 'false');
}
D.speed1.addEventListener('click', () => setSpeed(1));
D.speed4.addEventListener('click', () => setSpeed(4));

/* ================= mock mode (?mock=1) =================
   A fully client-side scripted batch. No network at all: the mock calls the
   same handleJobUpdate/handleBatchUpdate/reconcileUploads paths the SSE
   client uses, so every pixel exercised here is the real rendering code.
   Exercises: dupe skip · scan park · ambiguous collision choice · queue ·
   2 transcribe slots · fidelity auto-retry then park · build ABORT ·
   QA structured fail · limit-pause + resume · per-card cancel · every chip
   color · interrupted-recovery banner · mixed done + notification.
   ~90 s at 1×; the Demo speed toggle divides every delay. */

const Mock = MOCK ? {
  jobs: new Map(), order: [], meta: new Map(),
  batch: null, paused: null, banners: [],
  staged: new Map(),              // upload_id -> authoritative rec
  samples: [], tActive: 0, bActive: 0,
  started: false, uid: 0
} : null;

function nowS() { return Math.round(Date.now()) / 1000; }
function mcopy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function mockAfter(ms, fn) { return setTimeout(fn, Math.max(40, ms / S.speed)); }

const MOCK_TOOL = '/Users/demo/Documents/Scripts & Tools/kp_epa_builder';
const MOCK_GROUP_PATH = '/Users/demo/Desktop/DrVannessa/GroupC';
const MOCK_ABORT_FIRST = "quantity-limit line has 1 ' - ' segments, expected 3";
const MOCK_ABORT_TEXT = "ABORT: quantity-limit line has 1 ' - ' segments, expected 3\n" +
  "       line:     'ESTRADIOL (ESTRING) 7.5 MCG/DAY VAGINAL RING ONE SEGMENT ONLY'\n" +
  '       expected: <strengths> <form> - <route> - <quantity> PER <period>\n' +
  '       Fix the transcription in the content spec to match the formulary row, or\n' +
  '       report the row shape if formulary itself changed - do not hand-format it here.\n' +
  'SystemExit: 1';
const MOCK_INC_NOTE = 'INCOMPLETE: source states "Quantity Limits: Yes" but no rows are transcribed (formulary Quantity Limits PDF unavailable) - this document must not ship as final';
const MOCK_DATE_NOTE = 'Effective date 01/19/22 PRECEDES Revised date 11/10/22 - impossible as stated; transcribed from the source as written and flagged, not corrected';
const MOCK_QA_CHECKS = ['template preservation', 'footer', 'container integrity', 'page setup',
  'title + CPS table', 'numbering', 'content', 'python-docx reopen', 'original template untouched'];
const MOCK_FLAG_QL = 'FLAG: the source states "Quantity Limits: Yes" but carries no formulary rows; QL_LINES is left empty (QL: QL_PENDING) per the GUI rules — do not deliver without checking the formulary sheet.';
const MOCK_FLAG_DATE = 'FLAG: Effective date 01/19/22 precedes Revised date 11/10/22 — impossible as stated; transcribed exactly as the source prints it, not corrected.';
const MOCK_FLAG_STEP = 'FLAG: the step-therapy sentence in criteria set 2 reads ambiguously in the source ("after failure of one or two agents"); transcribed verbatim.';

const MOCK_ROSTER = [
  { name: 'abiraterone acetate (Zytiga).pdf', size: 412233, pages: 3, ql: 'No',
    plan: 'update', module: 'content_zytiga', script: 'clean', tdur: 10000 },
  { name: 'semaglutide (Wegovy).pdf', size: 388091, pages: 2, ql: 'No',
    plan: 'new', slug: 'content_wegovy', script: 'clean', tdur: 9000 },
  { name: 'dupilumab (Dupixent).pdf', size: 540870, pages: 4, ql: 'Yes',
    plan: 'new', slug: 'content_dupixent', script: 'incomplete', tdur: 11000 },
  { name: 'zonisamide suspension (Zonisade).pdf', size: 301442, pages: 2, ql: 'Yes',
    plan: 'new', slug: 'content_zonisade', script: 'flags-date', tdur: 12000 },
  { name: 'estradiol (Estring).pdf', size: 275002, pages: 2, ql: 'No',
    plan: 'new', slug: 'content_estring', script: 'build-abort', tdur: 8000 },
  { name: 'milnacipran (Savella).pdf', size: 352660, pages: 3, ql: 'No',
    plan: 'new', slug: 'content_savella', script: 'qa-fail', tdur: 9000 },
  { name: 'tenofovir alafenamide (Vemlidy).pdf', size: 630124, pages: 5, ql: 'No',
    plan: 'new', slug: 'content_vemlidy', script: 'fidelity-park', tdur: 8000 },
  { name: 'vortioxetine (Trintellix).pdf', size: 2400880, pages: 6, ql: 'No',
    plan: 'scan' },
  { name: 'abiraterone acetate (Zytiga) copy.pdf', size: 412233, pages: 3, ql: 'No',
    plan: 'dupe', dupeOf: 'abiraterone acetate (Zytiga).pdf' },
  { name: 'adalimumab.pdf', size: 489552, pages: 4, ql: 'No',
    plan: 'ambig', candidates: ['content_humira', 'content_amjevita'], script: 'clean', tdur: 7000 },
  { name: 'etanercept (Enbrel).pdf', size: 445109, pages: 3, ql: 'No',
    plan: 'new', slug: 'content_enbrel', script: 'limit', tdur: 7000 },
  { name: 'ustekinumab (Stelara).pdf', size: 505771, pages: 4, ql: 'No',
    plan: 'new', slug: 'content_stelara', script: 'cancel-demo', tdur: 9000 }
];

function mockMd5(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0; }
  let out = '';
  for (let i = 0; i < 4; i++) out += ('0000000' + ((h = (h * 48271) >>> 0)).toString(16)).slice(-8);
  return out.slice(0, 32);
}

function mockDrugLabel(name) {
  const stem = String(name || '').replace(/\.pdf\s*$/i, '').trim();
  const m = stem.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const brand = m[2].replace(/^generic\s+/i, '').trim();
    if (brand) return brand.slice(0, 60);
  }
  return (stem || 'upload').slice(0, 60);
}

function mockSurvey(f) {
  const scanned = f.plan === 'scan';
  return {
    pages: f.pages || 2,
    chars: scanned ? 118 : 9400 + (f.size % 900),
    size: f.size,
    revised: '09/12/26', revised_raw: '09/12/26', revised_ok: true,
    effective: '10/01/26', effective_raw: '10/01/26', effective_ok: true,
    ql: f.ql || 'No', ql_raw: f.ql || 'No',
    ql_pending_expected: f.ql === 'Yes',
    scanned: scanned,
    dupe: f.plan === 'dupe' ? [{ name: f.dupeOf, where: 'this session' }] : [],
    md5: mockMd5(f.plan === 'dupe' ? f.dupeOf : f.name),
    error: null, ok: true
  };
}

function mockMatch(f) {
  if (f.plan === 'update') {
    return { decision: 'update', module: f.module, slug: null, candidates: [], reason: 'exact brand match' };
  }
  if (f.plan === 'ambig') {
    return {
      decision: 'park', module: null, slug: null,
      candidates: f.candidates.map(m => ({ module: m, why: 'brand tokens overlap' })),
      reason: 'two library specs match these brand tokens — choose by hand'
    };
  }
  return { decision: 'new', module: null, slug: f.slug || ('content_' + mockDrugLabel(f.name).toLowerCase().replace(/[^a-z0-9]+/g, '')), candidates: [], reason: '' };
}

function mStage(f) {
  const uid = 'mu' + (++Mock.uid);
  const rec = {
    upload_id: uid, name: f.name, size: f.size, ts: nowS(),
    md5: mockMd5(f.plan === 'dupe' ? f.dupeOf : f.name),
    survey: mockSurvey(f), match: mockMatch(f),
    decision: f.plan === 'dupe' ? 'skip'
      : f.plan === 'update' ? 'update:' + f.module
      : f.plan === 'ambig' ? 'park' : 'new',
    status: 'staged',
    mockSpec: f
  };
  Mock.staged.set(uid, rec);
  mPubQueue();
}

/* -------- mock publish (into the exact same handlers SSE feeds) -------- */
function mPubJob(j) { handleJobUpdate(normJob(mcopy(j)), { flip: true }); }
function mPubQueue() {
  const ups = [];
  Mock.staged.forEach(r => { if (r.status === 'staged' || r.status === 'parked') ups.push(r); });
  reconcileUploads(mcopy(ups));
}
function mPubBanners() { handleBanners(mcopy(Mock.banners)); }
function mPubBatch() {
  if (!Mock.batch) return;
  const b = Mock.batch;
  const counts = { queued: 0, active: 0, done: 0, parked: 0, failed: 0, skipped: 0 };
  let remT = 0, remBQ = 0;
  Mock.jobs.forEach(j => {
    const s = j.state;
    if (s === 'waiting') counts.queued++;
    else if (s === 'active') counts.active++;
    else if (s === 'ok' || s === 'flags') counts.done++;
    else if (s === 'parked') counts.parked++;
    else if (s === 'skipped') counts.skipped++;
    else counts.failed++;
    if (s === 'waiting' || s === 'active') {
      remBQ++;
      if (j.stage === 'queued' || j.stage === 'survey' || j.stage === 'transcribe') remT++;
    }
  });
  b.counts = counts;
  if (Mock.samples.length >= 2 && remT + remBQ > 0) {
    const mean = Mock.samples.reduce((a, c) => a + c, 0) / Mock.samples.length;
    b.eta_s = Math.round(mean * Math.floor((remT + 1) / 2) + 2 * remBQ);
  } else {
    b.eta_s = null;
  }
  b.paused = Mock.paused ? mcopy(Mock.paused) : null;
  handleBatchUpdate(normBatch(mcopy(b)));
}

function mSet(j, fields) {
  Object.assign(j, fields);
  mPubJob(j);
  mPubBatch();
}
function mChip(j, kind, label, detail) {
  if (j.chips.some(c => c && c.kind === kind && c.label === label)) return;
  j.chips.push({ kind: kind, label: label, detail: detail || '' });
}
function mStripChips(j, kinds) {
  j.chips = j.chips.filter(c => c && kinds.indexOf(c.kind) === -1);
}
function mReleaseSlot(j) {
  const meta = Mock.meta.get(j.id);
  if (!meta) return;
  if (meta.slot === 't') Mock.tActive = Math.max(0, Mock.tActive - 1);
  if (meta.slot === 'b') Mock.bActive = Math.max(0, Mock.bActive - 1);
  meta.slot = null;
}
function runStep(j, ms, fn) {
  const meta = Mock.meta.get(j.id);
  meta.timer = mockAfter(ms, () => {
    meta.timer = null;
    if (j.state !== 'active') return;     // cancelled / parked mid-step
    fn();
  });
}

function mMakeJob(rec, item) {
  const f = rec.mockSpec || {};
  const id = 'mj' + (++Mock.uid);
  let decision = (item && item.decision) || rec.decision || 'park';
  let module = null, state = 'waiting', status = '';
  const chips = [];
  if (decision === 'skip') {
    state = 'skipped';
    status = 'skipped — duplicate of an earlier source';
    chips.push({
      kind: 'parked', label: 'skipped (dupe)',
      detail: (rec.survey.dupe || []).map(d => d.name + ' (' + d.where + ')').join(', ') || 'marked skip'
    });
  } else if (String(decision).startsWith('update:')) {
    module = String(decision).slice(7);
    chips.push({ kind: 'update', label: 'update of ' + module, detail: 're-transcribes an existing library spec' });
  } else {
    decision = 'new';
    module = (rec.match && rec.match.slug) || f.slug || ('content_' + mockDrugLabel(rec.name).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  }
  const job = {
    id: id, upload_id: rec.upload_id, name_original: rec.name,
    drug_label: mockDrugLabel(rec.name), module: module, decision: decision,
    stage: 'queued', state: state, status_line: status, chips: chips,
    rounds: { transcribe: 0, buildqa: 0 },
    started: nowS(), ended: state === 'skipped' ? nowS() : null
  };
  Mock.jobs.set(id, job);
  Mock.order.push(id);
  Mock.meta.set(id, {
    spec: f, rec: rec, retries: 0, failure: null, timer: null, slot: null,
    transcript: [], validate: null, fidelity: null, build: null, qa: null,
    promote: null, result: null, limitDone: false, selfcheck: null
  });
  return job;
}

function mDocxName(j) {
  return 'KP_ePA_' + String(j.module || 'module').replace(/^content_/, '') + '_Completed.docx';
}
function mockBuildOk(j) {
  return {
    ok: true, exit: 0,
    wrote: '/tmp/vannessa/jobs/' + j.id + '/out/' + mDocxName(j),
    warnings: [], notes: [],
    stats: 'paragraphs: 12   criteria sets: 2   sections: 1 (numIds 5)',
    abort: null, stderr_last: '', stderr_tail: ''
  };
}
function mockQa(j, notes, fail) {
  const groups = MOCK_QA_CHECKS.map(label => {
    if (fail && label === 'footer') {
      return { label: label, ok: false, issues: [
        "spec states no REVISED; the footer carries the template's date, which belongs to another drug",
        "spec states no EFFECTIVE; the footer carries the template's date, which belongs to another drug"
      ] };
    }
    return { label: label, ok: true, issues: [] };
  });
  return {
    kind: fail ? 'qa-fail' : (notes.length ? 'flags' : 'clean'),
    exit: fail ? 1 : 0, header: mDocxName(j),
    notes: notes.slice(), groups: groups,
    failed_groups: fail ? ['footer'] : [],
    incomplete: notes.some(n => n.indexOf('INCOMPLETE') === 0),
    stderr_last: '', stderr_tail: ''
  };
}
function mockFidelityMiss() {
  return {
    ok: false,
    misses: [{
      field: 'criteria', cset_index: 1,
      text: 'Patient has a documented diagnosis of chronic hepatitis B with evidence of compensated liver disease',
      source_excerpt: '…indicated for chronic hepatitis B in adults with compensated liver disease (see Table 2)…'
    }],
    warnings: ['coverage: 3 "criteria" headings found in the source vs 2 criteria sets transcribed'],
    stats: { lines_checked: 21 }
  };
}
const MOCK_DIFF = [
  '--- content_zytiga.py (before)', '+++ content_zytiga.py (this job)',
  '@@ -8,3 +8,3 @@', ' BRAND = "Zytiga"',
  '-REVISED = "03/14/24"', '-EFFECTIVE = "04/01/24"',
  '+REVISED = "09/12/26"', '+EFFECTIVE = "10/01/26"',
  '@@ -41,2 +41,3 @@',
  ' ("bullet", "Diagnosis of metastatic castration-resistant prostate cancer"),',
  '+        ("bullet", "Concurrent prednisone therapy documented"),'
];

/* -------- mock pipeline -------- */
function mNextWaiting(kind) {
  let found = null;
  Mock.order.forEach(id => {
    if (found) return;
    const j = Mock.jobs.get(id);
    if (!j || j.state !== 'waiting') return;
    if (kind === 'transcribe' && j.stage === 'queued') found = j;
    else if (kind === 'build' && j.stage === 'build') found = j;
  });
  return found;
}

/* demo beats keyed to batch progress, not wall-clock, so the speed toggle
   can never push them past the end of the run */
function mMaybeDemoBeats() {
  if (!Mock.beats || !Mock.batch || Mock.batch.done != null) return;
  let settled = 0;
  Mock.jobs.forEach(j => {
    if (j.state !== 'waiting' && j.state !== 'active') settled++;
  });
  if (!Mock.beats.cancel && settled >= 3) {
    Mock.beats.cancel = true;
    let target = null;
    Mock.jobs.forEach(j2 => {
      const m2 = Mock.meta.get(j2.id);
      if (!target && m2 && m2.spec.script === 'cancel-demo' &&
          (j2.state === 'waiting' || j2.state === 'active')) target = j2;
    });
    if (target) {
      toast('Demo: cancelling ' + target.drug_label + ' from its drawer (per-card cancel).');
      mockAfter(400, () => {
        if (target.state === 'waiting' || target.state === 'active') MockAPI.cancelJob(target.id);
      });
    }
  }
  if (!Mock.beats.resolve && settled >= 5) {
    Mock.beats.resolve = true;
    let rec = null;
    Mock.staged.forEach(r2 => {
      if (!rec && r2.mockSpec && r2.mockSpec.plan === 'ambig' && r2.status !== 'consumed') rec = r2;
    });
    if (rec) {
      const uid = rec.upload_id;
      toast('Demo: deciding the parked choice — update of content_humira.');
      mockAfter(400, () => {
        const r3 = Mock.staged.get(uid);
        if (!r3 || r3.status === 'consumed') return;
        const entry = findByUploadId(uid);
        if (entry) chooseDecision(entry, 'update:content_humira', false);
        else MockAPI.resolve(uid, 'update:content_humira');
      });
    }
  }
}

function pump() {
  if (!Mock.batch || Mock.batch.done != null) return;
  mMaybeDemoBeats();
  if (Mock.paused) { mPubBatch(); return; }
  while (Mock.bActive < 1) {
    const j = mNextWaiting('build');
    if (!j) break;
    mRunBuildQA(j);
  }
  while (Mock.tActive < 2) {
    const j = mNextWaiting('transcribe');
    if (!j) break;
    mRunTranscribe(j);
  }
  mPubBatch();
  mCheckDone();
}

function mCheckDone() {
  if (!Mock.batch || Mock.batch.done != null || Mock.paused) return;
  let open = false;
  Mock.jobs.forEach(j => { if (j.state === 'waiting' || j.state === 'active') open = true; });
  if (open || Mock.jobs.size === 0) return;
  Mock.batch.done = nowS();
  Mock.batch.caffeinated = false;
  mPubBatch();
}

function mRunTranscribe(j) {
  const meta = Mock.meta.get(j.id);
  Mock.tActive++;
  meta.slot = 't';
  meta.t0 = Date.now();
  meta.transcript.push({ ts: nowS(), text: 'init: claude -p … --model opus (tools: Read, Write)' });
  meta.transcript.push({ ts: nowS(), text: 'read rules.md, exemplar_zonisade.py, exemplar_vemlidy.py, exemplar_savella.py' });
  mSet(j, { stage: 'transcribe', state: 'active', status_line: STAGE_COPY.transcribe });
  if (meta.spec.script === 'limit' && !meta.limitDone) {
    runStep(j, 4000, () => mHitLimit(j));
    return;
  }
  const dur = (meta.spec.tdur || 8000) * (j.rounds.transcribe > 0 ? 0.7 : 1);
  runStep(j, dur, () => mAfterTranscribe(j));
}

function mHitLimit(j) {
  const meta = Mock.meta.get(j.id);
  meta.limitDone = true;
  meta.failure = { kind: 'limit', detail: 'claude: usage limit reached — your limit will reset at the top of the hour' };
  mReleaseSlot(j);
  mChip(j, 'parked', 'waiting — usage limit', 'the queue is paused; Resume retries this job');
  mSet(j, { state: 'parked', status_line: 'waiting — usage limit', ended: nowS() });
  Mock.paused = { reason: 'limit', since: nowS() };
  mPubBatch();
  mockAfter(8000, () => {
    if (Mock.paused) {
      toast('Demo: the usage window reset — pressing Resume.');
      MockAPI.resume();
    }
  });
}

function mAfterTranscribe(j) {
  const meta = Mock.meta.get(j.id);
  Mock.samples.push((Date.now() - meta.t0) / 1000);
  j.rounds.transcribe += 1;
  meta.result = {
    subtype: 'success', is_error: false,
    duration_ms: (meta.spec.tdur || 8000) * 14,
    num_turns: 11 + (j.id.charCodeAt(2) % 7),
    total_cost_usd: Math.round((0.85 + ((meta.spec.tdur || 8000) % 500) / 400) * 100) / 100
  };
  meta.transcript.push({ ts: nowS(), text: 'write ' + j.module + '.py (14 KB) · write selfcheck.md' });
  meta.transcript.push({ ts: nowS(), text: 'result: success — transcription complete, self-check PASS' });
  meta.selfcheck = 'PASS — every criteria line re-read and found verbatim in source.txt.';
  mSet(j, { stage: 'validate', status_line: STAGE_COPY.validate });
  runStep(j, 700, () => {
    meta.validate = { ok: true, errors: [] };
    mSet(j, { stage: 'fidelity', status_line: STAGE_COPY.fidelity });
    runStep(j, 700, () => mFidelity(j));
  });
}

function mFidelity(j) {
  const meta = Mock.meta.get(j.id);
  if (meta.spec.script === 'fidelity-park') {
    meta.fidelity = mockFidelityMiss();
    meta.selfcheck = 'ISSUES — 1 criteria line could not be re-located in source.txt.';
    if (j.rounds.transcribe < 2) {
      meta.t0 = Date.now();
      mSet(j, { stage: 'transcribe', status_line: '1 line not found in the source — transcribing once more with the miss quoted' });
      runStep(j, 6000, () => mAfterTranscribe(j));
      return;
    }
    meta.failure = { kind: 'fidelity', detail: 'a criteria line is still not in the source after one automatic re-transcription' };
    mReleaseSlot(j);
    mChip(j, 'parked', 'fidelity: needs Willie', '1 transcribed line is not in the source text, even after the automatic retry — side-by-side below');
    mSet(j, { state: 'parked', status_line: 'parked — fidelity: needs Willie', ended: nowS() });
    pump();
    return;
  }
  meta.fidelity = { ok: true, misses: [], warnings: [], stats: { lines_checked: 23 } };
  mReleaseSlot(j);
  mSet(j, { stage: 'build', state: 'waiting', status_line: 'waiting for the build slot' });
  pump();
}

function mRunBuildQA(j) {
  const meta = Mock.meta.get(j.id);
  Mock.bActive++;
  meta.slot = 'b';
  mSet(j, { stage: 'build', state: 'active', status_line: STAGE_COPY.build });
  runStep(j, 1800, () => {
    if (meta.spec.script === 'build-abort') {
      meta.build = {
        ok: false, exit: 1, wrote: null, warnings: [], notes: [], stats: null,
        abort: MOCK_ABORT_TEXT, stderr_last: 'SystemExit: 1', stderr_tail: MOCK_ABORT_TEXT
      };
      meta.failure = { kind: 'build', detail: MOCK_ABORT_FIRST, stderr_tail: MOCK_ABORT_TEXT };
      mChip(j, 'fail', 'build error', MOCK_ABORT_FIRST);
      mReleaseSlot(j);
      mSet(j, { state: 'failed', status_line: 'build error: ' + MOCK_ABORT_FIRST + ' — needs Willie', ended: nowS() });
      pump();
      return;
    }
    meta.build = mockBuildOk(j);
    j.rounds.buildqa += 1;
    mSet(j, { stage: 'qa', status_line: STAGE_COPY.qa });
    runStep(j, 1600, () => mAfterQA(j));
  });
}

function mAfterQA(j) {
  const meta = Mock.meta.get(j.id);
  if (meta.spec.script === 'qa-fail') {
    meta.qa = mockQa(j, [], true);
    if (j.rounds.buildqa < 2) {
      mSet(j, { stage: 'build', status_line: 'QA failed — one automatic build+QA round' });
      runStep(j, 1200, () => {
        meta.build = mockBuildOk(j);
        j.rounds.buildqa += 1;
        mSet(j, { stage: 'qa', status_line: 'Running the checks — round 2' });
        runStep(j, 1000, () => {
          meta.qa = mockQa(j, [], true);
          meta.failure = { kind: 'qa', detail: "footer: spec states no REVISED; the footer carries the template's date" };
          mChip(j, 'fail', 'QA failed', 'the footer check failed twice; nothing is altered to force a pass');
          mReleaseSlot(j);
          mSet(j, { state: 'failed', status_line: 'QA failed: footer — needs Willie', ended: nowS() });
          pump();
        });
      });
      return;
    }
  }
  const notes = [];
  if (meta.spec.script === 'incomplete') notes.push(MOCK_INC_NOTE);
  if (meta.spec.script === 'flags-date') { notes.push(MOCK_INC_NOTE); notes.push(MOCK_DATE_NOTE); }
  meta.qa = mockQa(j, notes, false);
  meta.promote = {
    ok: true,
    spec_path: MOCK_TOOL + '/' + j.module + '.py',
    docx_path: MOCK_GROUP_PATH + '/' + mDocxName(j),
    backup_path: isUpdateJob(j) ? MOCK_TOOL + '/_backups/' + j.module + '-pre-gui-update-20261030.py' : null
  };
  const incomplete = notes.some(n => n.indexOf('INCOMPLETE') === 0);
  if (incomplete) mChip(j, 'incomplete', INCOMPLETE_COPY, MOCK_INC_NOTE);
  if (notes.indexOf(MOCK_DATE_NOTE) !== -1) mChip(j, 'date', 'date flag', MOCK_DATE_NOTE);
  if (!notes.length) mChip(j, 'clean', 'clean pass', 'all QA checks passed');
  mReleaseSlot(j);
  mSet(j, {
    stage: 'done', state: notes.length ? 'flags' : 'ok',
    status_line: incomplete ? 'filed to GroupC — ' + INCOMPLETE_COPY : 'filed to GroupC',
    ended: nowS()
  });
  pump();
}

function mCancelJob(j) {
  const meta = Mock.meta.get(j.id);
  if (meta && meta.timer) { clearTimeout(meta.timer); meta.timer = null; }
  mReleaseSlot(j);
  mChip(j, 'cancelled', 'cancelled', 'stopped by hand; nothing reached the library');
  mSet(j, { state: 'cancelled', status_line: 'cancelled — nothing was written to the library', ended: nowS() });
}

/* -------- mock API (same surface as RealAPI) -------- */
const MockAPI = !MOCK ? null : {
  upload: f => new Promise((resolve) => {
    mockAfter(600, () => {
      const uid = 'mu' + (++Mock.uid);
      const rec = {
        upload_id: uid, name: f.name, size: f.size, ts: nowS(), md5: mockMd5(f.name + f.size),
        survey: mockSurvey({ name: f.name, size: f.size, pages: 2, ql: 'No', plan: 'drop' }),
        match: { decision: 'park', module: null, slug: null, candidates: [], reason: 'mock mode stages live drops as a parked choice' },
        decision: 'park', status: 'staged', mockSpec: { script: 'clean', tdur: 7000 }
      };
      Mock.staged.set(uid, rec);
      resolve(mcopy(rec));
      mPubQueue();
    });
  }),
  start: payload => {
    if (Mock.batch && Mock.batch.done == null && Mock.started) {
      return Promise.reject(new Error('a batch is already running — one at a time'));
    }
    Mock.jobs.forEach(j2 => {       // stale timers must not resurrect old jobs
      const m2 = Mock.meta.get(j2.id);
      if (m2 && m2.timer) { clearTimeout(m2.timer); m2.timer = null; }
    });
    Mock.jobs.clear();
    Mock.order.length = 0;
    Mock.meta.clear();
    Mock.samples.length = 0;
    Mock.tActive = 0;
    Mock.bActive = 0;
    Mock.paused = null;
    Mock.banners = Mock.banners.filter(b => b.id !== 'interrupted');
    mPubBanners();
    Mock.batch = {
      id: 'mock' + Date.now(), group: 'C', group_path: MOCK_GROUP_PATH,
      started: nowS(), done: null, counts: {}, eta_s: null, paused: null, caffeinated: true
    };
    Mock.started = true;
    mPubBatch();                    // new batch id first, so stale cards clear
    (payload.uploads || []).forEach(it => {
      const rec = Mock.staged.get(it.upload_id);
      if (!rec || rec.status === 'consumed') return;
      rec.status = 'consumed';
      mMakeJob(rec, it);
    });
    Mock.order.forEach(id => mPubJob(Mock.jobs.get(id)));
    mPubQueue();
    mPubBatch();
    Mock.beats = { cancel: false, resolve: false };   // progress-driven demo beats
    pump();
    return Promise.resolve({ batch_id: Mock.batch.id, group: 'C', group_path: MOCK_GROUP_PATH });
  },
  resolve: (uid, decision) => {
    const rec = Mock.staged.get(uid);
    if (!rec) return Promise.reject(new Error('unknown upload ' + uid));
    if (rec.status === 'consumed') return Promise.reject(new Error('that upload already became a job'));
    rec.decision = decision;
    /* engine parity: only an OPEN batch absorbs a resolved chip; after batch_end
       the decision is stored for the next /api/start */
    const open = Mock.batch && Mock.started && Mock.batch.done == null;
    if (open && decision !== 'park') {
      rec.status = 'consumed';
      const j = mMakeJob(rec, { decision: decision });
      mPubQueue();
      mPubJob(j);
      pump();
      return Promise.resolve({ ok: true, job_id: j.id, state: j.state });
    }
    mPubQueue();
    return Promise.resolve({ ok: true, stored: decision });
  },
  retry: id => {
    const j = Mock.jobs.get(id);
    const meta = j && Mock.meta.get(id);
    if (!j) return Promise.reject(new Error('unknown job'));
    if (j.state !== 'failed' && j.state !== 'parked') return Promise.reject(new Error('job is ' + j.state + ' — nothing to retry'));
    const kind = (meta.failure || {}).kind;
    if (!RETRYABLE.has(kind)) return Promise.reject(new Error('failure class ' + kind + ' is deterministic — Retry would only repeat it (needs Willie)'));
    if (meta.retries >= 3) return Promise.reject(new Error('retried 3 times — needs Willie'));
    meta.retries += 1;
    meta.failure = null;
    mStripChips(j, ['fail', 'parked']);
    mSet(j, { state: 'waiting', stage: 'queued', status_line: 'retrying from transcribe (attempt ' + meta.retries + ')', ended: null });
    if (Mock.batch && Mock.batch.done != null) Mock.batch.done = null;
    pump();
    return Promise.resolve({ ok: true, resumed_from: 'transcribe' });
  },
  cancelBatch: () => {
    const targets = [];
    Mock.jobs.forEach(j => { if (j.state === 'waiting' || j.state === 'active') targets.push(j); });
    Mock.paused = null;
    targets.forEach(mCancelJob);
    mPubBatch();
    mCheckDone();
    return Promise.resolve({ ok: true, cancelled: targets.length });
  },
  cancelJob: id => {
    const j = Mock.jobs.get(id);
    if (!j) return Promise.reject(new Error('unknown job'));
    if (j.state !== 'waiting' && j.state !== 'active') return Promise.reject(new Error('job is ' + j.state + ' — nothing to cancel'));
    mCancelJob(j);
    pump();
    mCheckDone();
    return Promise.resolve({ ok: true });
  },
  resume: () => {
    Mock.paused = null;
    let n = 0;
    Mock.jobs.forEach(j => {
      const meta = Mock.meta.get(j.id);
      if (j.state === 'parked' && meta && (meta.failure || {}).kind === 'limit') {
        meta.failure = null;
        mStripChips(j, ['parked']);
        mSet(j, { state: 'waiting', stage: 'queued', status_line: 'resumed after the usage-limit pause', ended: null });
        n++;
      }
    });
    mPubBatch();
    pump();
    return Promise.resolve({ ok: true, resumed: n });
  },
  reveal: p => {
    toast('Mock mode — would reveal in Finder: ' + p);
    return Promise.resolve({ ok: true });
  },
  jobDetail: id => {
    const j = Mock.jobs.get(id);
    if (!j) return Promise.reject(new Error('unknown job ' + id));
    const meta = Mock.meta.get(id) || {};
    const spec = meta.spec || {};
    const flags = [];
    if (spec.script === 'incomplete') flags.push(MOCK_FLAG_QL);
    if (spec.script === 'flags-date') { flags.push(MOCK_FLAG_QL); flags.push(MOCK_FLAG_DATE); }
    if (spec.plan === 'update' && j.rounds.transcribe > 0) flags.push(MOCK_FLAG_STEP);
    const promote = meta.promote || {};
    const detail = {
      job: mcopy(j),
      survey: meta.rec ? mcopy(meta.rec.survey) : null,
      match: meta.rec ? mcopy(meta.rec.match) : null,
      validate: mcopy(meta.validate), fidelity: mcopy(meta.fidelity),
      build: mcopy(meta.build), qa: mcopy(meta.qa), promote: mcopy(promote),
      failure: mcopy(meta.failure),
      transcript_tail: mcopy(meta.transcript || []),
      rounds: mcopy(j.rounds),
      result: mcopy(meta.result),
      spec_flags: flags,
      selfcheck: meta.selfcheck || null,
      diff: (isUpdateJob(j) && j.rounds.transcribe > 0) ? MOCK_DIFF.slice() : null,
      paths: {
        staging: '/tmp/vannessa/jobs/' + j.id,
        spec: promote.ok ? promote.spec_path : null,
        docx: promote.ok ? promote.docx_path : null,
        group: Mock.batch ? Mock.batch.group_path : null,
        staging_docx: meta.build && meta.build.ok ? meta.build.wrote : null
      }
    };
    return Promise.resolve(detail);
  }
};

const API = MOCK ? MockAPI : RealAPI;

/* -------- mock boot: interrupted-recovery demo, staggered staging, auto-start -------- */
function initMock() {
  D.mockBadge.hidden = false;
  D.mockCtl.hidden = false;
  document.title = 'Vannessa — mock';

  /* restored interrupted batch (what a real boot replay looks like) */
  Mock.batch = {
    id: 'prevbatch', group: 'B', group_path: '/Users/demo/Desktop/DrVannessa/GroupB',
    started: nowS() - 4100, done: null, counts: {}, eta_s: null, paused: null, caffeinated: false
  };
  const prevRec = name => ({
    upload_id: 'prev' + (++Mock.uid), name: name, size: 402133, ts: nowS() - 4200,
    md5: mockMd5(name), survey: mockSurvey({ name: name, size: 402133, pages: 2, ql: 'No', plan: 'prev' }),
    match: { decision: 'new', module: null, slug: null, candidates: [], reason: '' },
    decision: 'new', status: 'consumed',
    mockSpec: { script: 'clean', tdur: 6000, slug: null }
  });
  const doneJob = mMakeJob(prevRec('semaglutide tablets (Rybelsus).pdf'), { decision: 'new' });
  doneJob.module = 'content_rybelsus';
  doneJob.stage = 'done'; doneJob.state = 'ok';
  doneJob.status_line = 'filed to GroupB';
  doneJob.chips = [{ kind: 'clean', label: 'clean pass', detail: 'all QA checks passed' }];
  doneJob.started = nowS() - 4000; doneJob.ended = nowS() - 3760;
  doneJob.rounds = { transcribe: 1, buildqa: 1 };
  const dm = Mock.meta.get(doneJob.id);
  dm.promote = { ok: true, spec_path: MOCK_TOOL + '/content_rybelsus.py', docx_path: '/Users/demo/Desktop/DrVannessa/GroupB/' + mDocxName(doneJob), backup_path: null };
  dm.qa = mockQa(doneJob, [], false);
  dm.build = mockBuildOk(doneJob);
  dm.result = { subtype: 'success', is_error: false, duration_ms: 121000, num_turns: 12, total_cost_usd: 1.04 };

  const intJob = mMakeJob(prevRec('semaglutide injection (Ozempic).pdf'), { decision: 'new' });
  intJob.module = 'content_ozempic';
  intJob.stage = 'transcribe'; intJob.state = 'parked';
  intJob.status_line = 'interrupted — the server restarted mid-job';
  intJob.chips = [{ kind: 'parked', label: 'interrupted', detail: 'the server stopped while this job was in flight; Retry re-runs it' }];
  intJob.started = nowS() - 3900; intJob.ended = nowS() - 3700;
  Mock.meta.get(intJob.id).failure = { kind: 'crash', detail: 'interrupted by a server restart' };

  Mock.banners = [{
    id: 'interrupted', kind: 'interrupted',
    text: 'The last batch was interrupted — 1 finished, 1 did not. Interrupted jobs are parked with Retry in their drawer.',
    actions: ['dismiss']
  }];

  Mock.order.forEach(id => mPubJob(Mock.jobs.get(id)));
  mPubBanners();
  mPubBatch();

  /* staggered staging (incremental chips, not one blocking spinner) */
  MOCK_ROSTER.forEach((f, i) => mockAfter(700 + i * 300, () => mStage(f)));
  /* auto-start once staging settles, unless Willie already pressed Start */
  mockAfter(7500, () => {
    if (!Mock.started) {
      toast('Demo: pressing Start.');
      startBatch();
    }
  });
}

/* ---------------- boot ---------------- */
try { window.VannessaMascot && VannessaMascot.init(); } catch (err) { /* decoration only */ }
if (MOCK) {
  initMock();
  mascotLive = true;
} else {
  connectSSE();
}
renderAll(false);

})();
