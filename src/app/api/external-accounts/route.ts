import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { buildInitialMetadata } from "@/lib/portfolio/external-account-metadata";
import { externalProviderPreset } from "@/lib/portfolio/external-account-providers";
import { listExternalAccountsWithLatest } from "@/features/portfolio/external-accounts-queries";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

const createBodySchema = z.object({
  provider: z.enum(["desjardins_erc_reer_collectif", "other"]),
  displayLabel: z.string().min(1).max(240),
  currency: z.string().min(3).max(8).optional(),
  portalUrl: z.union([z.string().url(), z.literal("")]).optional().nullable(),
  /** Texte libre (ex. répartition et profil affichés sur le site assureur) */
  sourceSummary: z.string().max(4000).optional().nullable(),
  /** Où trouver l’historique / les transactions sur le portail pour mettre à jour les snapshots */
  transactionUpdateInstructions: z.string().max(8000).optional().nullable(),
  /** Même convention que les imports Disnat (nom affiché au tableau de bord) */
  owner: z.string().max(200).optional().nullable(),
  initialSnapshot: z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    totalValue: z.number().finite().nonnegative(),
    notes: z.string().max(2000).optional().nullable(),
  }),
});

export async function GET() {
  try {
    const accounts = await listExternalAccountsWithLatest();
    return NextResponse.json({
      accounts: accounts.map((a) => ({
        ...a,
        latestSnapshot: a.latestSnapshot
          ? {
              asOfDate: a.latestSnapshot.asOfDate.toISOString().slice(0, 10),
              totalValue: a.latestSnapshot.totalValue,
            }
          : null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les comptes externes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const {
    provider,
    displayLabel,
    currency: currencyRaw,
    portalUrl,
    sourceSummary,
    transactionUpdateInstructions,
    owner: ownerRaw,
    initialSnapshot,
  } = parsed.data;
  const owner = sanitizePortfolioOwner(ownerRaw);
  const currency = (currencyRaw ?? "CAD").trim().toUpperCase();

  const preset = externalProviderPreset(provider);
  const resolvedPortal =
    portalUrl && portalUrl.length > 0
      ? portalUrl
      : (preset?.defaultPortalUrl ?? null);

  const asOfDate = new Date(`${initialSnapshot.asOfDate}T12:00:00.000Z`);
  if (Number.isNaN(asOfDate.getTime())) {
    return NextResponse.json({ error: "Date snapshot invalide." }, { status: 422 });
  }

  const metadata = buildInitialMetadata({
    sourceSummary,
    transactionUpdateInstructions,
  });

  const id = randomUUID();
  const accountKey = `ext:${id}`;

  try {
    const account = await prisma.externalPortfolioAccount.create({
      data: {
        id,
        accountKey,
        provider,
        displayLabel: displayLabel.trim(),
        owner,
        currency,
        portalUrl: resolvedPortal,
        metadata: metadata ?? undefined,
        snapshots: {
          create: {
            asOfDate,
            totalValue: initialSnapshot.totalValue,
            notes: initialSnapshot.notes?.trim() || null,
          },
        },
      },
      include: {
        snapshots: { orderBy: { asOfDate: "desc" }, take: 1 },
      },
    });

    return NextResponse.json({
      ok: true,
      account: {
        id: account.id,
        accountKey: account.accountKey,
        provider: account.provider,
        displayLabel: account.displayLabel,
        currency: account.currency,
        portalUrl: account.portalUrl,
        latestSnapshot: account.snapshots[0]
          ? {
              asOfDate: account.snapshots[0].asOfDate.toISOString().slice(0, 10),
              totalValue: account.snapshots[0].totalValue,
            }
          : null,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Erreur lors de la création du compte externe." },
      { status: 500 },
    );
  }
}
