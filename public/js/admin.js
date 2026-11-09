// Venue dashboard: venues and their QR posters, the question bank, results
// and notifications.

import { qrSvg } from './qr.js';

const panel = document.getElementById('panel');
const toastEl = document.getElementById('toast');
let me = null;
let venues = [];
let currentTab = 'venues';
let selectedVenueId = null;

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (res.status === 401) {
    showLogin();
    throw new Error('Please sign in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLogin() {
  document.getElementById('login-card').hidden = false;
  document.getElementById('app').hidden = true;
  document.getElementById('logout').hidden = true;
}

async function showApp() {
  document.getElementById('login-card').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('logout').hidden = false;
  await loadVenues();
  renderTab();
}

async function loadVenues() {
  venues = (await api('/api/admin/venues')).venues;
  if (!selectedVenueId && venues.length) selectedVenueId = venues[0].id;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.hidden = true;
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: document.getElementById('password').value } });
    me = await api('/api/admin/me');
    await showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

document.querySelectorAll('[role=tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
    renderTab();
  });
});

function venueSelector(onChange) {
  const sel = document.createElement('select');
  sel.className = 'input';
  sel.style.maxWidth = '320px';
  sel.innerHTML = venues.map((v) => `<option value="${v.id}" ${v.id === selectedVenueId ? 'selected' : ''}>${esc(v.name)} (${esc(v.type)})</option>`).join('');
  sel.addEventListener('change', () => {
    selectedVenueId = Number(sel.value);
    onChange();
  });
  return sel;
}

function renderTab() {
  if (currentTab === 'venues') renderVenues();
  else if (currentTab === 'questions') renderQuestions();
  else if (currentTab === 'results') renderResults();
  else renderNotify();
}

// Venues -------------------------------------------------------------------

function venueForm(v = {}) {
  const types = me.venueTypes.map((t) => `<option value="${t}" ${v.type === t ? 'selected' : ''}>${t}</option>`).join('');
  return `
    <form class="stack venue-form" data-id="${v.id || ''}">
      <div class="grid-2">
        <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(v.name || '')}"></label>
        <label class="field"><span>Web address slug</span><input class="input" name="slug" value="${esc(v.slug || '')}" placeholder="made from the name if empty"></label>
        <label class="field"><span>Venue type (chooses the question templates)</span><select class="input" name="type">${types}</select></label>
        <label class="field"><span>Reward</span><input class="input" name="reward" required value="${esc(v.reward || '')}" placeholder="e.g. A free cup of tea"></label>
        <label class="field"><span>Latitude</span><input class="input" name="lat" inputmode="decimal" value="${v.lat ?? ''}" placeholder="optional"></label>
        <label class="field"><span>Longitude</span><input class="input" name="lng" inputmode="decimal" value="${v.lng ?? ''}" placeholder="optional"></label>
        <label class="field"><span>Presence radius (m)</span><input class="input" name="radiusM" inputmode="numeric" value="${v.radiusM ?? 75}"></label>
        <label class="field"><span>Staff PIN ${v.id ? '(leave empty to keep)' : ''}</span><input class="input" name="staffPin" inputmode="numeric" autocomplete="off" ${v.id ? '' : 'required'}></label>
      </div>
      <label class="field"><span>Reward terms shown to customers</span><input class="input" name="rewardTerms" value="${esc(v.rewardTerms || '')}" placeholder="e.g. Show the code at the counter. One reward per survey."></label>
      <label class="check"><input type="checkbox" name="active" ${v.active === false ? '' : 'checked'}><span>Active (taking feedback)</span></label>
      <div class="row">
        <button class="btn btn-primary" type="submit">${v.id ? 'Save changes' : 'Add venue'}</button>
        ${v.id ? '<button class="btn" type="button" data-action="poster">QR poster</button><button class="btn btn-ghost" type="button" data-action="delete">Remove</button>' : ''}
      </div>
    </form>`;
}

function renderVenues() {
  panel.innerHTML = `
    <div class="card">
      <h2>Venues</h2>
      <table class="table">
        <thead><tr><th>Venue</th><th>Type</th><th>Reward</th><th>Started</th><th>Finished</th><th>Redeemed</th><th>Subscribers</th><th>Link</th></tr></thead>
        <tbody>${venues
          .map(
            (v) => `<tr>
              <td><strong>${esc(v.name)}</strong>${v.active ? '' : ' <span class="badge">inactive</span>'}</td>
              <td>${esc(v.type)}</td><td>${esc(v.reward)}</td><td>${v.sessions}</td><td>${v.finished}</td><td>${v.redeemed}</td><td>${v.subscribers}</td>
              <td><a href="${esc(v.url)}" target="_blank" rel="noopener">/v/${esc(v.slug)}</a></td></tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Edit a venue</h2><div id="venue-edit"></div></div>
      <div class="card"><h2>Add a venue</h2>${venueForm()}</div>
    </div>
    <div id="poster"></div>`;
  const editBox = document.getElementById('venue-edit');
  const sel = venueSelector(() => drawEdit());
  const drawEdit = () => {
    const v = venues.find((x) => x.id === selectedVenueId);
    editBox.innerHTML = '';
    editBox.append(sel);
    if (v) editBox.insertAdjacentHTML('beforeend', venueForm(v));
    bindVenueForms();
  };
  drawEdit();
  bindVenueForms();
}

function bindVenueForms() {
  panel.querySelectorAll('.venue-form').forEach((form) => {
    if (form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = {
        name: f.get('name'), slug: f.get('slug'), type: f.get('type'), reward: f.get('reward'), rewardTerms: f.get('rewardTerms'),
        lat: f.get('lat') || null, lng: f.get('lng') || null, radiusM: f.get('radiusM') || null, staffPin: f.get('staffPin') || '', active: f.get('active') === 'on'
      };
      try {
        const id = form.dataset.id;
        if (id) await api(`/api/admin/venues/${id}`, { method: 'PUT', body });
        else {
          const r = await api('/api/admin/venues', { method: 'POST', body });
          selectedVenueId = r.id;
        }
        toast('Venue saved');
        await loadVenues();
        renderVenues();
      } catch (err) {
        toast(err.message);
      }
    });
    form.querySelector('[data-action=delete]')?.addEventListener('click', async () => {
      if (!confirm('Remove this venue? Venues with responses are deactivated instead of deleted.')) return;
      try {
        await api(`/api/admin/venues/${form.dataset.id}`, { method: 'DELETE' });
        selectedVenueId = null;
        await loadVenues();
        renderVenues();
      } catch (err) {
        toast(err.message);
      }
    });
    form.querySelector('[data-action=poster]')?.addEventListener('click', () => {
      const v = venues.find((x) => x.id === Number(form.dataset.id));
      document.getElementById('poster').innerHTML = `
        <div class="card poster">
          <p class="no-print"><button class="btn" id="print-poster" type="button">Print this poster</button></p>
          <h1 style="font-size:2rem">Waiting in the queue?</h1>
          <p style="font-size:1.3rem">Scan the code, answer a few quick questions and get <strong>${esc(v.reward)}</strong>.</p>
          <div class="qr">${qrSvg(`${v.url}?src=qr`, { cellSize: 8, margin: 2 })}</div>
          <p class="muted" style="margin-top:12px">${esc(v.url)}</p>
          <p class="muted small">Write the same address to an NFC tag so a tap works too. ${esc(v.name)}, powered by CrowdFeed.</p>
        </div>`;
      document.getElementById('print-poster').addEventListener('click', () => window.print());
      document.getElementById('poster').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// Questions ----------------------------------------------------------------

function questionForm(q = {}, venue) {
  const widgets = me.widgets.map((w) => `<option value="${w}" ${q.widget === w ? 'selected' : ''}>${w}</option>`).join('');
  const scopeVenue = q.venueId != null || !q.id;
  return `
    <form class="stack question-form" data-id="${q.id || ''}">
      <label class="field"><span>Question text</span><input class="input" name="text" required value="${esc(q.text || '')}"></label>
      <div class="grid-2">
        <label class="field"><span>Key (used by follow-up rules)</span><input class="input" name="key" required value="${esc(q.key || '')}" placeholder="e.g. taste"></label>
        <label class="field"><span>Answer type</span><select class="input" name="widget">${widgets}</select></label>
        <label class="field"><span>Priority (higher is asked earlier)</span><input class="input" name="priority" inputmode="numeric" value="${q.priority ?? 50}"></label>
        <label class="field"><span>Scope</span><select class="input" name="scope">
          <option value="venue" ${scopeVenue ? 'selected' : ''}>Only ${esc(venue.name)}</option>
          <option value="type" ${!scopeVenue ? 'selected' : ''}>Template for all "${esc(venue.type)}" venues</option></select></label>
      </div>
      <label class="field"><span>Options, one per line (for radio, segmented and rank)</span><textarea name="options" rows="3">${esc((q.options || []).join('\n'))}</textarea></label>
      <label class="field"><span>Conditions (JSON, optional)</span><textarea name="conditions" rows="3" placeholder='{"gender":["woman"],"timeOfDay":["morning"],"requires":[{"key":"taste","op":"<=","value":2}]}'>${q.conditions && Object.keys(q.conditions).length ? esc(JSON.stringify(q.conditions)) : ''}</textarea></label>
      <div class="row">
        <label class="check" style="margin:0"><input type="checkbox" name="required" ${q.required ? 'checked' : ''}><span>Required (cannot be skipped)</span></label>
        <label class="check" style="margin:0"><input type="checkbox" name="active" ${q.active === false ? '' : 'checked'}><span>Active</span></label>
      </div>
      <div class="row">
        <button class="btn btn-primary" type="submit">${q.id ? 'Save question' : 'Add question'}</button>
        ${q.id ? '<button class="btn btn-ghost" type="button" data-action="delete">Remove</button>' : '<button class="btn btn-ghost" type="button" data-action="cancel">Clear</button>'}
      </div>
    </form>`;
}

async function renderQuestions() {
  const venue = venues.find((v) => v.id === selectedVenueId);
  if (!venue) {
    panel.innerHTML = '<div class="card"><p>Add a venue first.</p></div>';
    return;
  }
  panel.innerHTML = '<div class="card"><div class="spinner"></div></div>';
  const { questions } = await api(`/api/admin/questions?venueId=${venue.id}`);
  panel.innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Questions for <span id="qv-name">${esc(venue.name)}</span></h2><div id="qv-select"></div></div>
      <p class="muted small">Template questions apply to every venue of the type "${esc(venue.type)}". A venue question with the same key replaces the template for this venue. Follow-up rules in "conditions" decide when a question becomes eligible; the engine then picks by priority, varies the answer type and balances exposure.</p>
      <table class="table">
        <thead><tr><th>Priority</th><th>Key</th><th>Question</th><th>Type</th><th>Conditions</th><th>Scope</th><th>Asked</th><th></th></tr></thead>
        <tbody>${questions
          .map(
            (q) => `<tr ${q.active ? '' : 'style="opacity:.5"'}>
              <td>${q.priority}</td><td><code>${esc(q.key)}</code>${q.required ? ' <span class="badge">required</span>' : ''}</td>
              <td class="q-text">${esc(q.text)}${q.options.length ? `<br><span class="muted small">${esc(q.options.join(' | '))}</span>` : ''}</td>
              <td>${q.widget}</td><td class="q-cond small">${Object.keys(q.conditions).length ? esc(JSON.stringify(q.conditions)) : ''}</td>
              <td>${q.venueId ? 'venue' : 'template'}</td><td>${q.askedCount}</td>
              <td><button class="btn btn-ghost" data-edit="${q.id}" type="button">Edit</button></td></tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
    <div class="card"><h2 id="qform-title">Add a question</h2><div id="qform">${questionForm({}, venue)}</div></div>`;
  document.getElementById('qv-select').append(venueSelector(renderQuestions));
  const bindForm = () => {
    const form = panel.querySelector('.question-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = {
        text: f.get('text'), key: f.get('key'), widget: f.get('widget'), priority: f.get('priority'),
        options: String(f.get('options') || '').split('\n').map((s) => s.trim()).filter(Boolean),
        conditions: String(f.get('conditions') || '').trim(), required: f.get('required') === 'on', active: f.get('active') === 'on'
      };
      if (f.get('scope') === 'venue') body.venueId = venue.id;
      else body.venueType = venue.type;
      try {
        if (form.dataset.id) await api(`/api/admin/questions/${form.dataset.id}`, { method: 'PUT', body });
        else await api('/api/admin/questions', { method: 'POST', body });
        toast('Question saved');
        renderQuestions();
      } catch (err) {
        toast(err.message);
      }
    });
    form.querySelector('[data-action=delete]')?.addEventListener('click', async () => {
      if (!confirm('Remove this question? Questions that already have answers are deactivated instead.')) return;
      try {
        await api(`/api/admin/questions/${form.dataset.id}`, { method: 'DELETE' });
        renderQuestions();
      } catch (err) {
        toast(err.message);
      }
    });
    form.querySelector('[data-action=cancel]')?.addEventListener('click', () => {
      document.getElementById('qform').innerHTML = questionForm({}, venue);
      bindForm();
    });
  };
  bindForm();
  panel.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = questions.find((x) => x.id === Number(btn.dataset.edit));
      document.getElementById('qform-title').textContent = `Edit question "${q.key}"`;
      document.getElementById('qform').innerHTML = questionForm(q, venue);
      bindForm();
      document.getElementById('qform').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// Results ------------------------------------------------------------------

function bars(items, { max } = {}) {
  const top = max || Math.max(1, ...items.map((i) => i.count));
  return `<div class="bars">${items
    .map((i) => `<div class="bar"><span>${esc(i.label)}</span><div class="track"><div class="fill" style="width:${Math.round((i.count / top) * 100)}%"></div></div><span class="n">${i.count}</span></div>`)
    .join('')}</div>`;
}

function breakdownBars(obj) {
  const items = Object.entries(obj).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  return items.length ? bars(items) : '<p class="muted small">No data yet</p>';
}

async function renderResults() {
  const venue = venues.find((v) => v.id === selectedVenueId);
  if (!venue) {
    panel.innerHTML = '<div class="card"><p>Add a venue first.</p></div>';
    return;
  }
  panel.innerHTML = '<div class="card"><div class="spinner"></div></div>';
  const s = await api(`/api/admin/venues/${venue.id}/stats`);
  const t = s.totals;
  panel.innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Results for ${esc(s.venue.name)}</h2><div class="row"><div id="rv-select"></div><a class="btn" href="/api/admin/venues/${venue.id}/export.csv">Download CSV</a></div></div>
      <div class="grid-3" style="margin-top:14px">
        <div class="kpi"><div class="n">${t.started}</div><div class="l">surveys started</div></div>
        <div class="kpi"><div class="n">${t.finished}</div><div class="l">finished${t.completionRate != null ? ` (${t.completionRate}%)` : ''}</div></div>
        <div class="kpi"><div class="n">${t.medianDurationSeconds != null ? `${Math.floor(t.medianDurationSeconds / 60)}:${String(t.medianDurationSeconds % 60).padStart(2, '0')}` : '0:00'}</div><div class="l">median time to finish (m:ss)</div></div>
        <div class="kpi"><div class="n">${t.answers}</div><div class="l">answers given</div></div>
        <div class="kpi"><div class="n">${t.couponsIssued}</div><div class="l">rewards issued</div></div>
        <div class="kpi"><div class="n">${t.couponsRedeemed}</div><div class="l">rewards collected</div></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Where people answered from</h3>${breakdownBars(s.breakdown.presence)}</div>
      <div class="card"><h3>How they arrived</h3>${breakdownBars(s.breakdown.source)}</div>
      <div class="card"><h3>Time of day</h3>${breakdownBars(s.breakdown.timeOfDay)}</div>
      <div class="card"><h3>Device and connection</h3>${breakdownBars(s.breakdown.device)}<div style="height:10px"></div>${breakdownBars(s.breakdown.connection)}</div>
      <div class="card"><h3>Age band</h3>${breakdownBars(s.breakdown.ageBand)}</div>
      <div class="card"><h3>Gender</h3>${breakdownBars(s.breakdown.gender)}</div>
    </div>
    <div class="card"><h2>Answers by question</h2>
      ${s.questions.length ? '' : '<p class="muted">No answers yet.</p>'}
      ${s.questions
        .map(
          (q) => `<div style="padding:12px 0;border-top:1px solid var(--line)">
            <div class="row between"><strong>${esc(q.text)}</strong><span class="muted small">${q.answered} answered, ${q.skipped} skipped${q.medianSeconds != null ? `, median ${q.medianSeconds}s` : ''}${q.mean != null ? `, mean ${q.mean}` : ''}</span></div>
            ${q.distribution ? bars(q.distribution) : ''}
            ${q.note ? `<p class="muted small">${esc(q.note)}</p>` : ''}
            ${q.texts ? `<ul class="small" style="margin:6px 0 0 18px">${q.texts.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
          </div>`
        )
        .join('')}
    </div>`;
  document.getElementById('rv-select').append(venueSelector(renderResults));
}

// Notify -------------------------------------------------------------------

function renderNotify() {
  const venue = venues.find((v) => v.id === selectedVenueId);
  if (!venue) {
    panel.innerHTML = '<div class="card"><p>Add a venue first.</p></div>';
    return;
  }
  panel.innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Invite subscribers at ${esc(venue.name)}</h2><div id="nv-select"></div></div>
      <p class="muted small">${venue.subscribers} phone${venue.subscribers === 1 ? '' : 's'} opted in at this venue. ${me.pushEnabled ? '' : 'Push is not configured on the server yet (set the VAPID keys).'}</p>
      <form id="push-form" class="stack" style="max-width:520px">
        <label class="field"><span>Title</span><input class="input" name="title" maxlength="60" required value="${esc(venue.reward)} for your feedback"></label>
        <label class="field"><span>Message</span><input class="input" name="body" maxlength="160" required value="In the queue at ${esc(venue.name)}? Answer five quick questions now and collect your reward at the counter."></label>
        <button class="btn btn-primary" type="submit" ${me.pushEnabled ? '' : 'disabled'}>Send to subscribers</button>
      </form>
      <div id="push-result" style="margin-top:12px"></div>
    </div>`;
  document.getElementById('nv-select').append(venueSelector(renderNotify));
  document.getElementById('push-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api(`/api/admin/venues/${venue.id}/push`, { method: 'POST', body: { title: f.get('title'), body: f.get('body') } });
      document.getElementById('push-result').innerHTML = `<p class="notice ok">Sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}${r.removed ? `, ${r.removed} expired subscription${r.removed === 1 ? '' : 's'} removed` : ''}${r.failed ? `, ${r.failed} failed` : ''}.</p>`;
    } catch (err) {
      document.getElementById('push-result').innerHTML = `<p class="notice danger">${esc(err.message)}</p>`;
    }
  });
}

// Boot: try an existing session cookie first.
api('/api/admin/me')
  .then((data) => {
    me = data;
    return showApp();
  })
  .catch(() => showLogin());
