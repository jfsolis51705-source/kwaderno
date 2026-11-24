/** Camera barcode scanning with the BarcodeDetector API (Chrome/Edge/Android). Callers fall back to typing/scanner input. */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor { new (opts?: { formats?: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> }

export const hasBarcodeDetector = () => typeof window !== "undefined" && "BarcodeDetector" in window;

const WANTED = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  const supported = (await Ctor.getSupportedFormats?.()) ?? WANTED;
  const detector = new Ctor({ formats: WANTED.filter((f) => supported.includes(f)) });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  video.srcObject = stream;
  await video.play();
  let stopped = false, last = "", lastAt = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(video);
      const v = codes[0]?.rawValue;
      // ignore the same code for 1.5 s so one scan = one tap
      if (v && (v !== last || Date.now() - lastAt > 1500)) { last = v; lastAt = Date.now(); onCode(v); }
    } catch { /* frame not ready */ }
    setTimeout(tick, 250);
  };
  tick();
  return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
