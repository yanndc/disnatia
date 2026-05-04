import { NextResponse } from "next/server";
import { refreshLiveQuotesForLatestImport } from "@/features/portfolio/refresh-live-quotes";

export async function POST() {
  try {
    const result = await refreshLiveQuotesForLatestImport();
    return NextResponse.json(result);
  } catch (cause) {
    return NextResponse.json(
      {
        ok: false,
        message:
          cause instanceof Error ? cause.message : "Échec du rafraîchissement des cours.",
      },
      { status: 500 },
    );
  }
}
