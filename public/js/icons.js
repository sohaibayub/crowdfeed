// Inline SVG used by the widgets. Faces are drawn from a few parameters so the
// smiley slider can morph between them.

export function face(mood, size = 34) {
  // mood runs from 0 (very unhappy) to 1 (very happy)
  const m = Math.max(0, Math.min(1, mood));
  const curve = (m - 0.5) * 28; // mouth curvature
  const mouthY = 40;
  const browTilt = (0.5 - m) * 6;
  const eyeR = 3.2 + m * 0.8;
  return `
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="3.5"/>
      <circle cx="22" cy="26" r="${eyeR}" fill="currentColor"/>
      <circle cx="42" cy="26" r="${eyeR}" fill="currentColor"/>
      <path d="M16 ${18 + browTilt} l10 ${-browTilt * 1.2}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="${m < 0.35 ? 1 : 0}"/>
      <path d="M48 ${18 + browTilt} l-10 ${-browTilt * 1.2}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="${m < 0.35 ? 1 : 0}"/>
      <path d="M20 ${mouthY - curve / 2} Q32 ${mouthY + curve} 44 ${mouthY - curve / 2}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`;
}

export const star = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2.5l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-6 3.2 1.3-6.6L2.4 9.4l6.7-.8z" fill="currentColor"/>
  </svg>`;

export const thumbUp = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 21H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3m0 10V11m0 10h9.3a2 2 0 0 0 2-1.6l1.4-7A2 2 0 0 0 19.7 10H14V5.5A2.5 2.5 0 0 0 11.5 3L7 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

export const thumbDown = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M17 3h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3m0-10v10m0-10H7.7a2 2 0 0 0-2 1.6l-1.4 7A2 2 0 0 0 6.3 14H12v4.5a2.5 2.5 0 0 0 2.5 2.5L17 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

export const camera = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;

export const pin = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;

export const bell = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

export const arrowUp = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5m-6 6l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const arrowDown = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14m-6-6l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
