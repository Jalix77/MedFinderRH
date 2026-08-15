# Phase 1A — Rapport de clôture

Statut : **CLÔTURÉE — validée après audit ciblé** (voir §16 ci-dessous pour
l'audit complémentaire demandé avant autorisation de Phase 1B, exécuté les
13-14/08/2026). Un point reste explicitement en suivi (§16.8) — accepté par
Jean Alix Pierre comme non bloquant pour la clôture.

## 1. Fonctionnalités réellement réalisées

| # (checklist Phase 1A) | Élément | Statut |
|---|---|---|
| 1 | Organisation MedFinder Haiti | ✅ créée via script de bootstrap (idempotent, testé) |
| 2 | Supabase Auth | ✅ login/logout/reset password fonctionnels |
| 3 | Bootstrap sécurisé du premier SUPER_ADMIN | ✅ `scripts/bootstrap-super-admin.mjs`, testé de bout en bout |
| 4 | Profils utilisateurs | ✅ `public.users`, auto-créés à l'inscription (trigger) |
| 5 | Memberships multi-organisation | ✅ `public.memberships` |
| 6 | Rôles | ✅ 9 rôles système seedés |
| 7 | Permissions granulaires | ✅ 64 permissions seedées |
| 8 | role_permissions | ✅ 211 associations par défaut (matrice corrigée) |
| 9 | membership_roles | ✅ many-to-many (cumul de rôles), amélioration vs Phase 0 |
| 10 | Permission overrides | ✅ `user_permission_overrides`, ALLOW/DENY testés (deny wins, expiration) |
| 11 | Stratégie RLS réelle | ✅ RLS activée sur 100% des tables, policies + grants testés |
| 12 | Journal d'audit | ✅ append-only, trigger automatique, page `/audit` |
| 13 | Paramètres organisation | ✅ page `/settings/organization`, RPC dédiée |
| 14 | Numérotation | ✅ `next_number()` RPC atomique, testée en concurrence (20/20 uniques) |
| 15 | Login/logout/reset password | ✅ pages + Server Actions |
| 16 | Shell + navigation par permission | ✅ sidebar filtrée dynamiquement par `hasPermission` |
| 17 | Dashboard Direction minimal | ✅ `/direction`, aucune donnée métier fictive |
| — | MFA (D2, "prévois l'architecture dès maintenant") | ✅ **appliqué réellement** au niveau base (pas seulement prévu) : SUPER_ADMIN/DG toujours, DT conditionnel |

Hors scope, conformément à la contrainte Phase 1A : RH métier, employés
complets, contrats, dépenses, PAPEJ, comptabilité, payroll, CRM — aucun de
ces modules n'a de table, route ni entrée de navigation.

## 2. Fichiers créés/modifiés (91 fichiers versionnés, 6 commits atomiques)

```
7eb8efe docs(security): correct role.manage/user.manage inconsistency found in Phase 0
5957026 chore(scaffold): initialize Next.js 16 app (TypeScript strict, Tailwind, MedFinder branding)
7546e57 feat(db): Phase 1A core schema — organisations, identite, RBAC, audit, MFA (Supabase)
0e2f5c9 feat(auth): bootstrap script for first SUPER_ADMIN
0be0370 feat(app): auth flows, RBAC-gated shell, dashboard, MFA UI (Phase 1A)
31fa0f3 test(phase-1a): suite unitaire + integration RLS/RBAC (35 tests, verts)
```

Détail par domaine : `app/` (pages App Router, Server Actions), `components/`
(formulaires auth/MFA, shell), `lib/` (supabase, auth/DAL, permissions,
validation), `supabase/` (14 migrations, config, seed dev), `scripts/`
(bootstrap), `tests/` (unitaires + intégration).

## 3. Migrations (14, appliquées avec succès sur Supabase local)

```
20260813100001_extensions_and_helpers.sql
20260813100002_organizations.sql
20260813100003_users_and_memberships.sql
20260813100004_roles_permissions_rbac.sql
20260813100005_audit_logs.sql
20260813100006_audit_triggers.sql
20260813100007_rbac_functions.sql
20260813100008_numbering_sequences.sql
20260813100009_admin_rpc_functions.sql
20260813100010_rls_policies.sql
20260813100011_seed_rbac_catalogue.sql
20260813100012_service_role_grants.sql
20260813100013_mfa_enforcement.sql
20260813100014_fix_function_search_path.sql
```

Reproductible via `npx supabase db reset` (vérifié 6 fois au cours de cette
phase, y compris comme étape automatique de `npm test`).

## 4. Structure DB finale (Phase 1A)

`organizations`, `users`, `memberships`, `roles`, `permissions`,
`role_permissions`, `membership_roles`, `user_permission_overrides`,
`audit_logs`, `numbering_sequences` — 10 tables, toutes avec RLS activée.
Fonctions clés : `app_private.has_permission`, `app_private.is_super_admin`,
`app_private.is_active_member`, `app_private.user_requires_mfa`,
`app_private.current_aal`, `app_private.write_audit_log`,
`app_private.audit_row_trigger`, `public.current_user_has_permission`,
`public.next_number`, `public.admin_create_membership`,
`public.admin_assign_role`, `public.admin_revoke_role`,
`public.admin_set_membership_status`, `public.admin_set_user_status`,
`public.admin_set_permission_override`,
`public.admin_update_organization_settings`.

## 5. Politiques RLS

RLS activée sur les 10 tables. Pattern : SELECT via policies (org-scoping +
permission), écriture RBAC sensible **exclusivement** via fonctions
`security definer` (aucune policy INSERT/UPDATE/DELETE pour `authenticated`
sur `roles`, `permissions`, `role_permissions`, `membership_roles`,
`user_permission_overrides`, `audit_logs`, `memberships`) — confirmé par
grants explicites (`revoke insert, update, delete ... from authenticated`)
et testé (tentative d'INSERT direct → `permission denied`, prouvé en SQL et
en intégration Vitest). Détail complet : `docs/security.md` §4,
implémentation : `supabase/migrations/20260813100010_rls_policies.sql`.

## 6. Matrice RBAC réellement implémentée

64 permissions, 9 rôles, 211 associations par défaut — voir
`supabase/migrations/20260813100011_seed_rbac_catalogue.sql` (source de
vérité base) et `lib/permissions/codes.ts` (miroir TS, synchronisation
vérifiée par test). **Correction apportée pendant l'implémentation** :
`docs/permissions-matrix.md` et `docs/security.md` étaient incohérents sur
`role.manage`/`user.manage` pour DIRECTEUR_TECHNIQUE — tranché en faveur de
`security.md` (SUPER_ADMIN + DIRECTEUR_GENERAL seuls pour `role.manage` ;
DIRECTEUR_TECHNIQUE reçoit `user.manage` pour les comptes techniques
uniquement), documenté et committé séparément (`7eb8efe`).

**Application réelle de la Décision D2 (MFA)** au niveau base de données
(pas seulement documentée) : `app_private.has_permission()` et
`app_private.is_super_admin()` exigent `AAL2` pour tout utilisateur dont le
rôle l'impose. Preuve : un SUPER_ADMIN sans MFA a `settings.manage = false` ;
après enrôlement + vérification TOTP réels sur la même session, la même
requête retourne `true` (démontré en base ET en test d'intégration
automatisé ET manuellement via l'UI dans le navigateur).

## 7. Comptes/rôles utilisés pour les tests

Seed DEV (`supabase/seed.sql`, jamais appliqué en production) :

| Compte | Rôle | Organisation | Statut |
|---|---|---|---|
| super.demo@medfinder.test | SUPER_ADMIN | Org A | active |
| dg.demo@medfinder.test | DIRECTEUR_GENERAL | Org A | active |
| dt.demo@medfinder.test | DIRECTEUR_TECHNIQUE | Org A | active |
| comptable.demo@medfinder.test | COMPTABLE | Org A | active |
| rh.demo@medfinder.test | RH | Org A | active |
| manager.demo@medfinder.test | MANAGER | Org A | active |
| agent.demo@medfinder.test | AGENT_TERRAIN | Org A | active |
| support.demo@medfinder.test | SUPPORT | Org A | active |
| employe.demo@medfinder.test | EMPLOYE | Org A | active |
| suspendu.demo@medfinder.test | EMPLOYE | Org A | **suspended** |
| orgb.demo@medfinder.test | DIRECTEUR_GENERAL | Org B | active |

Mot de passe commun (local uniquement, documenté en clair dans
`supabase/seed.sql` avec avertissement) : `DemoPass#2026`. Tous les 9 rôles
+ le cas suspendu + l'isolation cross-org ont été exercés soit par test
automatisé, soit manuellement via le navigateur (SUPER_ADMIN, cycle complet
login → MFA → dashboard → gestion utilisateurs → audit).

Bootstrap réel (hors seed) : organisation « MedFinder Haiti » +
`dg@medfinderhaiti.com` (SUPER_ADMIN) créés avec succès via
`scripts/bootstrap-super-admin.mjs`.

## 8. Commandes exécutées et résultats

```bash
npx supabase start                 # stack local (Postgres 17, Auth, Storage, Studio)
npx supabase db reset              # 14 migrations + seed dev — OK, 0 erreur
node scripts/bootstrap-super-admin.mjs --email dg@medfinderhaiti.com --name "Jean Alix Pierre"
                                    # OK — organisation + SUPER_ADMIN créés, idempotent verifié
npx tsc --noEmit                   # OK — 0 erreur
npm run lint                       # OK — 0 erreur, 0 avertissement (apres exclusion supabase/.temp)
npm run build                      # OK — build production Next.js reussi (14 routes)
npx supabase db lint               # OK — "No schema errors found"
npm test                           # OK — 6 fichiers, 35 tests, 0 echec
```

### Résultat TypeScript
`npx tsc --noEmit` → **0 erreur** (mode `strict: true`).

### Résultat lint
`npm run lint` (ESLint flat config, `eslint-config-next`) → **0 erreur, 0
avertissement** sur le code du projet (le linter listait initialement des
erreurs dans `supabase/.temp/` — fichiers générés par le CLI Supabase, non
du code source — corrigé en excluant ce dossier de la configuration).

### Résultat build
`npm run build` → **succès**, 14 routes générées (`/`, `/login`,
`/reset-password`, `/update-password`, `/mfa/verify`, `/auth/callback`,
`/direction`, `/audit`, `/settings/organization`, `/settings/security`,
`/settings/users`, `/_not-found`, Proxy). TypeScript et bundling Turbopack
sans erreur.

### Résultat tests
`npm test` → **35/35 tests verts** (2 fichiers unitaires, 4 fichiers
d'intégration exécutés contre une base Supabase locale réellement
réinitialisée). Détail : isolation multi-org, utilisateur suspendu, absence
de privilège frontend-only, matrice RBAC (6 rôles non-MFA testés
directement + SUPER_ADMIN/DG/DT testés sous contrainte MFA), cycle MFA
complet avec code TOTP réellement calculé et vérifié, overrides
ALLOW/DENY (deny wins, expiration), numérotation atomique (20 appels
concurrents → 20 numéros uniques).

### Supabase Security Advisors
Consulté dans Supabase Studio (`/project/default/advisors/security`) :
**0 erreur**. 12 avertissements initiaux → **9 après correction** :
- 3× *Function Search Path Mutable* (`set_updated_at`, `validate_membership_role`,
  `current_aal`) → **corrigés** (migration `20260813100014`).
- 9× *Signed-In Users Can Execute SECURITY DEFINER Function* sur les RPC
  `admin_*`, `current_user_has_permission`, `next_number` → **revus,
  intentionnels** : ce sont précisément les points d'entrée conçus pour
  être appelés par des utilisateurs authentifiés, avec l'autorisation
  vérifiée à l'intérieur de chaque fonction (voir migration
  `20260813100009`, en-tête explicative). Les convertir en
  `SECURITY INVOKER` casserait leur fonction (elles doivent contourner les
  `REVOKE` de table pour ces écritures RBAC sensibles, par design).

## 9. Vulnérabilités ou avertissements restants

- Les 9 avertissements Security Advisor ci-dessus (revus, sans action
  requise).
- Aucune vulnérabilité `npm audit` (0 à chaque installation).
- Aucun secret détecté dans le dépôt (`git grep` sur motifs JWT/service_role
  côté code source suivi par git — uniquement dans `scripts/bootstrap-super-admin.mjs`
  et `tests/integration/helpers.ts`, tous deux lisant `process.env`, jamais
  de valeur en dur ; `.env.local` gitignoré et jamais apparu dans
  `git status`).

## 10. Dette technique

| Sujet | Détail | Action recommandée |
|---|---|---|
| Node.js 20 vs 22 | `@supabase/supabase-js` avertit (dépréciation) et **exige** un polyfill `WebSocket` (`ws`) sur Node < 22 pour fonctionner du tout — corrigé par polyfill dans le script de bootstrap, les tests, et implicitement disponible côté app si nécessaire. | Standardiser l'équipe/déploiement sur Node 22 LTS avant la Phase 2 ; Vercel le supporte nativement. |
| UX erreurs Server Actions (`/settings/users`) | Les actions RPC échouées lèvent une exception simple (error boundary générique Next.js) plutôt qu'un message inline précis. | Ajouter un retour structuré + `useActionState` par ligne en Phase 1B, une fois le volume d'utilisation réel connu. |
| MFA — enforcement UI vs DB | L'UI n'empêche pas la navigation vers une page nécessitant MFA (juste une bannière) ; **la protection réelle est en base** (`has_permission` refuse tout sans AAL2), donc aucune donnée n'est exposée, seule l'UX pourrait être plus stricte. | Optionnel : garde stricte au niveau layout en Phase 1B si jugé utile. |
| `numbering_sequences` sans UI dédiée | Le moteur est construit et testé (RPC atomique), mais aucune entité métier ne le consomme encore (aucune n'existe en Phase 1A). | Consommer dès la Phase 1B (dépenses : `DEP-2026-0001`). |
| Rôles personnalisés par organisation | Le schéma le permet (`roles.organization_id` nullable + index partiels) mais seuls les 9 rôles système sont utilisés. | Non nécessaire avant qu'une 2ᵉ entité juridique existe (hors scope actuel). |

## 11. Risques restants (reportés de `docs/roadmap.md`, statut mis à jour)

- Équipe réduite exécutant plusieurs rôles de séparation des fonctions :
  mécanisme d'exception tracée conçu (D7) mais pas encore exercé en usage
  réel (aucun workflow de dépense n'existe encore en Phase 1A).
- Conditions FDI réelles toujours non fournies (D6) — sans impact Phase 1A
  (aucune table `loans` encore créée).
- Sous-domaine `gestion.medfinderhaiti.com` (D8) — DNS non configuré, ne
  bloque pas le développement local ; à faire avant mise en production.

## 12. Points nécessitant validation utilisateur avant Phase 1B

1. Le mécanisme d'auto-élévation actuel exempte `SUPER_ADMIN` de
   l'interdiction de self-service sur ses propres rôles (un SUPER_ADMIN
   peut se ré-assigner un rôle à lui-même ; un DIRECTEUR_GENERAL ne le peut
   pas) — confirmer que ce choix est voulu.
2. Mot de passe minimum relevé à 10 caractères + complexité
   (`lower_upper_letters_digits`) au niveau Supabase Auth local — à
   répliquer identiquement sur le projet Supabase cloud (staging/prod) lors
   de leur création.
3. Le module Analytics/Logflare de Supabase local a été désactivé (charge
   mémoire Docker) — sans impact fonctionnel Phase 1A ; à réactiver
   uniquement si des tableaux de bord d'observabilité Supabase natifs sont
   souhaités plus tard.

## 13. Commit Git

```
31fa0f3 test(phase-1a): suite unitaire + integration RLS/RBAC (35 tests, verts)
0be0370 feat(app): auth flows, RBAC-gated shell, dashboard, MFA UI (Phase 1A)
0e2f5c9 feat(auth): bootstrap script for first SUPER_ADMIN
7546e57 feat(db): Phase 1A core schema — organisations, identite, RBAC, audit, MFA (Supabase)
5957026 chore(scaffold): initialize Next.js 16 app (TypeScript strict, Tailwind, MedFinder branding)
7eb8efe docs(security): correct role.manage/user.manage inconsistency found in Phase 0
71e6015 docs(architecture): Phase 0 — conception complete du projet MedFinder Gestion
```

## 14. Statut Git final

`git status` → **propre** (aucun fichier non suivi, non indexé, ni
modification en attente). 91 fichiers versionnés. Aucun secret, aucune
valeur `service_role`, aucune clé privée dans l'historique.

## 15. Prochaine phase

**Phase 1B** (proposition, à confirmer) : Employés, départements, postes,
contrats, documents RH — premier module métier consommant réellement la
numérotation (`EMP-0001`), les permissions `employee.*`, et posant les
bases du module Dépenses/PAPEJ (Phase 1C) prévu par `docs/roadmap.md`.
Conformément à la règle absolue du prompt maître, la Phase 1B ne
commencera qu'après validation explicite de ce rapport.

---

## 16. Audit ciblé pré-validation (demande explicite du 13/08/2026)

Aucune fonctionnalité métier n'a été ajoutée pendant cet audit — uniquement
des vérifications, des tests, et 2 corrections de durcissement identifiées
par l'audit lui-même (migrations `20260813100015` et `20260813100016`).

### 16.1 — Les 9 avertissements Security Advisor, en détail

Tous relèvent de la même catégorie : *"Signed-In Users Can Execute SECURITY
DEFINER Function"*. Pour chacune, le mécanisme d'autorisation interne et le
test négatif qui prouve qu'un acteur non autorisé ne peut pas l'exploiter :

| Fonction | Mécanisme d'autorisation interne | Test négatif |
|---|---|---|
| `current_user_has_permission(org, perm)` | Toujours évaluée pour `auth.uid()` uniquement (jamais un `user_id` fourni par l'appelant) → aucun IDOR possible ; renvoie `false` pour un non-membre. | `tests/integration/rls-rbac.test.ts` (suspendu → `false`) ; `tests/integration/security-definer-audit.test.ts` (anon → refusé après correctif §16.9) |
| `next_number(org, entity_type)` | `app_private.is_active_member(auth.uid(), org)` sinon exception. | `tests/integration/numbering.test.ts` ("refuse un appel... pas membre") |
| `admin_create_membership(org, email, role)` | `is_super_admin(actor)` OU `has_permission(actor, org, 'user.manage')`, sinon `not_authorized` + audit `denied`. | `tests/integration/security-definer-audit.test.ts` (EMPLOYE → `not_authorized`) |
| `admin_assign_role(membership, role)` | Idem + `role.manage` ; bloque l'auto-élévation sauf SUPER_ADMIN (§7). | `security-definer-audit.test.ts`, `admin-negative.test.ts` (MANAGER/COMPTABLE), `mfa-enforcement.test.ts` (DG avec MFA) |
| `admin_revoke_role(membership, role)` | Identique à `admin_assign_role`. | `security-definer-audit.test.ts` (EMPLOYE → `not_authorized`) |
| `admin_set_membership_status(membership, status)` | `is_super_admin` OU `has_permission(actor, org, 'user.manage')`. | `security-definer-audit.test.ts`, `admin-negative.test.ts` (suspendu ne peut pas se réactiver lui-même ; contrôle positif : un admin autorisé le peut) |
| `admin_set_user_status(target, org, status)` | Idem + `is_active_member(target, org)` + blocage auto-action. | `security-definer-audit.test.ts` (EMPLOYE → `not_authorized`) |
| `admin_set_permission_override(target, org, perm, effect, reason)` | `is_super_admin` OU `has_permission(actor, org, 'permission.override')` + (depuis §16.2) `is_active_member(target, org)`. | `security-definer-audit.test.ts` (EMPLOYE → `not_authorized` ; cible hors organisation → `target_not_active_member`) |
| `admin_update_organization_settings(org, ...)` | `is_super_admin` OU `has_permission(actor, org, 'settings.manage')`. | `security-definer-audit.test.ts`, `admin-negative.test.ts` (changement d'organisation, AAL1) |

Ces fonctions sont *intentionnellement* `SECURITY DEFINER` et exposées : leur
`REVOKE FROM public/anon` + `GRANT TO authenticated` + contrôle interne
systématique est le mécanisme de protection lui-même (voir en-tête de
`20260813100009_admin_rpc_functions.sql`) — les convertir en
`SECURITY INVOKER` casserait leur fonction, puisqu'elles doivent contourner
les `REVOKE` de table appliqués aux rôles applicatifs.

### 16.2 — Audit des fonctions `admin_*` / `SECURITY DEFINER`

| Critère | Résultat |
|---|---|
| `search_path` explicite sur toutes les fonctions `SECURITY DEFINER` | ✅ Vérifié par `grep` systématique (voir `supabase/migrations/*.sql`). 3 fonctions non-`SECURITY DEFINER` en manquaient (`set_updated_at`, `validate_membership_role`, `current_aal`) → **corrigé** (`20260813100014`, déjà dans le rapport initial). |
| `EXECUTE` révoqué à `PUBLIC` si non nécessaire | ✅ Les 9 RPC publiques : `revoke all ... from public` présent dès l'origine. **Trouvaille de l'audit** : `anon` recevait un grant *séparé* de `PUBLIC` sur le projet cloud (absent en local) → **corrigé** (`20260813100016`, revoke explicite sur `anon` + `alter default privileges`). Les fonctions `app_private.*` n'avaient aucun `revoke` explicite (protégées uniquement par l'exclusion de schéma de l'API) → **durci** (`20260813100015`). |
| Accès `anon` interdit | ✅ après `20260813100016` (testé : `tests/integration/security-definer-audit.test.ts`, 9/9 RPC refusées à `anon`, exécuté en local dès Phase 1A, puis **rejoué avec succès contre le cloud le 14/08/2026** pendant la clôture de Phase 1B — voir §16.8 mis à jour). |
| Contrôle `auth.uid()` | ✅ Chaque fonction capture `v_actor := auth.uid()` en tout premier et l'utilise pour toute décision — jamais un identifiant fourni par le client pour représenter l'acteur. |
| Contrôle membership active | ✅ Via `is_active_member` (direct ou indirect par `has_permission`) pour l'acteur systématiquement ; pour la cible, ajouté explicitement à `admin_set_user_status` (déjà présent) et **ajouté par l'audit** à `admin_set_permission_override` (`20260813100015`, testé par `security-definer-audit.test.ts`). |
| Contrôle organisation | ✅ Chaque fonction re-transmet le même `org_id` à `has_permission`/`write_audit_log` ; aucune fuite cross-org trouvée (testé explicitement : `admin-negative.test.ts` "changement d'organisation"). |
| Contrôle permission | ✅ Chaque fonction vérifie la permission nommée exacte avant toute écriture (table ci-dessus). |
| Absence de confiance dans `user_metadata` | ✅ Seul usage trouvé : `raw_user_meta_data->>'full_name'` dans `handle_new_auth_user`, pour le nom d'affichage uniquement — jamais utilisé dans une décision d'autorisation (`grep` exhaustif sur `meta_data` dans `supabase/migrations/`, un seul résultat, non sécuritaire). |

### 16.3 — Vérification `service_role`

| Vérification | Résultat |
|---|---|
| Occurrence dans le code client (`app/`, `components/`, `lib/supabase/client.ts`) | Aucune — uniquement des commentaires explicites ("jamais service_role"). |
| Variable `NEXT_PUBLIC_*` contenant la clé | Aucune — seules `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` existent. |
| Logs | Le script de bootstrap logue un mot de passe *temporaire généré aléatoirement* une seule fois par conception (transmission hors-bande) — jamais la clé `service_role` elle-même. |
| Fichier suivi par Git | Aucun — `git grep "eyJhbGci"` (motif JWT) sur l'historique suivi : 0 résultat. `.env.local`/`.env.staging` gitignorés et jamais apparus dans `git status`. |
| Confiné à scripts/tests serveur | ✅ Seuls `scripts/bootstrap-super-admin.mjs`, `scripts/seed-cloud-verification.mjs` et `tests/integration/helpers.ts` la lisent, tous via `process.env`. |

### 16.4 — Export et comparaison de la matrice RBAC

Comptages exacts (requête directe, local et cloud identiques) : **9 rôles,
64 permissions, 211 associations `role_permissions`**.

Comparaison ligne à ligne entre l'export SQL réel et `docs/permissions-matrix.md`
§3 : **aucun écart** sur les ~35 lignes déjà documentées lors de la Phase 1A
initiale. **Écart trouvé** : le tableau ne couvrait que 35 des 64
permissions (les 29 restantes — `attendance.manage`, `leave.request`,
`expense.view`, `budget.view/transfer`, `accounting.view`,
`treasury.reconcile`, `papej.report`, `donation.view/allocate/close/report`,
`grant.view`, `restricted_fund.manage`, `loan.view`, `customer.manage`,
`asset.view`, `advance.request/approve`, `crm.view_all`, `document.upload`,
`employee.view/terminate`, `permission.override` — étaient seedées mais non
documentées dans le résumé). **Corrigé** : `docs/permissions-matrix.md` §3
couvre maintenant les 64/64 permissions, généré directement depuis l'export
DB (voir le fichier pour la table complète).

### 16.5 — Vérifications de cloisonnement (rôle par rôle)

Toutes vérifiées par `tests/integration/role-scoping.test.ts` (7 tests, verts) :

| Vérification demandée | Résultat |
|---|---|
| DIRECTEUR_TECHNIQUE ne voit aucun salaire sans permission explicite | ✅ `employee.view_salary = false` par défaut |
| SUPPORT ne voit aucune donnée comptable | ✅ `accounting.post/view`, `treasury.manage`, `budget.view`, `papej.view`, `donation.view` tous `false` |
| COMPTABLE ne peut pas modifier rôles/permissions | ✅ `role.manage`, `user.manage`, `permission.override` tous `false` |
| RH ne voit les rémunérations que si autorisée | ✅ `employee.view_salary = false` par défaut, `payroll.view_all = true` (distinction traitement paie vs consultation individuelle) ; `true` après override explicite testé, retiré après suppression de l'override |
| AGENT_TERRAIN reste limité à son périmètre | ✅ `crm.view_own = true`, `crm.view_all/manage = false`, `employee.view_salary = false`, `accounting.post = false` (cloisonnement au niveau permission confirmé ; le cloisonnement au niveau ligne de données CRM sera testé quand les tables CRM existeront, Phase 4) |
| EMPLOYE reste limité à ses propres données autorisées | ✅ `payroll.view_own/leave.request = true`, tout le reste `false` ; **durcissement trouvé et corrigé** : `users_select` exposait `phone`/`mfa_enabled`/`status` de tout collègue actif — restreint à soi-même + `user.manage`/`role.manage` (`20260813100015`, testé) |

### 16.6 — Opérations d'administration sensibles

Tous testés (`tests/integration/admin-negative.test.ts`,
`mfa-enforcement.test.ts`, `permission-overrides.test.ts`) :

| Scénario | Résultat |
|---|---|
| Auto-élévation DG | Refusée (`self_elevation_blocked` si MFA vérifié ; `not_authorized` sinon, puisque `role.manage` lui-même exige AAL2) |
| Auto-élévation MANAGER | Refusée (`not_authorized` — ne détient pas `role.manage`) |
| Auto-élévation COMPTABLE | Refusée (`not_authorized` — ne détient pas `role.manage`) |
| Changement d'organisation | Un utilisateur de l'org A ne peut pas administrer l'org B (`not_authorized`, donnée cible inchangée vérifiée) |
| Membership suspendue | Le compte suspendu ne peut rien administrer (`not_authorized`) ; contrôle positif : un admin autorisé PEUT réactiver un compte suspendu |
| Override DENY | `deny` toujours prioritaire, y compris face à un `grant` concurrent ou un grant de rôle par défaut ; expiration effective (`permission-overrides.test.ts`, 5 tests) |
| Token AAL1 alors qu'AAL2 requis | Refusé sur `current_user_has_permission` **et** sur les RPC `admin_*` elles-mêmes (pas seulement le helper de lecture) |

### 16.7 — Politique SUPER_ADMIN

Documentée précisément dans `docs/security.md` §12 (nouvelle section) :
SUPER_ADMIN est le seul rôle exempté de l'interdiction d'auto-modification
(raison : rôle de dernier recours, aucun autre rôle ne peut le débloquer),
mais uniquement si sa session a franchi AAL2 — sinon `has_permission`
renvoie `false` avant toute logique métier. Aucune action admin_* ne peut
aboutir silencieusement : succès et refus produisent systématiquement une
ligne `audit_logs` (`tests/integration/audit-completeness.test.ts`, 2 tests
verts, incluant la vérification directe du contenu de la ligne d'audit
produite par un refus d'auto-élévation).

### 16.8 — Rejeu sur projet Supabase cloud dédié

Projet cloud créé par Jean Alix Pierre (`qwydgqheceglulfxwtgo.supabase.co`,
région us-east-2), dédié à cette vérification.

**Réalisé et confirmé sur le cloud :**
- 15 migrations (`20260813100001` à `...100015`) appliquées et confirmées
  (`supabase migration list` : local = remote).
- Comptages RBAC identiques au local (9 rôles / 64 permissions / 211
  associations), vérifiés par requêtes REST directes.
- Isolation multi-organisation confirmée par requêtes directes.
- **52 tests d'intégration passés sur le cloud**, dont l'intégralité de
  `mfa-enforcement.test.ts` (cycle MFA/AAL2 réel — enrôlement TOTP,
  vérification, franchissement AAL2, blocage d'auto-élévation même
  authentifié MFA), `numbering.test.ts`, `role-scoping.test.ts` et
  `audit-completeness.test.ts`.
- Comptes de démonstration recréés sur le cloud via l'API Admin
  (`scripts/seed-cloud-verification.mjs`, sans dépendance à `psql`/Docker).
- **Une trouvaille réelle** grâce à ce rejeu (absente des vérifications
  locales) : `current_user_has_permission` restait exécutable par le rôle
  `anon` sur le cloud (réponse `false` — pas de fuite de données, mais
  l'appel n'était pas rejeté). Cause probable : le template de projet
  Supabase Cloud accorde `anon` séparément du pseudo-rôle `PUBLIC`, que le
  `revoke ... from public` initial ne couvrait pas. Migration corrective
  écrite et **vérifiée en local** (`20260813100016`).

**Point en suivi — RÉSOLU le 14/08/2026 (mise à jour rétroactive, voir
`docs/phase-1b-closing-report.md` §9) :** la migration `20260813100016`
n'avait pas pu être poussée vers le cloud au moment de la clôture initiale
de Phase 1A. Cause identifiée avec certitude : le projet cloud n'expose de
connexion Postgres directe qu'en IPv6 (confirmé par résolution DNS —
`db.<ref>.supabase.co` n'a aucun enregistrement A, uniquement AAAA), et ni
l'environnement d'exécution de Claude ni le réseau de Jean Alix Pierre ne
disposent d'une route IPv6 vers Supabase. Le contournement recommandé (pooler
IPv4 `aws-0-us-east-2.pooler.supabase.com`) a été tenté sur les deux
réseaux (ports 5432 et 6543, avec et sans `sslmode=require`) : échecs
incohérents (`Connection terminated unexpectedly` / `Connection timed out`)
suggérant un blocage ou une instabilité réseau (pare-feu/antivirus/ISP) sur
port non-HTTPS, indépendant du code ou de la configuration Supabase.
Contournement finalement retenu, pendant la vérification finale de
Phase 1B (Docker local devenu indisponible par ailleurs) : Jean Alix
Pierre a appliqué `20260813100016`, avec les 8 migrations Phase 1B, via
l'éditeur SQL du dashboard Supabase cloud (connexion HTTPS authentifiée,
aucune route Postgres directe requise). Rejeu fonctionnel confirmé :
54 tests d'intégration verts contre ce projet cloud après application,
dont `security-definer-audit.test.ts` qui exerce directement le
comportement corrigé par cette migration. **Ce suivi est donc clos.**

### 16.9 — Corrections apportées pendant l'audit

| Migration | Contenu |
|---|---|
| `20260813100015_audit_hardening.sql` | (1) Restreint `users_select` (phone/mfa_enabled/status non exposés aux simples collègues) ; (2) ajoute la validation "cible membre actif" à `admin_set_permission_override` ; (3) révoque `EXECUTE` sur `app_private.*` pour `public`/`anon`/`authenticated`, avec re-grant cible sur les 3 fonctions réellement appelées par les policies RLS (`is_super_admin`, `is_active_member`, `has_permission`) — **régression auto-détectée et corrigée dans le même cycle** : le premier essai de ce durcissement avait cassé toutes les policies RLS pour `authenticated` (`permission denied for function is_super_admin`), repéré immédiatement par la suite de tests (7 échecs), corrigé, 69/69 tests verts ensuite. |
| `20260813100016_fix_anon_rpc_grant.sql` | Révoque explicitement `anon` (pas seulement `PUBLIC`) sur les 9 RPC publiques + durcit les privilèges par défaut du schéma `public`. Trouvaille du rejeu cloud (§16.8). Appliquée et vérifiée en local dès Phase 1A ; **appliquée et vérifiée en cloud le 14/08/2026** pendant la clôture de Phase 1B (voir §16.8 mis à jour et `docs/phase-1b-closing-report.md` §9). |

### 16.10 — Vérifications finales rejouées (14/08/2026)

```
npm test          # 10 fichiers, 71 tests, 0 echec
npm run typecheck  # 0 erreur
npm run lint       # 0 erreur, 0 avertissement
npm run build      # succes, 14 routes
npx supabase db lint            # "No schema errors found"
Security Advisor (Studio local) # 0 erreur, 9 avertissements (revus §16.1)
git grep "eyJhbGci"             # 0 resultat (aucun secret suivi par Git)
git status                      # propre apres commit de cet audit
```

### 16.11 — Nouveaux fichiers de cet audit

`supabase/migrations/20260813100015_audit_hardening.sql`,
`supabase/migrations/20260813100016_fix_anon_rpc_grant.sql`,
`scripts/seed-cloud-verification.mjs` (seed de vérification cloud sans
dépendance psql/Docker, réutilisable pour un futur rejeu),
`tests/integration/security-definer-audit.test.ts`,
`tests/integration/role-scoping.test.ts`,
`tests/integration/admin-negative.test.ts`,
`tests/integration/audit-completeness.test.ts`, modifications à
`docs/security.md` (§12), `docs/permissions-matrix.md` (§3 complet),
`tests/integration/mfa-enforcement.test.ts` (cleanup `try/finally` anti-
cascade sur les tests MFA suivants).

### 16.12 — Conclusion de l'audit

Tous les points 1 à 7, 9 et 10 de la demande sont clos avec preuves. Le
point 8 est clos pour sa part locale/vérifiable (migrations 1-15 + tests
étendus sur le cloud réel) ; sa part restante (migration 16 sur le cloud)
est un suivi explicite accepté par Jean Alix Pierre, non bloquant pour la
clôture de Phase 1A ni pour l'ouverture de Phase 1B, mais bloquant avant
tout usage réel de ce projet cloud spécifique.

**Phase 1A est déclarée définitivement validée.** Phase 1B ne commence
qu'après autorisation explicite de Jean Alix Pierre.
