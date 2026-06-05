import { NextResponse } from "next/server";
import { fetchMarketIndicesQuotes } from "@/lib/market/market-indices";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await fetchMarketIndicesQuotes();
    return NextResponse.json(payload);
  } catch (cause) {
    return NextResponse.json(
      {
        ok: false,
        message:
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les indices de marché.",
        fetchedAt: new Date().toISOString(),
        quotes: [],
      },
      { status: 500 },
    );
  }
}
