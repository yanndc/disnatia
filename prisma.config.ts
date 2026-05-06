import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";
import { applyDatabaseEnvOverridesFromEnvLocal } from "./src/lib/db/database-env-bootstrap";

applyDatabaseEnvOverridesFromEnvLocal();

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

// CLI migrate : préférer DIRECT_URL (connexion directe) si DATABASE_URL utilise un pooler transactionnel Supabase (:6543).
const migrateDatasourceUrl =
  process.env.DIRECT_URL?.trim() ||
  process.env.MIGRATE_DATABASE_URL?.trim() ||
  env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrateDatasourceUrl,
  },
});
