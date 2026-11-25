import { useEffect, useState } from "react";

/** "Add to Home Screen" support. Chrome/Edge/Samsung fire beforeinstallprompt; iPhone needs Share → Add to Home Screen. */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const ping = () => listeners.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; ping(); });
  window.addEventListener("appinstalled", () => { deferred = null; ping(); });
}

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    iosHint: !deferred && isIos() && !isStandalone(),
    install: async () => { if (!deferred) return false; const d = deferred; await d.prompt(); const r = await d.userChoice; deferred = null; ping(); return r.outcome === "accepted"; },
  };
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}
