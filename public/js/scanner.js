// Camera QR scanning. Uses the browser's BarcodeDetector when it exists and
// falls back to the vendored jsQR decoder on a canvas.

let jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrLoading) {
    jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsqr.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => reject(new Error('Could not load the QR decoder'));
      document.head.append(s);
    });
  }
  return jsqrLoading;
}

export async function startScanner(video, onResult, onError) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    onError(new Error('This browser cannot access the camera. Use your camera app to scan the code instead.'));
    return () => {};
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (err) {
    onError(new Error(err.name === 'NotAllowedError' ? 'Camera permission was refused. You can allow it in the browser settings or scan the code with your camera app.' : 'The camera could not be started.'));
    return () => {};
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play().catch(() => {});

  let stopped = false;
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      detector = null;
    }
  }
  let jsQR = null;
  if (!detector) {
    try {
      jsQR = await loadJsQR();
    } catch (err) {
      onError(err);
    }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      try {
        let text = null;
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else if (jsQR) {
          const w = Math.min(640, video.videoWidth || 640);
          const h = Math.round(w * ((video.videoHeight || 480) / (video.videoWidth || 640)));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (code && code.data) text = code.data;
        }
        if (text) {
          stop();
          onResult(text);
          return;
        }
      } catch {
        // ignore a bad frame and keep going
      }
    }
    setTimeout(tick, detector ? 150 : 250);
  };
  const stop = () => {
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  tick();
  return stop;
}
