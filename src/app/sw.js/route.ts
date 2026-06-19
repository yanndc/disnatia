import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

/**
 * Sert le Service Worker depuis une route Next.js pour éviter les redirections
 * Vercel sur les fichiers statiques public/ (qui causent l'erreur SW registration).
 */
export async function GET() {
  try {
    const swPath = join(process.cwd(), "public", "sw.js");
    const content = await readFile(swPath, "utf-8");
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Service-Worker-Allowed": "/",
      },
    });
  } catch {
    return new NextResponse("// sw.js not found", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }
}
