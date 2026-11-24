"use client";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * USB / Bluetooth barcode scanners act like a keyboard: they "type" the code very fast
 * and press Enter. This hook detects that burst (≥ 4 chars, < 50 ms apart) anywhere on
 * the page, without stealing normal typing in text fields.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled = true) {
  const buf = useRef("");
  const last = useRef(0);
  const cb = useRef(onScan);
  useLayoutEffect(() => {
    cb.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const now = performance.now();
      const fast = now - last.current < 50;
      last.current = now;
      if (e.key === "Enter") {
        if (buf.current.length >= 4) {
          const target = e.target as HTMLElement | null;
          // Ignore Enter inside a normal input unless the burst was machine-speed.
          if (!(target?.tagName === "TEXTAREA")) {
            e.preventDefault();
            cb.current(buf.current);
          }
        }
        buf.current = "";
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      buf.current = fast ? buf.current + e.key : e.key;
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
