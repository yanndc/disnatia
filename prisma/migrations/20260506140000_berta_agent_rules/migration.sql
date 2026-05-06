-- CreateTable
CREATE TABLE "berta_agent_rules" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "berta_agent_rules_pkey" PRIMARY KEY ("id")
);

INSERT INTO "berta_agent_rules" ("id", "body", "updatedAt")
VALUES ('default', '', CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_memory_entries'
  ) THEN
    UPDATE "berta_agent_rules"
    SET
      "body" = COALESCE(
        (
          SELECT string_agg(
            CASE
              WHEN m."title" IS NOT NULL AND btrim(m."title") <> ''
              THEN '### ' || m."title" || E'\n' || m."content"
              ELSE m."content"
            END,
            E'\n\n' ORDER BY m."createdAt" ASC
          )
          FROM "agent_memory_entries" m
        ),
        ''
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'default';

    DROP TABLE "agent_memory_entries";
  END IF;
END $$;
