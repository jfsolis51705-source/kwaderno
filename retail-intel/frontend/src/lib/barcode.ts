/**
 * Live camera scanning for barcodes AND QR codes, like a QR scanner app: the camera stays open and any code inside the
 * box is read by itself — no button to press. Uses the phone's built-in detector when it has one (Chrome/Android) and
 * the bundled ZXing reader everywhere else (iPhone Safari, Firefox, desktop). Callers fall back to typing or a
 * USB/Bluetooth scanner when there is no camera.
 */
interface DetectedBarcode { rawValue: string; format?: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor { new (opts?: { formats?: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> }

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const AUTO_KEY = "ri-autoscan";

export const hasBarcodeDetector = () => typeof window !== "undefined" && "BarcodeDetector" in window;
export const hasCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Like a QR scanner app the camera opens by itself, unless camera access was refused or the person switched it off. */
export async function shouldAutoStart(): Promise<boolean> {
  try { if (localStorage.getItem(AUTO_KEY) === "0") return false; } catch { /* private mode */ }
  try { const st = await navigator.permissions?.query({ name: "camera" as PermissionName }); if (st?.state === "denied") return false; } catch { /* not supported */ }
  return true;
}
/** Remember that the person switched the camera off (or back on). */
export function rememberCamera(on: boolean) { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* private mode */ } }

/** EAN-13 / EAN-8 / UPC-A check digit, so a misread is never used. Other formats carry their own checks. */
export function checkDigitOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,13}$/.test(code)) return true;
  const d = code.padStart(code.length === 8 ? 8 : 13, "0").split("").map(Number), last = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === last;
}

let audio: AudioContext | null = null;
/** Supermarket-style beep and a short vibration when a code is read. */
export function beep() {
  try { navigator.vibrate?.(40); } catch { /* no vibration */ }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio = audio ?? new AC();
    if (audio.state === "suspended") void audio.resume();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = "square"; o.frequency.value = 2400;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.005); g.gain.setValueAtTime(0.08, t + 0.095); g.gain.linearRampToValueAtTime(0, t + 0.11);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.13);
  } catch { /* no audio */ }
}

type Reader = { decode: (c: HTMLCanvasElement) => { text: string; retail: boolean } | null };
async function zxingReader(): Promise<Reader> {
  const ZX = await import("@zxing/library");
  const hints = new Map<number, unknown>();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E,
    ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.ITF, ZX.BarcodeFormat.QR_CODE]);
  const reader = new ZX.MultiFormatReader(); reader.setHints(hints);
  return {
    decode: (c) => {
      for (const Bin of [ZX.HybridBinarizer, ZX.GlobalHistogramBinarizer]) {
        try {
          const r = reader.decode(new ZX.BinaryBitmap(new Bin(new ZX.HTMLCanvasElementLuminanceSource(c))));
          const f = r.getBarcodeFormat();
          return { text: r.getText(), retail: [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E].includes(f) };
        }
        catch { /* nothing in this frame */ } finally { reader.reset(); }
      }
      return null;
    },
  };
}

/**
 * Opens the back camera in `video` and calls onCode for every code read inside `frame` (the on-screen box), or the
 * middle of the picture when no frame is given. Keeps scanning until the returned stop() is called; the same code is
 * ignored for 1.5 s so one scan counts once.
 */
export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void, frame?: HTMLElement | null): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  video.srcObject = stream; video.muted = true; video.setAttribute("playsinline", "");
  await video.play().catch(() => undefined);
  let native: BarcodeDetectorLike | null = null;
  if (hasBarcodeDetector()) {
    try {
      const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
      const supported = (await Ctor.getSupportedFormats?.()) ?? NATIVE_FORMATS;
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length) native = new Ctor({ formats });
    } catch { native = null; }
  }
  let zx: Reader | null = null;
  const zxP = zxingReader().then((r) => { zx = r; }).catch(() => undefined);
  const c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true })!;
  let stopped = false, busy = false, timer = 0, last = "", lastAt = 0;
  const crop = () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    let sx = vw * 0.1, sy = vh * 0.22, sw = vw * 0.8, sh = vh * 0.56;
    if (frame) { // map the box on screen to the camera picture (the video is shown with object-fit: cover)
      const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      const sc = Math.max(vr.width / vw, vr.height / vh), ox = (vr.width - vw * sc) / 2, oy = (vr.height - vh * sc) / 2;
      sx = Math.max(0, (fr.left - vr.left - ox) / sc - 20); sy = Math.max(0, (fr.top - vr.top - oy) / sc - 20);
      sw = Math.min(vw - sx, fr.width / sc + 40); sh = Math.min(vh - sy, fr.height / sc + 40);
    }
    const k = Math.min(2, 1100 / sw); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    g.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return true;
  };
  const tick = async () => {
    if (stopped) return;
    if (!busy && crop()) {
      busy = true;
      try {
        let v: string | null = null;
        // the check digit only applies to retail product barcodes (EAN/UPC); store labels and QR codes are taken as read
        const retail = (f?: string) => !!f && /^(ean_|upc_)/.test(f);
        if (native) { try { v = (await native.detect(c)).filter((x) => x.rawValue.trim() && (!retail(x.format) || checkDigitOk(x.rawValue.trim())))[0]?.rawValue.trim() ?? null; } catch { native = null; } }
        if (!v && zx) { const r = zx.decode(c); const t = r?.text.trim(); if (t && (!r!.retail || checkDigitOk(t))) v = t; }
        if (v && (v !== last || Date.now() - lastAt > 1500)) { last = v; lastAt = Date.now(); beep(); onCode(v); }
      } finally { busy = false; }
    }
    timer = window.setTimeout(tick, 200);
  };
  void zxP;
  tick();
  return () => { stopped = true; window.clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
