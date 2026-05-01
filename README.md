# DisnatIA

DisnatIA est un tableau de bord web pour analyser un portefeuille d'actions Disnat. La V1 est mono-utilisateur et vise un usage local concret: importer un CSV, visualiser les positions, suivre les imports et poser des questions à un chat IA branché sur les données du portefeuille.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS
- Composants UI sobres inspirés shadcn/ui
- TanStack Table pour les positions
- Recharts pour les graphiques
- Papa Parse pour le CSV
- Zod et React Hook Form pour validation/formulaires
- Prisma avec PostgreSQL
- Vercel AI SDK avec OpenAI

## Lancer localement

1. Installer les dépendances:

```bash
pnpm install
```

2. Copier les variables d'environnement:

```bash
cp .env.example .env
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

L'app sera disponible sur `http://localhost:3000`.

## Variables d'environnement

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/disnatia?schema=public"
OPENAI_API_KEY=""
```

`OPENAI_API_KEY` est nécessaire pour `/insights`. Le reste du dashboard fonctionne sans clé IA si la base est configurée.

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

- Pas d'authentification ni multi-utilisateur.
- Pas de taux de change CAD/USD dynamique.
- Le mapping CSV devra probablement être ajusté avec un vrai export Disnat.
- Pas de conseils financiers personnalisés; les réponses IA sont analytiques.
- Les migrations Prisma nécessitent une base PostgreSQL disponible.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
