# Checklist (HTML / CSS / JS)

Site statique + fonctions serverless Vercel (`/api`) + Supabase. Node.js 22+ est nécessaire.

## Structure
.
| Fichier | Rôle |
|---|---|
| `index.html` | Pages (connexion, liste, formulaire) |
| `style.css` | Styles |
| `app.js` | Logique client, appelle les endpoints `/api/*` |
| `api/*.js` | Fonctions serverless : session, login/logout, tâches, devs |
| `api/_lib/*.js` | Client Supabase admin (clé secrète) et gestion de session signée |
| `build-config.mjs` | Valide au build que les variables d'environnement requises sont présentes |
| `schema.sql` | Tables + règles de sécurité (RLS) |

## Authentification

L'accès n'utilise plus Supabase Auth. La connexion se fait avec `APP_LOGIN` / `APP_PASSWORD`, vérifiés **côté serveur uniquement** par `api/login.js`. Une fois validés, un cookie de session signé (`HttpOnly`, `Secure`, `SameSite=Strict`) autorise l'accès aux endpoints `/api/tasks`, `/api/devs`, etc. Toutes les requêtes vers Supabase passent par ces fonctions serverless, qui utilisent la **clé secrète** (`SUPABASE_SECRET_KEY`) — jamais exposée au navigateur.

## Mise en place

1. **Supabase → SQL Editor** : exécuter `schema.sql`.
2. **Supabase → Settings → API** : récupérer l'URL du projet et la **clé secrète** (`service_role` / `sb_secret_...`).
3. Sur Vercel, importer le repo (Framework : *Other*) et ajouter dans les variables d'environnement du projet :
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `APP_LOGIN`
   - `APP_PASSWORD`
   - `SESSION_SECRET` (chaîne aléatoire longue, ex. générée avec `openssl rand -base64 32`)
4. La commande de build (`node build-config.mjs`) et le répertoire de sortie (`.`) sont déjà définis dans `vercel.json`.

## Région des fonctions

Chaque action passe par une fonction `/api` qui interroge Supabase : les fonctions doivent tourner dans la même région que la base, sinon chaque requête traverse l'Europe (ou l'Atlantique) en plus.

1. **Supabase → Project Settings → General** : lire la région du projet (aussi visible en haut du tableau de bord).
2. Mettre la région Vercel correspondante dans `vercel.json` (`"regions"`) :

| Région Supabase | Région Vercel |
|---|---|
| West EU (Ireland) — `eu-west-1` | `dub1` |
| West EU (London) — `eu-west-2` | `lhr1` |
| West EU (Paris) — `eu-west-3` | `cdg1` |
| Central EU (Frankfurt) — `eu-central-1` | `fra1` |
| East US (North Virginia) — `us-east-1` | `iad1` |

Le projet actuel est en `eu-west-1` (Irlande) : `vercel.json` utilise donc `dub1`. Après déploiement, la région est visible dans **Vercel → Deployments → (déploiement) → Functions**.

## Local

```bash
npm install
node build-config.mjs
npx vercel dev
```

Copier `.env.example` vers `.env` et renseigner les variables avant de lancer. `npx vercel dev` est nécessaire (au lieu de `npx serve .`) pour exécuter les fonctions `/api` localement.

## Sécurité

- `SUPABASE_SECRET_KEY` ne doit **jamais** être exposée au navigateur : elle n'est utilisée que dans les fonctions `api/*.js`, exécutées côté serveur.
- Le cookie de session est signé (HMAC) avec `SESSION_SECRET`, `HttpOnly`, `Secure` et `SameSite=Strict` : il n'est ni lisible ni envoyable en cross-site.
- Les comparaisons de l'identifiant et du mot de passe se font en temps constant (`crypto.timingSafeEqual`) pour limiter les attaques par timing.
- Ne jamais exposer `SUPABASE_SECRET_KEY`, `APP_PASSWORD` ou `SESSION_SECRET` dans du code client ni les ajouter à Git.

## Dépannage

### « JWT issued at future »

Avec une clé `sb_secret_...`, Supabase génère lui-même, à chaque requête, un JWT court que PostgREST vérifie ensuite. Un léger décalage d'horloge entre les deux côtés de Supabase peut faire juger ce JWT « émis dans le futur » : la requête échoue, la suivante passe. Notre cookie de session n'est pas en cause.

L'application s'en protège automatiquement :
- côté serveur, `withRetry` (`api/_lib/retry.js`) réessaie jusqu'à 2 fois, après ~300 ms, les erreurs JWT (« JWT issued at future », `PGRST301`, `PGRST303`) ;
- côté client, une réponse 5xx est réessayée une fois avant d'afficher « Erreur temporaire, réessaie ».

Le détail de chaque erreur reste visible dans les logs des fonctions (**Vercel → Deployments → Functions**, lignes `Supabase : erreur JWT transitoire` et `Erreur serveur`).

**Si l'erreur persiste** (message affiché souvent malgré les nouveaux essais) : remplacer temporairement `SUPABASE_SECRET_KEY` par la clé legacy `service_role` (**Supabase → Settings → API Keys → Legacy API Keys**, valeur au format `eyJ...`). Elle est déjà signée et ne passe pas par cette génération de JWT. Elle donne les mêmes droits que la clé secrète : mêmes précautions (jamais côté navigateur, jamais dans Git). Revenir à `sb_secret_...` une fois le problème résolu côté Supabase, et le leur signaler avec le `sb-request-id` présent dans les logs.
