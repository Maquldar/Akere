export type GeoFix = { lat: number; lng: number; accuracyM: number };
export type GeoError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

/** One-shot browser geolocation with a typed error. */
export function getPosition(timeoutMs = 12_000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject('unsupported' satisfies GeoError);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) }),
      (err) => reject((err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable') satisfies GeoError),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function isGeoError(e: unknown): e is GeoError {
  return e === 'denied' || e === 'unavailable' || e === 'timeout' || e === 'unsupported';
}

/** Grabs a square JPEG frame from a playing <video>, mirrored like the preview. */
export function captureFrame(video: HTMLVideoElement, size = 640): Promise<File> {
  return new Promise((resolve, reject) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      reject(new Error('no-frame'));
      return;
    }
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    const out = Math.min(size, side);
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('no-canvas'));
      return;
    }
    ctx.translate(out, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], 'selfie.jpg', { type: 'image/jpeg' })) : reject(new Error('no-blob'))),
      'image/jpeg',
      0.85,
    );
  });
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}
