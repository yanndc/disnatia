import { NextResponse } from "next/server";
import {
  SITE_ACCESS_COOKIE,
  getSiteAccessPassword,
  safeInternalPath,
  siteAccessCookieValue,
} from "@/lib/site-access";

export async function POST(request: Request) {
  const configured = getSiteAccessPassword();
  if (!configured) {
    return NextResponse.json(
      { error: "Verrouillage site non configuré." },
      { status: 503 },
    );
  }

  let body: { password?: string; redirect?: string };
  try {
    body = (await request.json()) as { password?: string; redirect?: string };
  } catch {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const submitted = (body.password ?? "").trim();
  if (submitted !== configured) {
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }

  const destination = safeInternalPath(body.redirect ?? null);
  const cookieVal = await siteAccessCookieValue(configured);
  const res = NextResponse.json({ ok: true, redirect: destination });

  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(SITE_ACCESS_COOKIE, cookieVal, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProd,
    maxAge: 60 * 60 * 24 * 365,
  });

  return res;
}

/** Déploiement : le serveur voit-il SITE_ACCESS_PASSWORD ? (ne révèle pas la valeur.) */
export async function GET() {
  return NextResponse.json({ lockEnabled: getSiteAccessPassword() !== null });
}
