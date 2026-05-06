import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_MEMORY_CONTENT_MAX,
  AGENT_MEMORY_TITLE_MAX,
  listAgentMemoryEntries,
  sanitizeAgentMemoryInput,
} from "@/features/chat/agent-memory";
import { prisma } from "@/lib/db/prisma";

const postSchema = z.object({
  content: z.string().min(1).max(AGENT_MEMORY_CONTENT_MAX),
  title: z.string().max(AGENT_MEMORY_TITLE_MAX).optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(AGENT_MEMORY_CONTENT_MAX).optional(),
  title: z.union([z.string().max(AGENT_MEMORY_TITLE_MAX), z.null()]).optional(),
});

export async function GET() {
  const entries = await listAgentMemoryEntries();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }
  try {
    const { title, content } = sanitizeAgentMemoryInput(
      parsed.data.content,
      parsed.data.title,
    );
    const entry = await prisma.agentMemoryEntry.create({
      data: { title, content },
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de création.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }
  const { id, content: bodyContent, title: bodyTitle } = parsed.data;
  const existing = await prisma.agentMemoryEntry.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });
  }
  try {
    const mergedTitle =
      bodyTitle === undefined ? existing.title : bodyTitle === null ? null : bodyTitle;
    const mergedContent = bodyContent ?? existing.content;
    const { title, content } = sanitizeAgentMemoryInput(mergedContent, mergedTitle);
    const entry = await prisma.agentMemoryEntry.update({
      where: { id },
      data: { title, content },
    });
    return NextResponse.json({ entry });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de mise à jour.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id?.trim()) {
    return NextResponse.json({ error: "Paramètre id requis." }, { status: 400 });
  }
  try {
    await prisma.agentMemoryEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Entrée introuvable." }, { status: 404 });
  }
}
