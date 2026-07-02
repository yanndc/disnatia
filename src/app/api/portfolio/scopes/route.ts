import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const createScopeSchema = z.object({
  label: z.string().min(1).max(120),
  accountKeys: z.array(z.string().min(1)).min(1).max(200),
});

function slugifyLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function resolveOwnerIdsFromAccountKeys(accountKeys: string[]): Promise<string[]> {
  const disnatMappings = await prisma.portfolioAccountOwner.findMany({
    where: { accountKey: { in: accountKeys } },
    select: { ownerId: true },
  });

  const externalAccounts = await prisma.externalPortfolioAccount.findMany({
    where: { accountKey: { in: accountKeys } },
    select: { id: true },
  });
  const externalIds = externalAccounts.map((x) => x.id);

  const externalMappings =
    externalIds.length > 0
      ? await prisma.externalPortfolioAccountOwner.findMany({
          where: { externalAccountId: { in: externalIds } },
          select: { ownerId: true },
        })
      : [];

  return [...new Set([...disnatMappings, ...externalMappings].map((x) => x.ownerId))];
}

async function nextPortfolioKey(baseSlug: string): Promise<string> {
  const base = `custom:${baseSlug || "portfolio"}`;
  let candidate = base;
  let i = 2;
  while (true) {
    const exists = await prisma.portfolio.findUnique({
      where: { portfolioKey: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${base}-${i}`;
    i += 1;
  }
}

export async function GET() {
  try {
    const rows = await prisma.portfolio.findMany({
      where: { isActive: true },
      orderBy: [{ kind: "asc" }, { displayName: "asc" }],
      include: {
        owners: {
          select: {
            owner: { select: { displayName: true } },
            weightPct: true,
          },
          orderBy: { owner: { displayName: "asc" } },
        },
      },
    });

    return NextResponse.json({
      scopes: rows.map((r) => ({
        id: r.id,
        portfolioKey: r.portfolioKey,
        label: r.displayName,
        kind: r.kind,
        owners: r.owners.map((o) => ({
          label: o.owner.displayName,
          weightPct: o.weightPct,
        })),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les portefeuilles." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = createScopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const label = parsed.data.label.trim();
  const accountKeys = [...new Set(parsed.data.accountKeys.map((x) => x.trim()).filter(Boolean))];
  if (accountKeys.length === 0) {
    return NextResponse.json({ error: "Aucun compte sélectionné." }, { status: 422 });
  }

  try {
    const ownerIds = await resolveOwnerIdsFromAccountKeys(accountKeys);
    if (ownerIds.length === 0) {
      return NextResponse.json(
        { error: "Aucun propriétaire mappé pour les comptes sélectionnés." },
        { status: 422 },
      );
    }

    const portfolioKey = await nextPortfolioKey(slugifyLabel(label));
    const weight = 100 / ownerIds.length;

    const created = await prisma.$transaction(async (tx) => {
      const portfolio = await tx.portfolio.create({
        data: {
          portfolioKey,
          displayName: label,
          kind: "CUSTOM",
          isActive: true,
        },
      });

      await tx.portfolioOwnerMembership.createMany({
        data: ownerIds.map((ownerId) => ({
          portfolioId: portfolio.id,
          ownerId,
          weightPct: weight,
        })),
      });

      return portfolio;
    });

    return NextResponse.json({
      ok: true,
      scope: {
        id: created.id,
        portfolioKey: created.portfolioKey,
        label: created.displayName,
        kind: created.kind,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Création du portefeuille impossible." }, { status: 500 });
  }
}