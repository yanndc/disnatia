-- Renomme la table des règles persistées de l'agent IA (Berta → Pinocchio).
ALTER TABLE "berta_agent_rules" RENAME TO "pinocchio_agent_rules";

ALTER TABLE "pinocchio_agent_rules"
  RENAME CONSTRAINT "berta_agent_rules_pkey" TO "pinocchio_agent_rules_pkey";
