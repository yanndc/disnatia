import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BERTA_RULES_BODY_MAX,
  getBertaRulesBody,
  sanitizeBertaRulesBody,
} from "@/features/chat/berta-agent-rules";
import { prisma } from "@/lib/db/prisma";

const putSchema = z.object({
  body: z.string().max(BERTA_RULES_BODY_MAX),
});

export async function GET() {
  const row = await prisma.bertaAgentRules.upsert({
    where: { id: "default" },
    create: { id: "default", body: "" },
    update: {},
    select: { body: true, updatedAt: true },
  });
  return NextResponse.json({
    body: row.body,
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function PUT(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }
  try {
    const body = sanitizeBertaRulesBody(parsed.data.body);
    const row = await prisma.bertaAgentRules.upsert({
      where: { id: "default" },
      create: { id: "default", body },
      update: { body },
      select: { body: true, updatedAt: true },
    });
    return NextResponse.json({
      body: row.body,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de l'enregistrement.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
