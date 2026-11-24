"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, Flashlight, FlashlightOff, Keyboard, Loader2, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBarcodeWedge } from "@/hooks/use-barcode-wedge";
import { cn } from "@/lib/utils";

export interface ScanResult {
  code: string;
  format: string;
  source: "camera" | "manual" | "usb";
}

type CamState = "idle" | "starting" | "running" | "denied" | "unavailable" | "error";

/** Feedback: short beep + vibration where supported. */
function feedback() {
  try {
    navigator.vibrate?.(60);
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1700;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => ctx.close();
  } catch {
    /* feedback is best-effort */
  }
}

/**
 * Camera + manual + USB-wedge barcode input.
 * - Rear camera preferred; can switch cameras.
 * - Torch toggle when the device exposes it.
 * - Duplicate protection: the same code is ignored for `cooldownMs` after it was read.
 */
export function BarcodeScanner({
  onScan,
  cooldownMs = 2000,
  paused = false,
  autoStart = true,
  className,
}: {
  onScan: (r: ScanResult) => void;
  cooldownMs?: number;
  paused?: boolean;
  autoStart?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  useLayoutEffect(() => {
    pausedRef.current = paused;
    onScanRef.current = onScan;
  });

  const [state, setState] = useState<CamState>("idle");
  const [error, setError] = useState<string>("");
  const [torch, setTorch] = useState<boolean | null>(null); // null = unsupported
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIdx, setDeviceIdx] = useState<number | null>(null);
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);

  const emit = useCallback(
    (code: string, format: string, source: ScanResult["source"]) => {
      const c = code.trim();
      if (!c || pausedRef.current) return;
      const now = Date.now();
      if (source === "camera" && lastScan.current.code === c && now - lastScan.current.at < cooldownMs) return;
      lastScan.current = { code: c, at: now };
      feedback();
      setFlash(true);
      setTimeout(() => setFlash(false), 250);
      onScanRef.current({ code: c, format, source });
    },
    [cooldownMs],
  );

  useBarcodeWedge((code) => emit(code, "keyboard", "usb"));

  const stop = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    setTorch(null);
    setState("idle");
  }, []);

  const start = useCallback(
    async (idx: number | null = deviceIdx) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        setError("This browser cannot open the camera. Type the barcode or use a USB scanner.");
        return;
      }
      controls.current?.stop();
      setState("starting");
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        const video: MediaTrackConstraints =
          idx != null && devices[idx] ? { deviceId: { exact: devices[idx].deviceId } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };
        controls.current = await reader.decodeFromConstraints({ video, audio: false }, videoRef.current!, (result) => {
          if (result) emit(result.getText(), BarcodeFormat[result.getBarcodeFormat()], "camera");
        });
        setState("running");
        setTorch(controls.current.switchTorch ? false : null);
        // Labels are only available after permission is granted.
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
      } catch (e) {
        const name = (e as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState("denied");
          setError("Camera permission was blocked. Allow camera access in your browser settings, or type the barcode below.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setState("unavailable");
          setError("No camera found. Type the barcode below or use a USB scanner.");
        } else {
          setState("error");
          setError("Could not start the camera. Try again or type the barcode.");
        }
      }
    },
    [deviceIdx, devices, emit],
  );

  useEffect(() => {
    // Deferred so the camera starts after mount (and not twice under StrictMode).
    const t = autoStart ? setTimeout(() => start(null), 0) : undefined;
    return () => {
      clearTimeout(t);
      controls.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the camera when the tab is hidden (saves battery, frees camera on iOS).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && controls.current) stop();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stop]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black sm:aspect-video">
        <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label="Camera preview" />
        {state === "running" && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={cn("h-1/3 w-4/5 rounded-lg border-2 transition-colors", flash ? "border-success bg-success/20" : "border-white/80")}>
              <div className="bg-destructive/80 mx-2 mt-[calc(50%/3)] h-0.5 animate-pulse" />
            </div>
          </div>
        )}
        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === "starting" ? (
              <>
                <Loader2 className="size-8 animate-spin" />
                <p className="text-sm">Opening camera…</p>
              </>
            ) : (
              <>
                <CameraOff className="size-8 opacity-80" />
                <p className="max-w-xs text-sm opacity-90">{error || "Camera is off."}</p>
                {state !== "unavailable" && (
                  <Button variant="secondary" onClick={() => start()}>
                    <Camera /> {state === "idle" ? "Start camera" : "Try again"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {state === "running" && (
          <div className="absolute right-2 bottom-2 flex gap-2">
            {torch !== null && (
              <Button
                size="icon"
                variant="secondary"
                aria-label={torch ? "Turn flashlight off" : "Turn flashlight on"}
                onClick={async () => {
                  await controls.current?.switchTorch?.(!torch);
                  setTorch(!torch);
                }}
              >
                {torch ? <FlashlightOff /> : <Flashlight />}
              </Button>
            )}
            {devices.length > 1 && (
              <Button
                size="icon"
                variant="secondary"
                aria-label="Switch camera"
                onClick={() => {
                  const next = ((deviceIdx ?? 0) + 1) % devices.length;
                  setDeviceIdx(next);
                  start(next);
                }}
              >
                <SwitchCamera />
              </Button>
            )}
            <Button size="icon" variant="secondary" aria-label="Stop camera" onClick={stop}>
              <CameraOff />
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim().length >= 3) {
            emit(manual, "manual", "manual");
            setManual("");
          }
        }}
      >
        <div className="relative flex-1">
          <Keyboard className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            inputMode="numeric"
            placeholder="Type barcode or use USB scanner"
            aria-label="Barcode"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="outline" className="h-11">
          Enter
        </Button>
      </form>
    </div>
  );
}
