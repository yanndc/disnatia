-- Met à jour les titres de sessions de chat existants (Berta → Pinocchio).
UPDATE "chat_sessions"
SET "title" = replace("title", 'Berta', 'Pinocchio')
WHERE "title" LIKE '%Berta%';
