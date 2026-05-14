export const SITE_ACCESS_COOKIE = "disnatia_site_access";

const SITE_ACCESS_SALT = "|disnatia|site-lock|v1";

/**
 * Variable d’env `SITE_ACCESS_PASSWORD` après trim ; `null` si absente ou vide (évite faux négatif si espace parasite dans Vercel).
 */
export function getSiteAccessPassword(): string | null {
  const raw = process.env.SITE_ACCESS_PASSWORD;
  if (raw === undefined || raw === null) return null;
  const t = typeof raw === "string" ? raw.trim() : String(raw).trim();
  return t.length > 0 ? t : null;
}

export async function siteAccessCookieValue(password: string): Promise<string> {
  return sha256Hex(password + SITE_ACCESS_SALT);
}

async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeInternalPath(pathname: string | null): string {
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return "/overview";
  }
  return pathname;
}
