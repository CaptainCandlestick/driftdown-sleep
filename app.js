'use strict';

/* ============================================================
   DriftDown — binaural-beat sleep sound player
   Pure Web Audio API. No build step, no dependencies.
   ============================================================ */

const STORAGE_KEY = 'driftdown_assessment_v1';

/* ---------- Protocols ----------
   breakpoints: [secondsFromStart, beatFrequencyHz] — the beat glides
   linearly between points, then holds the last value.
   phaseLabels: [secondsFromStart, label] — just for the on-screen text.
------------------------------------------------------------------ */
const PROTOCOLS = {
  quick: {
    key: 'quick',
    name: 'Quick Wind-Down',
    blurb: '~20 min. Alpha easing into theta — for settling a busy mind before sleep.',
    duration: 20 * 60,
    carrierDefault: 210,
    fadeInSec: 12,
    fadeOutSec: 90,
    breakpoints: [[0, 10], [300, 6]],
    phaseLabels: [[0, 'Settling in — relaxed alpha'], [300, 'Easing toward theta'], [1110, 'Winding down']],
  },
  deep: {
    key: 'deep',
    name: 'Deep Sleep Onset',
    blurb: '~45 min. Full alpha → theta → delta glide, timed to natural sleep onset.',
    duration: 45 * 60,
    carrierDefault: 180,
    fadeInSec: 15,
    fadeOutSec: 300,
    breakpoints: [[0, 8], [180, 6], [900, 4], [1800, 2.5]],
    phaseLabels: [
      [0, 'Settling in — alpha/theta'],
      [180, 'Theta — drifting'],
      [900, 'Theta–delta border'],
      [1800, 'Delta — deep sleep rhythm'],
      [2400, 'Fading out soon'],
    ],
  },
  allnight: {
    key: 'allnight',
    name: 'All Night',
    blurb: 'Up to 8 hrs. Steady low-volume delta rhythm to help you stay asleep.',
    duration: 8 * 60 * 60,
    carrierDefault: 150,
    fadeInSec: 15,
    fadeOutSec: 0,
    breakpoints: [[0, 6], [600, 4], [1800, 2.5]],
    phaseLabels: [
      [0, 'Settling in — theta'],
      [600, 'Theta–delta border'],
      [1800, 'Delta — steady through the night'],
    ],
  },
};

/* ---------- Small DOM helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const screens = {};
document.querySelectorAll('.screen').forEach((el) => (screens[el.id] = el));
function showScreen(id) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[id].classList.add('active');
}

/* ---------- Assessment ---------- */
function loadAssessment() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveAssessment(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function recommendFrom(answers) {
  let protocolKey = answers.q3 === '20' ? 'quick' : answers.q3 === '45' ? 'deep' : 'allnight';
  if (answers.q1 === 'staying' && answers.q3 !== '20') protocolKey = 'allnight';

  const notes = [];
  if (answers.q1 === 'staying') {
    notes.push('Since staying asleep is the bigger issue, All Night keeps a steady low-volume rhythm going for up to 8 hours instead of stopping partway through.');
  } else if (answers.q1 === 'falling') {
    notes.push('Since falling asleep is the main struggle, the glide from alpha into theta/delta over the first 30 minutes is the important part — try not to skip ahead.');
  }
  if (answers.q2 === 'racing') {
    notes.push('Racing thoughts respond well to a noise bed underneath the tones, so brown noise is on by default.');
  }
  return { protocolKey, note: notes.join(' ') };
}

/* ---------- Audio Engine ---------- */
class BinauralEngine {
  constructor() {
    this.ctx = null;
    this.nodes = null;
    this.running = false;
    this.startedAt = 0;
    this.protocol = null;
    this.autoStopTimer = null;
  }

  _createBrownNoiseBuffer(ctx, seconds = 40) {
    const rate = ctx.sampleRate;
    const length = Math.floor(seconds * rate);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const fadeLen = Math.floor(rate * 0.05);
      for (let i = 0; i < fadeLen; i++) {
        const g = i / fadeLen;
        data[i] *= g;
        data[length - 1 - i] *= g;
      }
    }
    return buffer;
  }

  async start({ protocol, carrierHz, toneVolume, noiseVolume, useNoise }) {
    if (this.running) await this.stop(0.05);

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    // Note: don't await this — WebKit has a long-standing bug where this
    // promise sometimes never resolves even though resume actually succeeds,
    // which would otherwise hang the whole session start indefinitely.
    ctx.resume().catch(() => {});

    const oscLeft = ctx.createOscillator();
    const oscRight = ctx.createOscillator();
    oscLeft.type = 'sine';
    oscRight.type = 'sine';

    const merger = ctx.createChannelMerger(2);
    oscLeft.connect(merger, 0, 0);
    oscRight.connect(merger, 0, 1);

    const toneGain = ctx.createGain();
    toneGain.gain.value = toneVolume;
    merger.connect(toneGain);

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = useNoise ? noiseVolume : 0;
    let noiseSource = null;
    if (useNoise) {
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this._createBrownNoiseBuffer(ctx, 40);
      noiseSource.loop = true;
      noiseSource.connect(noiseGain);
    }

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;
    toneGain.connect(masterGain);
    noiseGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Schedule the beat glide.
    const now = ctx.currentTime;
    protocol.breakpoints.forEach(([t, beat], i) => {
      const left = carrierHz - beat / 2;
      const right = carrierHz + beat / 2;
      const at = now + t;
      if (i === 0) {
        oscLeft.frequency.setValueAtTime(left, at);
        oscRight.frequency.setValueAtTime(right, at);
      } else {
        oscLeft.frequency.linearRampToValueAtTime(left, at);
        oscRight.frequency.linearRampToValueAtTime(right, at);
      }
    });

    // Fade in.
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(1, now + protocol.fadeInSec);

    // Scheduled fade-out (only for protocols with a fixed end).
    if (protocol.fadeOutSec > 0) {
      const fadeStart = now + protocol.duration - protocol.fadeOutSec;
      masterGain.gain.setValueAtTime(1, fadeStart);
      masterGain.gain.linearRampToValueAtTime(0.0001, fadeStart + protocol.fadeOutSec);
    }

    oscLeft.start(now);
    oscRight.start(now);
    if (noiseSource) noiseSource.start(now);

    this.ctx = ctx;
    this.nodes = { oscLeft, oscRight, merger, toneGain, noiseGain, noiseSource, masterGain };
    this.running = true;
    this.startedAt = Date.now();
    this.protocol = protocol;
    this.carrierHz = carrierHz;

    if (protocol.duration && protocol.duration < Infinity) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = setTimeout(() => {
        this.teardown();
        window.dispatchEvent(new CustomEvent('driftdown:ended'));
      }, protocol.duration * 1000 + 300);
    }
  }

  setToneVolume(v) {
    if (!this.nodes) return;
    const now = this.ctx.currentTime;
    this.nodes.toneGain.gain.setTargetAtTime(v, now, 0.1);
  }

  setNoiseVolume(v) {
    if (!this.nodes) return;
    const now = this.ctx.currentTime;
    this.nodes.noiseGain.gain.setTargetAtTime(v, now, 0.1);
  }

  elapsedSeconds() {
    if (!this.running) return 0;
    return (Date.now() - this.startedAt) / 1000;
  }

  currentPhaseLabel() {
    if (!this.protocol) return '';
    const t = this.elapsedSeconds();
    let label = this.protocol.phaseLabels[0][1];
    for (const [pt, text] of this.protocol.phaseLabels) {
      if (t >= pt) label = text;
    }
    return label;
  }

  // Ground-truth check: this mirrors the exact same breakpoint math used to
  // schedule the oscillators in start(), so it reflects what SHOULD be
  // audible right now, not just a guess — useful for confirming the tone
  // matches the intended protocol via an external tone/spectrum analyzer.
  currentFrequencies() {
    if (!this.protocol || this.carrierHz == null) return null;
    const t = this.elapsedSeconds();
    const bp = this.protocol.breakpoints;
    let beat = bp[0][1];
    for (let i = 0; i < bp.length; i++) {
      const [pt, pb] = bp[i];
      if (t <= pt) {
        if (i === 0) { beat = pb; break; }
        const [prevT, prevB] = bp[i - 1];
        const frac = (t - prevT) / (pt - prevT);
        beat = prevB + (pb - prevB) * frac;
        break;
      }
      beat = pb; // past this point; holds if it's the last one
    }
    return {
      left: this.carrierHz - beat / 2,
      right: this.carrierHz + beat / 2,
      beat,
    };
  }

  async stop(fadeSeconds = 8) {
    clearTimeout(this.autoStopTimer);
    if (!this.running || !this.ctx) return;
    const { masterGain } = this.nodes;
    const now = this.ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
    await new Promise((r) => setTimeout(r, fadeSeconds * 1000 + 150));
    this.teardown();
  }

  teardown() {
    if (this.nodes) {
      try {
        this.nodes.oscLeft.stop();
        this.nodes.oscRight.stop();
        if (this.nodes.noiseSource) this.nodes.noiseSource.stop();
      } catch {}
    }
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.nodes = null;
    this.running = false;
    this.protocol = null;
  }
}

const engine = new BinauralEngine();

/* ---------- Wiring: Intro ---------- */
$('#btn-intro-continue').addEventListener('click', () => {
  const saved = loadAssessment();
  if (saved) {
    renderHome(saved);
    showScreen('screen-home');
  } else {
    showScreen('screen-assessment');
  }
});
$('#btn-show-science').addEventListener('click', () => showScreen('screen-science'));
$('#btn-science-back').addEventListener('click', () => showScreen('screen-intro'));

/* ---------- Wiring: Assessment ---------- */
$('#assessment-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const answers = {
    q1: fd.get('q1'),
    q2: fd.get('q2'),
    q3: fd.get('q3'),
    q4: fd.get('q4'),
  };
  saveAssessment(answers);
  renderHome(answers);
  showScreen('screen-home');
});
$('#btn-skip-assessment').addEventListener('click', () => {
  const defaults = { q1: 'falling', q2: 'tired-wired', q3: '45', q4: 'brown' };
  renderHome(defaults, { skipped: true });
  showScreen('screen-home');
});
$('#btn-retake-assessment').addEventListener('click', () => showScreen('screen-assessment'));

/* ---------- Wiring: Home / protocol picker ---------- */
let currentAnswers = null;

function renderHome(answers, opts = {}) {
  currentAnswers = answers;
  const rec = recommendFrom(answers);
  $('#recommendation-note').textContent = opts.skipped
    ? 'Pick whichever session fits tonight.'
    : rec.note || 'Pick whichever session fits tonight.';

  const list = $('#protocol-list');
  list.innerHTML = '';
  Object.values(PROTOCOLS).forEach((p) => {
    const div = document.createElement('div');
    div.className = 'protocol-card' + (p.key === rec.protocolKey ? ' recommended' : '');
    div.innerHTML = `
      <h3>${p.name} ${p.key === rec.protocolKey ? '<span class="badge">Recommended</span>' : ''}</h3>
      <p>${p.blurb}</p>
      <button class="btn btn-primary" data-protocol="${p.key}">Start</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('button[data-protocol]').forEach((btn) => {
    btn.addEventListener('click', () => startSession(btn.dataset.protocol));
  });
}

$('#btn-toggle-advanced').addEventListener('click', () => {
  $('#advanced-panel').classList.toggle('hidden');
});
$('#carrier-range').addEventListener('input', (e) => {
  $('#carrier-value').textContent = e.target.value;
});

/* ---------- Wake Lock: keep the screen from auto-locking mid-session ---------- */
let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}
async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch {}
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.running && !wakeLock) {
    acquireWakeLock();
  }
});

/* ---------- Wiring: Player ---------- */
let uiTimer = null;

async function startSession(protocolKey) {
  const protocol = PROTOCOLS[protocolKey];
  const carrierHz = parseInt($('#carrier-range').value, 10) || protocol.carrierDefault;
  const useNoise = currentAnswers ? currentAnswers.q4 !== 'none' : true;
  const toneVolume = parseInt($('#tone-volume').value, 10) / 100;
  const noiseVolume = parseInt($('#noise-volume').value, 10) / 100;

  showScreen('screen-player');
  $('#phase-label').textContent = 'Preparing…';
  $('#timer-display').textContent = '00:00';
  $('#timer-total-label').textContent =
    protocol.duration >= 3600 ? `Up to ${Math.round(protocol.duration / 3600)}h` : `${Math.round(protocol.duration / 60)} min session`;

  try {
    await engine.start({ protocol, carrierHz, toneVolume, noiseVolume, useNoise });
  } catch (err) {
    console.error('DriftDown: failed to start audio engine', err);
    $('#phase-label').textContent = `Couldn't start audio (${err && err.message ? err.message : 'unknown error'}). Tap Stop and try again.`;
    return;
  }
  acquireWakeLock(); // best-effort, don't block the UI on it

  clearInterval(uiTimer);
  uiTimer = setInterval(updatePlayerUI, 500);
  updatePlayerUI();
}

function updatePlayerUI() {
  const elapsed = engine.elapsedSeconds();
  const total = engine.protocol ? engine.protocol.duration : 0;
  const remaining = Math.max(0, total - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  $('#timer-display').textContent = `${mm}:${ss}`;
  $('#phase-label').textContent = engine.currentPhaseLabel();

  const freqs = engine.currentFrequencies();
  $('#freq-readout').textContent = freqs
    ? `Left ${freqs.left.toFixed(1)} Hz · Right ${freqs.right.toFixed(1)} Hz · Beat ${freqs.beat.toFixed(2)} Hz`
    : '';
}

$('#tone-volume').addEventListener('input', (e) => engine.setToneVolume(e.target.value / 100));
$('#noise-volume').addEventListener('input', (e) => engine.setNoiseVolume(e.target.value / 100));

$('#btn-stop-session').addEventListener('click', async () => {
  clearInterval(uiTimer);
  $('#phase-label').textContent = 'Fading out…';
  await engine.stop(6);
  await releaseWakeLock();
  showScreen('screen-home');
});

window.addEventListener('driftdown:ended', () => {
  clearInterval(uiTimer);
  releaseWakeLock();
  showScreen('screen-home');
});

/* ---------- PWA: service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
