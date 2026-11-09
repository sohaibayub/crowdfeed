// CrowdFeed participant app: a small client-side router with views for the
// venue entry page, the survey, the reward and the saved rewards.

import { api, getConfig } from './api.js';
import { store } from './store.js';
import { renderWidget } from './widgets.js';
import { qrSvg } from './qr.js';
import { startScanner } from './scanner.js';
import { initPwa, canInstall, onInstallAvailable, promptInstall, isStandalone, isIos, pushSupport, subscribeToVenue } from './pwa.js';
import { camera, pin, bell } from './icons.js';

const main = document.getElementById('main');
const toastEl = document.getElementById('toast');
let toastTimer = null;
let activeScannerStop = null;

function toast(message, ms = 3200) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function render(html) {
  if (activeScannerStop) {
    activeScannerStop();
    activeScannerStop = null;
  }
  main.innerHTML = html;
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', route);

function deviceType() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile ? 'mobile' : /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop';
  }
  if (/iPad|Tablet|PlayBook|Silk/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(navigator.userAgent)) return 'mobile';
  return 'desktop';
}

async function collectContext(wantLocation) {
  const now = new Date();
  const conn = navigator.connection || {};
  const ctx = {
    localHour: now.getHours(),
    weekday: now.getDay(),
    device: deviceType(),
    connection: conn.effectiveType || 'unknown',
    saveData: Boolean(conn.saveData),
    displayMode: isStandalone() ? 'standalone' : 'browser',
    language: navigator.language || 'unknown',
    viewport: `${window.innerWidth}x${window.innerHeight}`
  };
  if (wantLocation && 'geolocation' in navigator) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 })
      );
      ctx.lat = pos.coords.latitude;
      ctx.lng = pos.coords.longitude;
      ctx.accuracy = pos.coords.accuracy;
    } catch (err) {
      if (err && err.code === 1) ctx.locationDenied = true;
    }
  } else if (wantLocation) {
    ctx.locationDenied = true;
  }
  return ctx;
}

function logEvent(type, venue, detail) {
  api('/api/events', { method: 'POST', body: { type, venue, detail } }).catch(() => {});
}

// Home ---------------------------------------------------------------------

function homeView() {
  const session = store.getSession();
  const rewards = store.getRewards();
  const newRewards = rewards.filter((r) => r.status === 'new').length;
  render(`
    <section class="card hero">
      <h1>Waiting in a queue?</h1>
      <p class="lead">Answer a few quick questions about this place while you wait and pick up a reward at the counter.</p>
      ${session ? `
        <div class="notice">
          <strong>You have an unfinished survey at ${esc(session.venueName)}.</strong>
          <div class="row" style="margin-top:8px">
            <a class="btn btn-primary" href="/v/${esc(session.venueSlug)}?src=resume" data-link>Continue</a>
            <button class="btn btn-ghost" id="discard-session" type="button">Discard</button>
          </div>
        </div>` : ''}
      <div class="stack">
        <button class="btn btn-primary btn-lg btn-block" id="scan-btn" type="button">${camera} Scan the code at the queue</button>
        <button class="btn btn-lg btn-block" id="nearby-btn" type="button">${pin} Find places near me</button>
        ${newRewards ? `<a class="btn btn-block" href="/rewards" data-link>${bell} You have ${newRewards} reward${newRewards > 1 ? 's' : ''} to collect</a>` : ''}
      </div>
    </section>
    <section id="scanner-area"></section>
    <section id="nearby-area"></section>
    <section class="card">
      <h2>How it works</h2>
      <ol class="stack" style="padding-left:20px;margin:0">
        <li>Scan the CrowdFeed code or tap the NFC tag where you are queueing.</li>
        <li>Answer at least five short questions. The questions adapt to the place, the time and your earlier answers.</li>
        <li>Show the QR code you receive at the counter to get the reward. You can save it and use it later.</li>
      </ol>
    </section>
    <section class="card" id="install-card" hidden>
      <h2>Keep CrowdFeed on your phone</h2>
      <p class="muted">Add it to your home screen to reach your rewards offline and get told when a venue near you is offering one.</p>
      <button class="btn btn-block" id="install-btn" type="button">Add to home screen</button>
    </section>
  `);

  const discard = document.getElementById('discard-session');
  if (discard) {
    discard.addEventListener('click', () => {
      store.clearSession();
      homeView();
    });
  }
  document.getElementById('scan-btn').addEventListener('click', openScanner);
  document.getElementById('nearby-btn').addEventListener('click', showNearby);

  const installCard = document.getElementById('install-card');
  const showInstall = () => {
    installCard.hidden = !(canInstall() || (isIos() && !isStandalone()));
  };
  showInstall();
  onInstallAvailable(showInstall);
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (canInstall()) {
      const ok = await promptInstall();
      if (ok) toast('CrowdFeed was added to your home screen');
    } else {
      toast('Tap the Share button in Safari, then "Add to Home Screen"', 5000);
    }
  });

  if (new URLSearchParams(location.search).get('scan') === '1') openScanner();
}

async function openScanner() {
  const area = document.getElementById('scanner-area');
  if (!area) return;
  area.innerHTML = `
    <div class="card">
      <div class="row between">
        <h2 style="margin:0">Point the camera at the code</h2>
        <button class="btn btn-ghost" id="scan-close" type="button">Close</button>
      </div>
      <div class="scanner" style="margin-top:12px"><video muted playsinline></video><div class="frame"></div></div>
      <p class="muted small" id="scan-status" style="margin-top:10px">Looking for a CrowdFeed code.</p>
    </div>`;
  const video = area.querySelector('video');
  const status = document.getElementById('scan-status');
  const close = () => {
    if (activeScannerStop) activeScannerStop();
    activeScannerStop = null;
    area.innerHTML = '';
  };
  document.getElementById('scan-close').addEventListener('click', close);
  activeScannerStop = await startScanner(
    video,
    (text) => {
      const target = resolveScannedText(text);
      if (target) {
        close();
        navigate(target);
      } else {
        status.textContent = 'That code is not a CrowdFeed code. Try the one at the queue.';
        setTimeout(() => openScanner(), 1200);
      }
    },
    (err) => {
      status.textContent = err.message;
      status.classList.add('notice', 'warn');
    }
  );
}

function resolveScannedText(text) {
  try {
    const url = new URL(text);
    if (url.origin === location.origin && /^\/(v|r)\//.test(url.pathname)) return url.pathname + (url.pathname.startsWith('/v/') ? '?src=qr' : '');
  } catch {
    // not a URL
  }
  if (/^[0-9A-Za-z]{10}-[0-9A-Za-z]{8}$/.test(text.trim())) return `/r/${text.trim().toUpperCase()}`;
  return null;
}

async function showNearby() {
  const area = document.getElementById('nearby-area');
  area.innerHTML = '<div class="card"><div class="spinner" role="status" aria-label="Finding your location"></div></div>';
  const ctx = await collectContext(true);
  if (ctx.lat == null) {
    area.innerHTML = `<div class="card"><p class="notice warn">${ctx.locationDenied ? 'Location permission was not given, so nearby places cannot be listed. You can still scan the code at the queue.' : 'Your location could not be found. You can still scan the code at the queue.'}</p></div>`;
    return;
  }
  try {
    const data = await api(`/api/venues/nearby?lat=${ctx.lat}&lng=${ctx.lng}&within=1000`);
    if (!data.venues.length) {
      area.innerHTML = '<div class="card"><p class="muted">No CrowdFeed venues within a kilometre of you.</p></div>';
      return;
    }
    area.innerHTML = `<div class="card"><h2>Places near you</h2><ul class="venue-list">${data.venues
      .map((v) => `<li><a href="/v/${esc(v.slug)}?src=nearby" data-link><span><strong>${esc(v.name)}</strong><br><span class="muted small">${esc(v.reward)}</span></span><span class="badge">${v.distanceM} m</span></a></li>`)
      .join('')}</ul></div>`;
  } catch (err) {
    area.innerHTML = `<div class="card"><p class="notice danger">${esc(err.message)}</p></div>`;
  }
}

// Venue entry and survey ---------------------------------------------------

const AGE_LABELS = { '18-24': '18 to 24', '25-34': '25 to 34', '35-44': '35 to 44', '45-54': '45 to 54', '55+': '55 and over', undisclosed: 'Prefer not to say' };
const GENDER_LABELS = { woman: 'Woman', man: 'Man', 'non-binary': 'Non-binary', undisclosed: 'Prefer not to say' };
const VISIT_LABELS = { first: 'First time here', occasional: 'Now and then', regular: 'Regularly' };

function chips(name, values, labels, checked) {
  return `<div class="chips" role="radiogroup" aria-label="${esc(name)}">${values
    .map((v) => `<label class="chip"><input type="radio" name="${esc(name)}" value="${esc(v)}" ${v === checked ? 'checked' : ''}><span>${esc(labels[v] || v)}</span></label>`)
    .join('')}</div>`;
}

async function venueView(slug, params) {
  const source = params.get('src') || 'link';
  render('<div class="card"><div class="spinner" role="status" aria-label="Loading"></div></div>');
  let venue;
  try {
    venue = (await api(`/api/venues/${encodeURIComponent(slug)}`)).venue;
  } catch (err) {
    render(`<section class="card center"><h1>Not available</h1><p>${esc(err.message)}</p><a class="btn btn-primary" href="/" data-link>Back to start</a></section>`);
    return;
  }
  if (source === 'push') logEvent('push_clicked', slug);
  else logEvent('opened', slug, { source });

  // Resume an unfinished survey at this venue if there is one.
  const saved = store.getSession();
  if (saved && saved.venueSlug === slug) {
    try {
      const state = await api(`/api/sessions/${saved.id}`, { token: saved.token });
      if (state.status === 'active' && state.question) {
        logEvent('resumed', slug);
        surveyView({ sessionId: saved.id, token: saved.token, venue: state.venue, question: state.question, progress: state.progress, canFinish: state.canFinish, presence: state.presence }, true);
        return;
      }
      if (state.status === 'finished' && state.coupon) {
        store.clearSession();
        store.saveReward(state.coupon);
        rewardView(state.coupon, state.venue);
        return;
      }
      store.clearSession();
    } catch {
      store.clearSession();
    }
  }

  const cfg = await getConfig();
  render(`
    <section class="card">
      <span class="badge">${esc(venue.type)}</span>
      <h1 style="margin-top:8px">${esc(venue.name)}</h1>
      <p class="lead">Answer at least ${cfg.survey.min} quick questions and get <strong>${esc(venue.reward)}</strong>.</p>
      ${venue.rewardTerms ? `<p class="muted small">${esc(venue.rewardTerms)}</p>` : ''}
      <form id="start-form" novalidate>
        <h2>A little about you</h2>
        <p class="muted small">Optional. It helps the venue understand who is answering. Nothing here identifies you.</p>
        <div class="field"><span>Age</span>${chips('ageBand', cfg.profile.ageBands || [], AGE_LABELS, 'undisclosed')}</div>
        <div class="field"><span>Gender</span>${chips('gender', cfg.profile.genders || [], GENDER_LABELS, 'undisclosed')}</div>
        <div class="field"><span>How often do you come here?</span>${chips('visits', cfg.profile.visits || [], VISIT_LABELS, 'occasional')}</div>
        ${venue.hasLocation ? `
        <label class="check"><input type="checkbox" name="location" checked>
          <span>Share my location once so the venue can tell the feedback came from inside the premises. Only the distance to the venue is kept.</span></label>` : ''}
        <label class="check"><input type="checkbox" name="adult" required><span>I am 18 or over.</span></label>
        <label class="check"><input type="checkbox" name="consent" required>
          <span>I agree to take part. My answers are stored without my name and used to improve this place. <a href="/privacy" data-link>Privacy notice</a>.</span></label>
        <p class="notice danger" id="start-error" hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Start the questions</button>
      </form>
    </section>
  `);

  document.getElementById('start-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorBox = document.getElementById('start-error');
    errorBox.hidden = true;
    if (!form.adult.checked || !form.consent.checked) {
      errorBox.textContent = 'Please confirm you are 18 or over and agree to take part.';
      errorBox.hidden = false;
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Starting';
    const wantLocation = form.location ? form.location.checked : false;
    const context = await collectContext(wantLocation);
    try {
      const data = await api('/api/sessions', {
        method: 'POST',
        body: {
          venue: slug,
          source: ['qr', 'nfc', 'link', 'push', 'nearby', 'resume'].includes(source) ? source : 'link',
          consent: true,
          adult: true,
          profile: { ageBand: form.ageBand.value, gender: form.gender.value, visits: form.visits.value },
          context
        }
      });
      store.setSession({ id: data.sessionId, token: data.token, venueSlug: slug, venueName: venue.name, startedAt: Date.now() });
      surveyView(data, false);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Start the questions';
    }
  });
}

function presenceNote(presence) {
  if (presence === 'verified') return '<span class="badge ok">Location confirmed</span>';
  if (presence === 'outside') return '<span class="badge warn">Outside the venue</span>';
  return '';
}

function surveyView(state, resumed) {
  let { sessionId, token, venue, question, progress, canFinish } = state;
  const auth = { token };
  let shownAt = Date.now();

  const draw = () => {
    if (!question) {
      finishPrompt();
      return;
    }
    const pct = Math.min(100, Math.round((progress.answered / progress.min) * 100));
    render(`
      <section class="card question">
        <div class="row between small muted">
          <span>${esc(venue.name)} ${presenceNote(state.presence)}</span>
          <span>${progress.answered} of ${progress.min} answered${progress.answered >= progress.min ? `, up to ${progress.max}` : ''}</span>
        </div>
        <div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div>
        ${resumed ? '<p class="notice ok">Welcome back. Your earlier answers were kept.</p>' : ''}
        <h2 id="question-title" tabindex="-1">${esc(question.text)}</h2>
        <div id="widget"></div>
        <p class="notice danger" id="answer-error" hidden></p>
        <div class="actions">
          ${question.required ? '' : '<button class="btn" id="skip-btn" type="button">Skip</button>'}
          <button class="btn btn-primary" id="next-btn" type="button" disabled>Next</button>
        </div>
        ${canFinish ? '<button class="btn btn-accent btn-block" id="finish-btn" type="button" style="margin-top:10px">Finish and get my reward</button>' : `<p class="muted small center" style="text-align:center;margin-top:12px">${progress.min - progress.answered} more answer${progress.min - progress.answered === 1 ? '' : 's'} to unlock the reward</p>`}
      </section>
    `);
    resumed = false;
    const nextBtn = document.getElementById('next-btn');
    const widget = renderWidget(question, () => {
      nextBtn.disabled = !widget.isComplete();
    });
    document.getElementById('widget').append(widget.el);
    nextBtn.disabled = !widget.isComplete();
    shownAt = Date.now();
    document.getElementById('question-title').focus({ preventScroll: true });

    nextBtn.addEventListener('click', () => submit({ value: widget.getValue() }));
    const skip = document.getElementById('skip-btn');
    if (skip) skip.addEventListener('click', () => submit({ skip: true }));
    const finish = document.getElementById('finish-btn');
    if (finish) finish.addEventListener('click', finishSurvey);
  };

  const submit = async (payload) => {
    const errorBox = document.getElementById('answer-error');
    const buttons = main.querySelectorAll('.actions button, #finish-btn');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const res = await api(`/api/sessions/${sessionId}/answers`, { method: 'POST', body: { questionId: question.id, elapsedMs: Date.now() - shownAt, ...payload }, ...auth });
      question = res.question;
      progress = res.progress;
      canFinish = res.canFinish;
      draw();
    } catch (err) {
      if (err.status === 409 || err.status === 404) {
        store.clearSession();
        render(`<section class="card center"><h1>This survey has ended</h1><p>${esc(err.message)}</p><a class="btn btn-primary" href="/v/${esc(venue.slug)}" data-link>Start again</a></section>`);
        return;
      }
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  };

  const finishPrompt = () => {
    render(`
      <section class="card center">
        <h1>That is all our questions</h1>
        <p class="lead">Thank you. Tap below to get your reward.</p>
        <p class="notice danger" id="answer-error" hidden></p>
        <button class="btn btn-accent btn-lg btn-block" id="finish-btn" type="button">Get my reward</button>
      </section>`);
    document.getElementById('finish-btn').addEventListener('click', finishSurvey);
  };

  const finishSurvey = async () => {
    const btn = document.getElementById('finish-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing your reward';
    }
    try {
      const res = await api(`/api/sessions/${sessionId}/finish`, { method: 'POST', ...auth });
      store.clearSession();
      store.saveReward(res.coupon);
      rewardView(res.coupon, venue);
    } catch (err) {
      const errorBox = document.getElementById('answer-error');
      if (errorBox) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Finish and get my reward';
      }
    }
  };

  draw();
}

function couponCard(coupon, { compact = false } = {}) {
  const used = coupon.status === 'used';
  const expired = coupon.status === 'expired';
  const expires = coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return `
    <div class="coupon ${used ? 'used' : ''}">
      <div class="reward">${esc(coupon.reward)}</div>
      <p class="muted">${esc(coupon.venue)}</p>
      <div class="qr">${qrSvg(coupon.url)}</div>
      <div class="code" aria-label="Coupon code">${esc(coupon.display)}</div>
      ${used ? '<span class="badge">Used</span>' : expired ? '<span class="badge danger">Expired</span>' : `<span class="badge ok">Valid until ${esc(expires)}</span>`}
      ${!compact && coupon.rewardTerms ? `<p class="muted small" style="margin-top:10px">${esc(coupon.rewardTerms)}</p>` : ''}
    </div>`;
}

async function rewardView(coupon, venue) {
  render(`
    <section class="card">
      <h1 style="text-align:center">Thank you</h1>
      <p class="lead" style="text-align:center">Show this code at the counter. It is saved under My rewards, so you can also use it on another day.</p>
      ${couponCard(coupon)}
      <div class="stack" style="margin-top:16px">
        <div id="push-card"></div>
        <a class="btn btn-block" href="/rewards" data-link>My rewards</a>
        <a class="btn btn-ghost btn-block" href="/" data-link>Done</a>
      </div>
    </section>
  `);
  const pushCard = document.getElementById('push-card');
  const support = await pushSupport();
  const already = store.getPushVenues()[coupon.venueSlug];
  if (support.supported && !already) {
    pushCard.innerHTML = `<div class="notice"><strong>Hear about the next reward at ${esc(venue.name)}?</strong><p class="small muted" style="margin:6px 0 10px">The venue can send you one notification when a new reward survey opens. You can turn it off any time in your browser settings.</p><button class="btn btn-block" id="push-btn" type="button">${bell} Notify me</button></div>`;
    document.getElementById('push-btn').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await subscribeToVenue(coupon.venueSlug);
        pushCard.innerHTML = '<p class="notice ok">You will hear about the next reward here.</p>';
      } catch (err) {
        pushCard.innerHTML = `<p class="notice warn">${esc(err.message)}</p>`;
      }
    });
  } else if (!support.supported && support.reason && isIos()) {
    pushCard.innerHTML = `<p class="muted small">${esc(support.reason)}</p>`;
  }
}

// Saved rewards ------------------------------------------------------------

async function rewardsView() {
  const rewards = store.getRewards();
  if (!rewards.length) {
    render('<section class="card center"><h1>My rewards</h1><p class="muted">Rewards you earn will be kept here, even without a connection.</p><a class="btn btn-primary" href="/" data-link>Back to start</a></section>');
    return;
  }
  render(`<section class="card"><h1>My rewards</h1><p class="muted small">Tap a reward to show its code.</p><ul class="reward-list" id="reward-list"></ul></section><section id="reward-detail"></section>`);
  const list = document.getElementById('reward-list');
  const detail = document.getElementById('reward-detail');
  const drawList = () => {
    list.innerHTML = store
      .getRewards()
      .map(
        (c) => `<li data-token="${esc(c.token)}" tabindex="0" role="button" aria-label="Show ${esc(c.reward)} at ${esc(c.venue)}">
          <span><strong>${esc(c.reward)}</strong><br><span class="muted small">${esc(c.venue)}</span></span>
          <span class="badge ${c.status === 'new' ? 'ok' : c.status === 'used' ? '' : 'danger'}">${c.status === 'new' ? 'Valid' : c.status === 'used' ? 'Used' : 'Expired'}</span></li>`
      )
      .join('');
  };
  drawList();
  const show = (token) => {
    const c = store.getRewards().find((r) => r.token === token);
    if (!c) return;
    detail.innerHTML = `<section class="card">${couponCard(c)}<div class="row" style="margin-top:14px;justify-content:center"><button class="btn btn-ghost" id="remove-reward" type="button">Remove from this phone</button></div></section>`;
    document.getElementById('remove-reward').addEventListener('click', () => {
      store.removeReward(token);
      detail.innerHTML = '';
      drawList();
      if (!store.getRewards().length) rewardsView();
    });
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-token]');
    if (li) show(li.dataset.token);
  });
  list.addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-token]');
    if (li && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      show(li.dataset.token);
    }
  });
  // Refresh statuses in the background when online.
  for (const c of rewards.filter((r) => r.status === 'new').slice(0, 10)) {
    api(`/api/coupons/${encodeURIComponent(c.token)}`)
      .then((res) => {
        if (res.status && res.status !== c.status) {
          store.updateReward(c.token, { status: res.status });
          drawList();
        }
      })
      .catch(() => {});
  }
}

// Coupon page reached by scanning a reward QR ------------------------------

async function couponView(token) {
  render('<div class="card"><div class="spinner" role="status" aria-label="Checking the coupon"></div></div>');
  let res;
  try {
    res = await api(`/api/coupons/${encodeURIComponent(token)}`);
  } catch (err) {
    render(`<section class="card center"><h1>Coupon</h1><p class="notice danger">${esc(err.message)}</p></section>`);
    return;
  }
  if (res.status === 'invalid') {
    render('<section class="card center"><h1>Not a valid coupon</h1><p class="muted">This code was not issued by CrowdFeed or has been altered.</p><a class="btn" href="/" data-link>Back to start</a></section>');
    return;
  }
  const c = res.coupon;
  c.status = res.status;
  render(`
    <section class="card">
      <h1 style="text-align:center">Reward coupon</h1>
      ${couponCard(c)}
    </section>
    <section class="card no-print">
      <h2>Venue staff</h2>
      <p class="muted small">Enter the staff PIN for ${esc(c.venue)} to mark this coupon as used. Each coupon can be used once.</p>
      <form id="redeem-form" class="row">
        <input class="input" type="password" inputmode="numeric" autocomplete="one-time-code" name="pin" placeholder="Staff PIN" aria-label="Staff PIN" style="flex:1" required>
        <button class="btn btn-primary" type="submit" ${c.status !== 'new' ? 'disabled' : ''}>Redeem</button>
      </form>
      <div id="redeem-result" style="margin-top:12px"></div>
      <p class="small"><a href="/scan?venue=${esc(c.venueSlug)}">Open the staff scanner</a> to redeem coupons with the camera.</p>
    </section>
  `);
  document.getElementById('redeem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const out = document.getElementById('redeem-result');
    try {
      const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pin: form.pin.value }) });
      const data = await r.json();
      if (data.ok) {
        out.innerHTML = `<div class="result-big ok">Redeemed: ${esc(data.reward)}</div>`;
        store.updateReward(token, { status: 'used' });
        form.querySelector('button').disabled = true;
      } else {
        out.innerHTML = `<div class="result-big bad">${esc(data.message || data.error || 'Could not redeem')}</div>`;
      }
    } catch (err) {
      out.innerHTML = `<div class="result-big bad">${esc(err.message)}</div>`;
    }
  });
}

// Static pages -------------------------------------------------------------

function privacyView() {
  render(`
    <section class="card">
      <h1>Privacy notice</h1>
      <p>CrowdFeed collects feedback for the venue where you are queueing. Taking part is voluntary and you must be 18 or over.</p>
      <h2>What is stored</h2>
      <p>Your answers to the questions, the venue, the time of day, the type of device and connection you used, and the optional profile choices you make (age band, gender, how often you visit). None of this includes your name, phone number or email address.</p>
      <h2>Location</h2>
      <p>If you agree to share your location when you start, your phone sends its position once. The server keeps only whether you were inside the venue and the distance in metres, not the coordinates.</p>
      <h2>Notifications</h2>
      <p>If you ask to be notified about rewards at a venue, your browser's push subscription is stored for that venue until you withdraw it. The venue can send you a short message when a new reward survey opens. You can stop notifications in your browser or phone settings at any time.</p>
      <h2>Rewards</h2>
      <p>Reward codes are kept on your phone so you can use them later. The venue sees when a code is redeemed.</p>
      <h2>Who sees the data</h2>
      <p>The venue sees aggregated results and the individual answers for its own location. Researchers running CrowdFeed may analyse the anonymised answers to study how people give feedback while waiting. Data is kept on the server for as long as the venue uses the service and can be deleted on request to the operator.</p>
      <p><a class="btn" href="/" data-link>Back to start</a></p>
    </section>`);
}

function aboutView() {
  render(`
    <section class="card">
      <h1>About CrowdFeed</h1>
      <p>CrowdFeed turns waiting time in a queue into a short, rewarded feedback session. The venue places a QR code or an NFC tag where people wait; scanning it opens a short survey that adapts to the place, the time of day and the answers already given. On completion the app issues a signed QR coupon that staff validate once at the counter.</p>
      <p>The first version was built and studied at the Lahore University of Management Sciences in 2016 as a native Android notification app paired with a web survey. This version is a progressive web app: it installs from the browser, works offline for saved rewards, uses the device's own geolocation and camera, and receives venue notifications through Web Push, so no app store is needed.</p>
      <p>The source code is released as open source. Venues set up their questions and rewards through the dashboard at <code>/admin</code>; staff redeem coupons at <code>/scan</code>.</p>
      <p><a class="btn" href="/" data-link>Back to start</a></p>
    </section>`);
}

// Router -------------------------------------------------------------------

function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(location.search);
  let m;
  if (path === '/') return homeView();
  if ((m = path.match(/^\/v\/([^/]+)$/))) return venueView(decodeURIComponent(m[1]), params);
  if ((m = path.match(/^\/r\/([^/]+)$/))) return couponView(decodeURIComponent(m[1]));
  if (path === '/rewards') return rewardsView();
  if (path === '/privacy') return privacyView();
  if (path === '/about') return aboutView();
  render('<section class="card center"><h1>Page not found</h1><a class="btn btn-primary" href="/" data-link>Go to the start</a></section>');
}

initPwa();
route();
