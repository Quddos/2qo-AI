// Camera / microphone capture and image compression.

export async function compressImage(file, max = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { blob, w, h };
}

export async function smallAvatar(file) {
  const { blob } = await compressImage(file, 256, 0.75);
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

function pickMime(kind) {
  const opts = kind === 'video' ? ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return opts.find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) || '';
}

/**
 * Start recording. Returns { stream, stop(): Promise<{blob, duration, mime}>, cancel() }.
 * kind: 'audio' | 'video'
 */
export async function startRecording(kind = 'audio', { facingMode = 'environment', maxSeconds = 0, onTick } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording is not supported on this device');
  const constraints = kind === 'video' ? { audio: true, video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } } } : { audio: { echoCancellation: true, noiseSuppression: true } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const mime = pickMime(kind);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 600000, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  const started = Date.now();
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  let tick = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    onTick?.(s);
    if (maxSeconds && s >= maxSeconds) api.stop();
  }, 250);
  let done;
  const finished = new Promise((r) => (done = r));
  rec.onstop = () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType || mime || (kind === 'video' ? 'video/webm' : 'audio/webm') });
    done({ blob, duration: Math.round((Date.now() - started) / 1000), mime: blob.type });
  };
  const api = {
    stream,
    kind,
    stop() {
      if (rec.state !== 'inactive') rec.stop();
      return finished;
    },
    cancel() {
      clearInterval(tick);
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
    finished,
  };
  return api;
}

export function fmtDuration(s) {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/** Grab a still frame from the camera (used by the AI "look" command). */
export async function snapshot(facingMode = 'environment') {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
  const v = document.createElement('video');
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  await v.play();
  await new Promise((r) => setTimeout(r, 400));
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  stream.getTracks().forEach((t) => t.stop());
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}
