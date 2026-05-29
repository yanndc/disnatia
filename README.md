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
- **Rapport EOD par courriel** : voir section [Rapport fin de journée par courriel](#rapport-fin-de-journée-par-courriel) (variables `RESEND_*`, `EOD_*`, `CRON_SECRET`).

## Rapport fin de journée par courriel

Envoi automatique d’un courriel HTML après chaque **jour ouvré** (lun–ven, heure Toronto), entre **17 h 15 et 19 h 00** — hors week-end, sans calendrier de jours fériés.

### Checklist (dans l’ordre)

1. **Resend** — compte sur [resend.com](https://resend.com), clé API, **domaine expéditeur vérifié** ([Domains](https://resend.com/domains)). L’adresse dans `EOD_REPORT_FROM` doit utiliser ce domaine (ex. `DisnatIA <rapports@tondomaine.com>`).
2. **Variables** — dans `.env.local` **et** Vercel → Production (puis redéploiement) :

   | Variable | Rôle |
   |----------|------|
   | `RESEND_API_KEY` | Clé API Resend (`re_...`) |
   | `EOD_REPORT_FROM` | Expéditeur (domaine vérifié Resend) |
   | `EOD_REPORT_TO` | Destinataire (ton courriel) |
   | `CRON_SECRET` | Secret fort ; même valeur dans **Vercel** (vérif API) et **GitHub Actions** (appel cron) |
   | `NEXT_PUBLIC_APP_URL` | Optionnel — lien vers l’app dans le courriel |

3. **Base de données** — une fois les variables en place, appliquer la migration (table `eod_report_deliveries`, idempotence) :

   ```bash
   pnpm prisma migrate deploy
   ```

4. **GitHub Actions** (pas de Vercel Cron — limite plan Hobby) — **Settings → Secrets and variables → Actions** :

   | Emplacement | Nom | Valeur |
   |-------------|-----|--------|
   | **Secrets** | `CRON_SECRET` | Identique à celui sur Vercel |
   | **Variables** | `EOD_REPORT_APP_URL` | URL prod sans slash final, ex. `https://disnatia.vercel.app` |

   Workflow : [`.github/workflows/eod-report-cron.yml`](.github/workflows/eod-report-cron.yml) — lun–ven 22 h 30 UTC, plus **Run workflow** manuel (`workflow_dispatch`). Redéployer Vercel après les variables ; le workflow s’active au prochain push sur la branche par défaut.

5. **Vérification** — en prod, le premier envoi part seul dans la fenêtre horaire. Pour tester tout de suite en local :

   ```bash
   pnpm dev
   ```

   ```bash
   curl -X POST "http://localhost:3001/api/cron/eod-report?force=1" ^
     -H "Authorization: Bearer VOTRE_CRON_SECRET"
   ```

   (`?force=1` uniquement si `NODE_ENV=development` — ignore la fenêtre 17 h 15–19 h ; en prod, pas de raccourci.)

### Comportement

- **Contenu** : valeur totale CAD, P&L jour et dernière séance, tableau par compte, liste des positions, qualité des cotations (aligné dashboard).
- **Données** : rafraîchit les cours live + clôtures de séance avant génération du rapport.
- **Doublon** : un seul envoi par date de séance (`referenceTradingSessionDay`, Toronto) ; second appel → `{ "skipped": true, "reason": "already_sent" }`.
- **Hors fenêtre / week-end** : `{ "skipped": true, "reason": "hors_fenetre_envoi" }` (normal si tu appelles le cron à la main en dehors des heures).
- **Route cron** : `/api/cron/` est exclue du verrou `SITE_ACCESS_PASSWORD` ; la sécurité repose sur `CRON_SECRET`.

### Fichiers utiles

- Route : [`src/app/api/cron/eod-report/route.ts`](src/app/api/cron/eod-report/route.ts)
- Logique envoi : [`src/features/reports/send-eod-report.ts`](src/features/reports/send-eod-report.ts)
- Template courriel : [`src/emails/eod-report-email.tsx`](src/emails/eod-report-email.tsx)
- Séance / fenêtre horaire : [`src/lib/market/equity-session.ts`](src/lib/market/equity-session.ts) (`shouldSendEodReport`)

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
