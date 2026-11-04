import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { NewsCategory } from "@/generated/prisma/client";
import { getNewsFeed, type NewsFeedScope } from "@/features/news/queries";

export const dynamic = "force-dynamic";

const SCOPES: NewsFeedScope[] = ["portfolio", "all", "saved"];
const CATEGORIES: NewsCategory[] = [
  "MARKETS",
  "COMPANY",
  "ECONOMY",
  "REAL_ESTATE",
  "PERSONAL_FINANCE",
  "OTHER",
];

/** Fil paginé pour le client (`/nouvelles`) : scope, catégorie, source, recherche, curseur. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const scopeParam = params.get("scope");
  const categoryParam = params.get("category");

  const scope = SCOPES.includes(scopeParam as NewsFeedScope)
    ? (scopeParam as NewsFeedScope)
    : "portfolio";
  const category = CATEGORIES.includes(categoryParam as NewsCategory)
    ? (categoryParam as NewsCategory)
    : null;
  const limitParam = Number.parseInt(params.get("limit") ?? "", 10);

  try {
    const page = await getNewsFeed({
      scope,
      category,
      sourceSlug: params.get("source")?.trim() || null,
      query: params.get("q"),
      cursor: params.get("cursor"),
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
    });
    return NextResponse.json(page);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Fil indisponible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
