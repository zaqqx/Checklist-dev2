# Checklist (HTML / CSS / JS)

Site statique + Supabase. Aucun build, aucune dépendance à installer.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Pages (connexion, liste, formulaire) |
| `style.css` | Styles |
| `app.js` | Logique + appels Supabase |
| `config.js` | URL + clé **publishable** Supabase |
| `supabase/schema.sql` | Tables + règles de sécurité (RLS) |

## Mise en place

1. **Supabase → SQL Editor** : exécuter `supabase/schema.sql`.
2. **Supabase → Authentication → Users → Add user** : créer le compte partagé (email + mot de passe).
3. **Supabase → Authentication → Providers → Email** : désactiver « Allow new users to sign up ».
4. Renseigner `config.js` (Settings → API : Project URL + publishable key).
5. Pousser sur GitHub, puis **Vercel → Add New Project** → importer le repo (Framework : *Other*, aucun build command).

## Local

```bash
npx serve .
```

## Sécurité

- La clé publishable est publique par conception : la protection vient des **RLS** (seuls les utilisateurs connectés lisent/écrivent).
- Ne jamais mettre `SUPABASE_SECRET_KEY` dans ce projet.
