-- Fichier source en base (BYTEA) ; suppression de l’ancienne colonne chemin disque
ALTER TABLE "portfolio_imports" ADD COLUMN IF NOT EXISTS "source_file_content" BYTEA;
ALTER TABLE "portfolio_imports" ADD COLUMN IF NOT EXISTS "source_file_kept" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "portfolio_imports" DROP COLUMN IF EXISTS "archived_source_file_name";
