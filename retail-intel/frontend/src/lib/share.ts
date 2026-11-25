/** Share a store or product link to social apps. Links go through /s/... so each app shows a preview card. */
export const storeShareUrl = (slug: string) => `${window.location.origin}/s/${encodeURIComponent(slug)}`;
export const productShareUrl = (slug: string, productId: number) => `${storeShareUrl(slug)}/p/${productId}`;

export function shareTargets(url: string, text: string) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text), both = encodeURIComponent(`${text} ${url}`);
  return [
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: "messenger", label: "Messenger", href: `fb-messenger://share/?link=${u}`, mobileOnly: true },
    { id: "viber", label: "Viber", href: `viber://forward?text=${both}`, mobileOnly: true },
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${both}` },
    { id: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${u}&text=${t}` },
    { id: "x", label: "X", href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
  ];
}

/** Phone share sheet when available (lets people pick TikTok, Instagram, SMS …); otherwise copies the link. */
export async function shareOrCopy(url: string, title: string, text: string): Promise<"shared" | "copied" | "failed"> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) { try { await nav.share({ title, text, url }); return "shared"; } catch (e) { if ((e as Error)?.name === "AbortError") return "failed"; } }
  return copyText(url);
}
export async function copyText(s: string): Promise<"copied" | "failed"> {
  try { await navigator.clipboard.writeText(s); return "copied"; } catch { return "failed"; }
}
export const isMobile = () => typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
