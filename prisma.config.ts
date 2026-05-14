import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { applyDatabaseEnvOverridesFromEnvLocal } from "./src/lib/db/database-env-bootstrap";

applyDatabaseEnvOverridesFromEnvLocal();

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * `prisma generate` charge ce fichier même sans base réelle (CI / Vercel).
 * Ne pas utiliser `env("DATABASE_URL")` ici : ça ferait échouer l’install si la variable manque.
 * En prod, définir `DATABASE_URL` (et idéalement `DIRECT_URL` pour les migrations Supabase).
 */
const buildTimePlaceholderUrl =
  "postgresql://prisma:prisma@127.0.0.1:5432/prisma_build?schema=public";

// CLI migrate : préférer DIRECT_URL (connexion directe) si DATABASE_URL utilise un pooler transactionnel Supabase (:6543).
const migrateDatasourceUrl =
  process.env.DIRECT_URL?.trim() ||
  process.env.MIGRATE_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  buildTimePlaceholderUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrateDatasourceUrl,
  },
});
