# DisnatIA

DisnatIA est un tableau de bord web pour analyser un portefeuille d'actions Disnat. La V1 est mono-utilisateur et vise un usage local concret: importer un CSV, visualiser les positions, suivre les imports et poser des questions à un chat IA branché sur les données du portefeuille.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- Composants UI sobres inspirés shadcn/ui
- TanStack Table pour les positions
- Recharts pour les graphiques
- Papa Parse pour le CSV
- Zod et React Hook Form pour validation/formulaires
- Prisma (ORM / migrations) vers **PostgreSQL** — utilisable avec Postgres **local**, **Docker** ou **Supabase** (URL du dashboard dans `DATABASE_URL` ; avec Supabase prévoir souvent aussi `DIRECT_URL` pour les migrations).
- Vercel AI SDK avec OpenAI

## Lancer localement

1. Installer les dépendances:

```bash
pnpm install
```

2. Copier les variables d'environnement locales:

```bash
cp .env.example .env.local
```

3. Lancer PostgreSQL local:

```bash
docker compose up -d
```

4. Générer Prisma et appliquer les migrations:

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

5. Démarrer l'app:

```bash
pnpm dev
```

L'app sera disponible sur `http://localhost:3001`.

## Variables d'environnement

**`.env.local`** est **gitignoré** à dessein : tu le gardes uniquement sur ta machine (secrets, URL Supabase locale, etc.) et tu ne le commites pas. En prod, tu copies les clés équivalentes dans les variables du déploiement (ex. Vercel). Ce dev local n’empêche pas d’utiliser **Supabase comme base**.

Modèle : [.env.example](.env.example) (copier en `.env.local`).

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/disnatia?schema=public"
OPENAI_API_KEY=""
# Optionnel — si absent, aucune question de mot de passe à l’entrée du site :
# SITE_ACCESS_PASSWORD="ton-secret"
```

`OPENAI_API_KEY` est nécessaire pour `/insights`. Le reste du dashboard fonctionne sans clé IA si la base est configurée.

**SITE_ACCESS_PASSWORD** : le middleware impose une page `/site-lock` tant que cette variable est définie et que le cookie de session n’est pas valide. Sans variable (ou valeur vide après trim côté logique métier habituelle : absent = désactivé), l’accès au dashboard est direct — c’est une **mono-instance locale**, pas un compte utilisateur.

**Données vides** : la V1 ne seed pas le portefeuille. Une base nouvellement migrée est normalement vide jusqu’à ce que tu importes au moins un CSV Disnat depuis `/imports` (et que PostgreSQL tourne bien sur l’URL de `DATABASE_URL`).

Next.js charge `.env.local` en local. La configuration Prisma charge aussi `.env.local`, puis `.env` en repli pour les commandes CLI.

Si tu modifies le schéma Prisma après avoir lancé `pnpm dev`, relance ensuite `pnpm prisma:generate`, arrête puis redémarre le serveur de dev. Sinon le singleton Prisma en mémoire peut rester sur une ancienne version du client et provoquer des erreurs comme `Unknown argument importType` ou `_count.select.transactions` inconnu après une migration.

## Importer un CSV Disnat

Va dans `/imports`, dépose un fichier `.csv`, vérifie la preview et les messages de validation, puis clique sur `Valider et sauvegarder l'import`.

Le parseur cherche des colonnes courantes comme:

- compte / account
- symbole / ticker
- nom / description
- devise / currency
- quantite / quantity
- cout moyen / average cost
- prix / market price
- valeur marchande / market value
- encaisse / cash

## Hypothèses CSV V1

Le format Disnat peut varier selon le type d'export. La V1 sépare les lignes de positions des lignes d'encaisse si une ligne a une valeur d'encaisse sans ticker. Les montants sont traités comme déjà exprimés dans leur devise de ligne. La simulation de rééquilibrage du chat est simplifiée en CAD et ne tient pas compte des frais, taxes, conversions de devises ou mouvements de prix.

## Pages

- `/overview`: KPI, exposition par devise, top positions, variation vs import précédent
- `/imports`: upload CSV, preview, validation, sauvegarde, historique
- `/positions`: table triable et recherchable du dernier import
- `/insights`: chat IA avec outils serveur portefeuille

## Limites connues V1

- Pas de comptes utilisateurs multi-tenant ; verrouillage site optionnel via `SITE_ACCESS_PASSWORD` uniquement.
- Pas de taux de change CAD/USD dynamique.
- Le mapping CSV devra probablement être ajusté avec un vrai export Disnat.
- Pas de conseils financiers personnalisés; les réponses IA sont analytiques.
- Les migrations Prisma nécessitent une base PostgreSQL disponible.
