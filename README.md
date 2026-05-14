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

**`.env.local`** est **gitignoré** : secrets et URLs Postgres sur ta machine. En mono-base Supabase, l’important est que **la prod Vercel et le dev utilisent les mêmes valeurs**.

Modèle : [.env.example](.env.example) (copier en `.env.local`).

### Prod comme le dev — une seule base Supabase

L’objet : **`DATABASE_URL`** (et **`DIRECT_URL`** si tu passes par le pooler Supabase pour l’une et la connexion session pour les migrations) est **la même chaîne partout**.

1. Dans le **dashboard Supabase** (Settings → Database), récupère les URLs que tu utilisées déjà en dev dans **`.env.local`**.
2. Dans **Vercel → Ton projet → Environment Variables → Production** (et Preview si besoin), mets **exactement** ces mêmes `DATABASE_URL` / `Direct URL` (**copie depuis `.env.local` ou depuis Supabase** — ça doit matcher bit à bit celles où tu vois tes données).
3. **Redéploie** le projet après toute modification d’ENV.
4. Si la première fois sur cette DB : **`pnpm prisma migrate deploy`** une fois contre cette URL (localement avec la même `DATABASE_URL` ou via ta CI), pour avoir le même schéma qu’en dev.

Référence la base **Supabase**, pas « ce qui est déjà dans Vercel » si tes données viennent surtout du dev : c’est bien **la prod qui doit rejoindre le dev**.

Alternative pratique : mettre dans Vercel exactement les mêmes lignes que ton `.env.local` fonctionnel (copier/coller).

⚠️ `vercel env pull` **inverse** la direction (réplique depuis Vercel vers disque) : utile seulement si Vercel est déjà la source de vérité.

⚠️ Tout ce que tu fais en local (import CSV, migration) contre cette URL **touche la même BD** pour dev et prod.

Next.js charge `.env.local` en local. La configuration Prisma charge aussi `.env.local`, puis `.env` en repli pour les commandes CLI.

Si tu modifies le schéma Prisma après avoir lancé `pnpm dev`, relance ensuite `pnpm prisma:generate`, arrête puis redémarre le serveur de dev. Sinon le singleton Prisma en mémoire peut rester sur une ancienne version du client et provoquer des erreurs comme `Unknown argument importType` ou `_count.select.transactions` inconnu après une migration.

- **`OPENAI_API_KEY`** : pour `/insights`.
- **`SITE_ACCESS_PASSWORD`** : optionnel ; si défini → page `/site-lock` (même mot de passe dans Vercel et `.env.local` si tu veux le même flux partout).
- **Données** : pas de seed automatique ; après alignement des URLs, import CSV sur `/imports`.

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
