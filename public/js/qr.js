// QR codes are drawn on the device with the vendored qrcode-generator library,
// so no third party sees the coupon.

export function qrSvg(text, { cellSize = 6, margin = 2 } = {}) {
  if (typeof window.qrcode !== 'function') return '<p class="muted">QR code library did not load.</p>';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cellSize;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${(c + margin) * cellSize} ${(r + margin) * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code">
    <rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
