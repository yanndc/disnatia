-- Copie locale du fichier import (nom stocké en base, voir IMPORT_ARCHIVE_DIR)
ALTER TABLE "portfolio_imports" ADD COLUMN IF NOT EXISTS "archived_source_file_name" TEXT;
