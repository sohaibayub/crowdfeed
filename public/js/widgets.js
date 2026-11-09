// The nine answer widgets. Each renderer returns an element plus getValue()
// and isComplete(); it calls onChange whenever the value changes so the Next
// button can be enabled.

import { face, star, thumbUp, thumbDown, arrowUp, arrowDown } from './icons.js';

function el(tag, attrs = {}, html = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (html) node.innerHTML = html;
  return node;
}

const SMILEY_LABELS = ['Very unhappy', 'Unhappy', 'Neutral', 'Happy', 'Very happy'];

function radioLike(question, onChange, segmented) {
  const name = `q${question.id}`;
  const wrap = el('div', { class: segmented ? 'segmented' : 'choices', role: 'radiogroup', 'aria-labelledby': 'question-title' });
  let value = null;
  question.options.forEach((opt, i) => {
    const id = `${name}-${i}`;
    const label = el('label', { class: 'choice' });
    const input = el('input', { type: 'radio', name, id, value: opt });
    input.addEventListener('change', () => {
      value = opt;
      onChange();
    });
    label.append(input, el('span', { text: opt }));
    wrap.append(label);
  });
  return { el: wrap, getValue: () => value, isComplete: () => value != null };
}

function scale(question, onChange, kind) {
  const wrap = el('div');
  const group = el('div', { class: `scale ${kind}`, role: 'group', 'aria-labelledby': 'question-title' });
  const valueOut = el('div', { class: 'scale-value', 'aria-live': 'polite' });
  let value = null;
  const buttons = [];
  for (let i = 1; i <= 5; i++) {
    const label = kind === 'stars' ? `${i} star${i > 1 ? 's' : ''}` : SMILEY_LABELS[i - 1];
    const btn = el('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': label, title: label });
    btn.innerHTML = kind === 'stars' ? star : face((i - 1) / 4);
    btn.addEventListener('click', () => {
      value = i;
      buttons.forEach((b, idx) => {
        b.setAttribute('aria-pressed', idx + 1 === i ? 'true' : 'false');
        b.classList.toggle('lit', kind === 'stars' && idx + 1 <= i);
      });
      valueOut.textContent = label;
      onChange();
    });
    buttons.push(btn);
    group.append(btn);
  }
  wrap.append(group);
  if (kind === 'smileys') wrap.append(el('div', { class: 'scale-labels' }, '<span>Very unhappy</span><span>Very happy</span>'));
  wrap.append(valueOut);
  return { el: wrap, getValue: () => value, isComplete: () => value != null };
}

function slider(question, onChange) {
  const wrap = el('div', { class: 'slider-wrap' });
  const out = el('div', { class: 'scale-value', 'aria-live': 'polite' }, 'Slide to choose');
  const input = el('input', { type: 'range', min: 0, max: 10, step: 1, value: 5, 'aria-labelledby': 'question-title', 'aria-valuetext': 'not set' });
  let touched = false;
  input.addEventListener('input', () => {
    touched = true;
    out.textContent = `${input.value} out of 10`;
    input.setAttribute('aria-valuetext', `${input.value} out of 10`);
    onChange();
  });
  wrap.append(input, el('div', { class: 'scale-labels' }, '<span>0 Poor</span><span>10 Excellent</span>'), out);
  return { el: wrap, getValue: () => (touched ? Number(input.value) : null), isComplete: () => touched };
}

function smileySlider(question, onChange) {
  const wrap = el('div', { class: 'slider-wrap' });
  const faceBox = el('div', { class: 'face-big' }, face(0.5, 120));
  const out = el('div', { class: 'scale-value', 'aria-live': 'polite' }, 'Slide to choose');
  const input = el('input', { type: 'range', min: 0, max: 100, step: 1, value: 50, 'aria-labelledby': 'question-title', 'aria-valuetext': 'not set' });
  let touched = false;
  const wordFor = (v) => SMILEY_LABELS[Math.min(4, Math.floor(v / 20.0001))];
  input.addEventListener('input', () => {
    touched = true;
    faceBox.innerHTML = face(Number(input.value) / 100, 120);
    out.textContent = wordFor(Number(input.value));
    input.setAttribute('aria-valuetext', out.textContent);
    onChange();
  });
  wrap.append(faceBox, input, el('div', { class: 'scale-labels' }, '<span>Very unhappy</span><span>Very happy</span>'), out);
  return { el: wrap, getValue: () => (touched ? Number(input.value) : null), isComplete: () => touched };
}

function thumbs(question, onChange) {
  const wrap = el('div', { class: 'thumbs', role: 'group', 'aria-labelledby': 'question-title' });
  let value = null;
  const make = (val, label, icon) => {
    const btn = el('button', { type: 'button', 'aria-pressed': 'false' });
    btn.innerHTML = `${icon}<span>${label}</span>`;
    btn.addEventListener('click', () => {
      value = val;
      wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      onChange();
    });
    return btn;
  };
  wrap.append(make('up', 'Yes', thumbUp), make('down', 'No', thumbDown));
  return { el: wrap, getValue: () => value, isComplete: () => value != null };
}

function rank(question, onChange) {
  const order = [...question.options];
  const list = el('ol', { class: 'rank-list', 'aria-labelledby': 'question-title' });
  const status = el('div', { class: 'visually-hidden', 'aria-live': 'polite' });
  let touched = false;
  const render = () => {
    list.innerHTML = '';
    order.forEach((opt, i) => {
      const item = el('li', { class: 'rank-item' });
      const up = el('button', { type: 'button', 'aria-label': `Move ${opt} up`, disabled: i === 0 }, arrowUp);
      const down = el('button', { type: 'button', 'aria-label': `Move ${opt} down`, disabled: i === order.length - 1 }, arrowDown);
      up.addEventListener('click', () => move(i, i - 1, up));
      down.addEventListener('click', () => move(i, i + 1, down));
      item.append(el('span', { class: 'pos', text: String(i + 1), 'aria-hidden': 'true' }), el('span', { class: 'label', text: opt }), up, down);
      list.append(item);
    });
  };
  const move = (from, to, source) => {
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    touched = true;
    render();
    status.textContent = `${item} is now number ${to + 1}`;
    const btn = list.querySelectorAll('.rank-item')[to].querySelector(source.getAttribute('aria-label').includes('up') ? 'button:first-of-type' : 'button:last-of-type');
    (btn.disabled ? btn.parentElement.querySelector('button:not([disabled])') : btn)?.focus();
    onChange();
  };
  render();
  const wrap = el('div');
  wrap.append(el('p', { class: 'muted small', text: 'Use the arrows to put your first choice at the top. You can also keep the order as it is.' }), list, status);
  return { el: wrap, getValue: () => order, isComplete: () => true, touched: () => touched };
}

function text(question, onChange) {
  const wrap = el('div');
  const area = el('textarea', { maxlength: 500, placeholder: 'Type your answer', 'aria-labelledby': 'question-title' });
  const counter = el('div', { class: 'counter', 'aria-live': 'off' }, '0 / 500');
  area.addEventListener('input', () => {
    counter.textContent = `${area.value.length} / 500`;
    onChange();
  });
  wrap.append(area, counter);
  return { el: wrap, getValue: () => area.value.trim(), isComplete: () => area.value.trim().length > 0, focus: () => area.focus() };
}

export function renderWidget(question, onChange) {
  switch (question.widget) {
    case 'radio':
      return radioLike(question, onChange, false);
    case 'segmented':
      return radioLike(question, onChange, true);
    case 'stars':
      return scale(question, onChange, 'stars');
    case 'smileys':
      return scale(question, onChange, 'smileys');
    case 'slider':
      return slider(question, onChange);
    case 'smileyslider':
      return smileySlider(question, onChange);
    case 'thumbs':
      return thumbs(question, onChange);
    case 'rank':
      return rank(question, onChange);
    case 'text':
      return text(question, onChange);
    default: {
      const fallback = el('p', { class: 'notice danger', text: 'This question type is not supported by this version of the app.' });
      return { el: fallback, getValue: () => null, isComplete: () => false };
    }
  }
}
