import { NextResponse } from "next/server";
import { z } from "zod";
import type { NewsCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ensureNewsSourcesSeeded } from "@/features/news/news-sources";
import { getNewsSourcesWithStats } from "@/features/news/queries";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "MARKETS",
  "COMPANY",
  "ECONOMY",
  "REAL_ESTATE",
  "PERSONAL_FINANCE",
  "OTHER",
] as const satisfies readonly NewsCategory[];

const createSchema = z.object({
  name: z.string().min(2).max(120),
  feedUrl: z.string().url().max(600),
  homepageUrl: z.union([z.string().url().max(600), z.literal("")]).optional(),
  language: z.enum(["fr", "en"]).optional(),
  category: z.enum(CATEGORIES).optional(),
  weight: z.number().min(0.2).max(2).optional(),
});

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function GET() {
  await ensureNewsSourcesSeeded().catch(() => null);
  try {
    const sources = await getNewsSourcesWithStats();
    return NextResponse.json({ sources });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Sources indisponibles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Ajoute un flux RSS manuel (les flux du registre de code n'ont pas besoin de passer ici). */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Flux invalide." }, { status: 400 });
  }

  const base = slugify(parsed.data.name) || "flux";
  let slug = base;
  for (let i = 2; i < 50; i += 1) {
    const existing = await prisma.newsSource.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) break;
    slug = `${base}-${i}`;
  }

  try {
    const source = await prisma.newsSource.create({
      data: {
        slug,
        name: parsed.data.name.trim(),
        feedUrl: parsed.data.feedUrl.trim(),
        homepageUrl: parsed.data.homepageUrl?.trim() || null,
        kind: "RSS",
        language: parsed.data.language ?? "fr",
        category: parsed.data.category ?? "MARKETS",
        weight: parsed.data.weight ?? 1,
        isSeed: false,
      },
      select: { id: true, slug: true },
    });
    return NextResponse.json({ ok: true, source }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Création impossible";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
