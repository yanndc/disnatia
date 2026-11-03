import { prisma } from "@/lib/db/prisma";
import { PINOCCHIO_RULES_BODY_MAX } from "./pinocchio-agent-rules-constants";

export { PINOCCHIO_RULES_BODY_MAX } from "./pinocchio-agent-rules-constants";

export async function getPinocchioRulesBody(): Promise<string> {
  const row = await prisma.pinocchioAgentRules.upsert({
    where: { id: "default" },
    create: { id: "default", body: "" },
    update: {},
    select: { body: true },
  });
  return row.body;
}

/** Ajoute les règles perso au prompt de base (équivalent « AI rules » éditables). */
export function mergePinocchioRulesIntoSystemPrompt(baseSystem: string, rulesBody: string): string {
  const trimmed = rulesBody.trim();
  if (!trimmed) {
    return baseSystem;
  }
  return `${baseSystem}\n\n## Règles personnalisées\n${trimmed}\n\n(Suis ces règles en plus des instructions ci-dessus ; elles sont définies par l'utilisateur dans l'interface.)`;
}

export function sanitizePinocchioRulesBody(raw: string): string {
  const body = raw.replace(/\u0000/g, "").trimEnd();
  if (body.length > PINOCCHIO_RULES_BODY_MAX) {
    throw new Error(`Le texte dépasse ${PINOCCHIO_RULES_BODY_MAX} caractères.`);
  }
  return body;
}
