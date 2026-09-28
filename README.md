# Checklist (HTML / CSS / JS)

Site statique + Supabase. Node.js 20.12+ est nécessaire pour générer la configuration cliente.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Pages (connexion, liste, formulaire) |
| `style.css` | Styles |
| `app.js` | Logique + appels Supabase |
| `build-config.mjs` | Génère `config.js` depuis les variables d'environnement publiques |
| `config.js` | Configuration Supabase générée, ignorée par Git |
| `schema.sql` | Tables + règles de sécurité (RLS) |

## Mise en place

1. **Supabase → SQL Editor** : exécuter `schema.sql`.
2. **Supabase → Authentication → Users → Add user** : créer le compte partagé (email + mot de passe).
3. **Supabase → Authentication → Providers → Email** : désactiver « Allow new users to sign up ».
4. Sur Vercel, importer le repo (Framework : *Other*) et ajouter `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dans les variables d'environnement du projet.
5. Configurer la commande de build `node build-config.mjs` et le répertoire de sortie `.`.

## Local

```bash
node build-config.mjs
npx serve .
```

Copier `.env.example` vers `.env` et renseigner les deux variables publiques Supabase avant de générer la configuration. `config.js` est créé localement et n'est pas suivi par Git.

## Sécurité

- La clé publishable est publique par conception : la protection vient des **RLS** (seuls les utilisateurs connectés lisent/écrivent).
- Le générateur ne transmet au navigateur que l'URL et la clé publishable. Il refuse une clé `sb_secret_` et n'utilise pas `SUPABASE_SECRET_KEY`.
- Ne jamais exposer `SUPABASE_SECRET_KEY`, `APP_PASSWORD` ou `NEXTAUTH_SECRET` dans du code client ni les ajouter à Git. Les identifiants de connexion sont gérés par Supabase Auth; les variables `APP_*` et `NEXTAUTH_*` ne sont pas utilisées par cette application.
