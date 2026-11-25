import { useState } from "react";
import { copyText, isMobile, shareOrCopy, shareTargets } from "../lib/share";
import { useApp } from "../state/AppContext";

/** Share the store link on social media, with the preview picture people will see. */
export default function SharePanel({ url, storeName, cardUrl, ways }: { url: string; storeName: string; cardUrl: string; ways: string }) {
  const { toast } = useApp();
  const caption = `🛒 Pwede na kayong mag-order online sa ${storeName}! ${ways}. I-click ang link para makita ang paninda at presyo:`;
  const [text, setText] = useState(caption);
  const mobile = isMobile();
  const done = (r: string, what = "Link") => toast(r === "copied" ? `${what} copied` : r === "shared" ? "Shared" : "Couldn't copy — press and hold the link to copy it", r === "failed" ? "warn" : "ok");
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="share-panel">
      <div className="grid content-start gap-2">
        <div className="text-sm font-semibold">Ganito ang lalabas sa Facebook / Messenger</div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <img src={cardUrl} alt={`Preview card for ${storeName}`} className="aspect-[1200/630] w-full object-cover" loading="lazy" />
          <div className="px-3 py-2 text-xs text-slate-500"><div className="truncate uppercase">{new URL(url).host}</div><div className="truncate font-semibold text-slate-800">{storeName} — order online</div></div>
        </div>
      </div>
      <div className="grid content-start gap-2">
        <label className="grid gap-1 text-sm font-semibold">Caption<textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-700" data-testid="share-url">{url}</code>
          <button type="button" className="btn btn-sm" onClick={async () => done(await copyText(url))}>Copy link</button>
          <button type="button" className="btn btn-sm" onClick={async () => done(await copyText(`${text}\n${url}`), "Caption and link")}>Copy post</button></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={async () => done(await shareOrCopy(url, storeName, text))}>📤 Share…</button>
          {shareTargets(url, text).filter((t) => mobile || !t.mobileOnly).map((t) => (
            <a key={t.id} className="btn btn-sm" href={t.href} target="_blank" rel="noopener noreferrer">{t.label}</a>
          ))}
        </div>
        <p className="text-xs text-slate-500">TikTok or Instagram: use <b>Copy link</b> and put it in your bio or caption. Facebook may take a few minutes to show a new preview.</p>
      </div>
    </div>
  );
}
