import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DISNAT_PERIOD_IDS,
  deleteDisnatReference,
  loadPerformanceReconciliation,
  parseDisnatReferenceCsv,
  upsertDisnatReferences,
} from "@/features/portfolio/performance-reconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");

const postSchema = z.object({
  referenceDate: isoDate,
  /** Collage du tableau Disnat ; sinon `rows` explicites. */
  csv: z.string().max(20_000).optional(),
  rows: z
    .array(
      z.object({
        clientCode: z.string().min(2).max(20),
        period: z.string().min(1).max(10),
        valuePct: z.number().finite().min(-100).max(1000),
      }),
    )
    .optional(),
});

export async function GET() {
  try {
    const reconciliation = await loadPerformanceReconciliation();
    return NextResponse.json({ reconciliation });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Réconciliation indisponible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  let rows = parsed.data.rows ?? [];
  if (parsed.data.csv?.trim()) {
    const csv = parseDisnatReferenceCsv(parsed.data.csv);
    rows = [...rows, ...csv.rows];
  }
  rows = rows.filter((row) => DISNAT_PERIOD_IDS.includes(row.period));
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Aucune valeur reconnue (attendu : code client puis 6 pourcentages)." },
      { status: 422 },
    );
  }

  try {
    const saved = await upsertDisnatReferences({
      referenceDate: parsed.data.referenceDate,
      rows,
      source: parsed.data.csv?.trim() ? "PASTE" : "MANUAL",
    });
    const reconciliation = await loadPerformanceReconciliation();
    return NextResponse.json({ ok: true, saved, reconciliation });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Enregistrement impossible";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }
  try {
    await deleteDisnatReference(id);
    const reconciliation = await loadPerformanceReconciliation();
    return NextResponse.json({ ok: true, reconciliation });
  } catch {
    return NextResponse.json({ error: "Référence introuvable." }, { status: 404 });
  }
}
