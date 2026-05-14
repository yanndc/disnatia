import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { coerceValidPostgresUrl } from "./src/lib/db/coerce-postgres-url";
import { applyDatabaseEnvOverridesFromEnvLocal } from "./src/lib/db/database-env-bootstrap";
import {
  firstEnvValue,
  MIGRATE_POSTGRES_URL_KEYS,
} from "./src/lib/db/postgres-env";

applyDatabaseEnvOverridesFromEnvLocal();

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * `prisma generate` charge ce fichier même sans base réelle (CI / Vercel).
 * Ne pas utiliser `env("DATABASE_URL")` ici : ça ferait échouer l’install si la variable manque.
 * En prod, définir au moins une URL Postgres (voir `postgres-env.ts`).
 */
const buildTimePlaceholderUrl =
  "postgresql://prisma:prisma@127.0.0.1:5432/prisma_build?schema=public";

const migrateRaw =
  firstEnvValue(MIGRATE_POSTGRES_URL_KEYS) || buildTimePlaceholderUrl;
const migrateDatasourceUrl =
  migrateRaw === buildTimePlaceholderUrl
    ? migrateRaw
    : coerceValidPostgresUrl(migrateRaw);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrateDatasourceUrl,
  },
});
