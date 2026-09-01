# MedFinder Gestion — Mise en place de l'environnement de PRODUCTION

Document opératoire. Aucun secret n'y figure : seuls les **noms** de variables
et l'endroit où en obtenir la valeur.

**Décision fondatrice.** Le projet Supabase `qwydgqheceglulfxwtgo` devient
officiellement l'environnement **test/développement**. Il n'est pas nettoyé et
ne sera pas promu en production : 662 de ses 1840 écritures comptables sont
marquées `[TEST-FIXTURE]` et **définitivement immuables**, y compris via
`service_role`, et la suite d'intégration continue d'y écrire. La production
part d'un **projet neuf et vierge**.

---

## 1. Migrations à appliquer, dans l'ordre

**59 migrations**, dans l'ordre lexicographique du nom de fichier — c'est
exactement l'ordre d'application du CLI Supabase. Ne pas en réordonner ni en
omettre : plusieurs sont des correctifs qui dépendent de l'état laissé par la
précédente.

```
 1  20260813100001_extensions_and_helpers.sql
 2  20260813100002_organizations.sql
 3  20260813100003_users_and_memberships.sql
 4  20260813100004_roles_permissions_rbac.sql
 5  20260813100005_audit_logs.sql
 6  20260813100006_audit_triggers.sql
 7  20260813100007_rbac_functions.sql
 8  20260813100008_numbering_sequences.sql
 9  20260813100009_admin_rpc_functions.sql
10  20260813100010_rls_policies.sql
11  20260813100011_seed_rbac_catalogue.sql
12  20260813100012_service_role_grants.sql
13  20260813100013_mfa_enforcement.sql
14  20260813100014_fix_function_search_path.sql
15  20260813100015_audit_hardening.sql
16  20260813100016_fix_anon_rpc_grant.sql
17  20260814090001_hr_permissions_catalogue.sql
18  20260814090002_numbering_defaults.sql
19  20260814090003_departments_positions.sql
20  20260814090004_employees.sql
21  20260814090005_contracts.sql
22  20260814090006_employee_documents.sql
23  20260814090007_hr_audit_triggers.sql
24  20260814090008_fix_app_private_grants.sql
25  20260815090001_privilege_audit_helper.sql
26  20260815090002_accounting_core.sql
27  20260815090003_treasury.sql
28  20260815090004_budget.sql
29  20260815090005_expenses.sql
30  20260815090006_papej.sql
31  20260815090007_fix_budget_line_available_grant.sql
32  20260815090008_fix_expense_number_trigger.sql
33  20260815090009_fix_grant_amount_received_protection.sql
34  20260816090010_fix_expense_creator_line_visibility.sql
35  20260816090011_papej_report_org_fields.sql
36  20260816090012_scope_expense_creator_budget_visibility.sql
37  20260816090013_security_advisor_style_checks.sql
38  20260816090014_fix_search_path_trigger_functions.sql
39  20260816090015_debug_dump_policies.sql
40  20260816090016_fix_auth_rls_initplan.sql
41  20260818090001_manual_journal_entries.sql
42  20260818090002_chart_of_accounts_seed_and_immutability.sql
43  20260818090003_fix_manual_entry_sod_bypass.sql
44  20260818090004_fix_manual_entry_reversal_guard.sql
45  20260823090001_financial_statement_reports.sql
46  20260823090002_fix_balance_sheet_unaffected_result_scope.sql
47  20260824090001_fix_search_path_chart_of_accounts_trigger.sql
48  20260825090001_third_parties.sql
49  20260825090002_expense_requests_supplier_link.sql
50  20260826090001_invoicing_documents.sql
51  20260826090002_invoicing_document_rpcs.sql
52  20260827090001_invoice_accounting_posting.sql
53  20260827090002_fix_post_document_helper_return.sql
54  20260828090001_customer_payments.sql
55  20260828090002_fix_payment_link_immutability.sql
56  20260828090003_payment_links_set_at_insert.sql
57  20260829090001_customer_statement_report.sql
58  20260830090001_bank_reconciliation.sql
59  20260830090002_bank_reconciliation_fix_uuid_aggregate.sql
```

Application :

```bash
supabase link --project-ref <REF_DU_NOUVEAU_PROJET>
```

```bash
supabase db push
```

À vérifier immédiatement après :

- les migrations 58 et 59 se terminent par un bloc `DO $verify$` qui **annule
  la transaction** si le résultat n'est pas réellement en place. Deux `NOTICE`
  attendus : `OK : Phase 2D (rapprochement bancaire) appliquee et verifiee.`
  puis `OK : correctif Phase 2D (agregat uuid) applique et verifie.` ;
- `supabase migration list` doit montrer 59 lignes appliquées, sans écart entre
  local et distant.

> **`supabase/seed.sql` ne doit JAMAIS être exécuté sur ce projet.** Il crée
> deux organisations de démonstration et neuf comptes partageant un mot de
> passe fixe. Il n'est chargé que par `supabase db reset` / `supabase start` en
> local, via `supabase/config.toml`. Aucune commande de ce document ne
> l'invoque.

---

## 2. Variables d'environnement de production

À renseigner dans **Vercel → Settings → Environment Variables**, portée
`Production`. Aucune valeur ne figure ici.

| Variable | Où obtenir la valeur | Exposée au navigateur |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | oui |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → clé `anon` / `publishable` | oui |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → clé `service_role` | **non — jamais** |
| `NEXT_PUBLIC_APP_URL` | domaine de production (ex. `https://gestion.medfinderhaiti.com`) | oui |

Règles non négociables :

- `SUPABASE_SERVICE_ROLE_KEY` contourne toute RLS. Elle ne doit jamais porter
  le préfixe `NEXT_PUBLIC_`, jamais apparaître dans un composant client, jamais
  être committée. Elle n'est utilisée que par les Server Actions et les scripts
  d'administration lancés à la main.
- **`NODE_TLS_REJECT_UNAUTHORIZED` ne doit exister dans aucun environnement
  Vercel.** Elle est présente dans le `.env.local` de développement avec la
  valeur `0`, ce qui désactive la vérification des certificats TLS. Vérifier
  explicitement son absence en production.
- `NEXT_PUBLIC_APP_URL` doit correspondre exactement au domaine servi, sinon
  les liens de réinitialisation de mot de passe pointeront ailleurs.
- Ne pas réutiliser les clés du projet de test. Ce sont deux projets distincts.

Côté Supabase → Authentication → URL Configuration :

- `Site URL` = le domaine de production ;
- `Redirect URLs` = au minimum `<domaine>/auth/callback` et
  `<domaine>/update-password`.

---

## 3. Données minimales à créer

L'ordre compte : chaque étape dépend de la précédente.

### 3.1 Organisation réelle + premier SUPER_ADMIN — automatisé

Un seul script fait les deux, et il ne s'exécute jamais automatiquement :

Bash :

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<cle> node scripts/bootstrap-super-admin.mjs --email <votre-email> --name "Jean Alix Pierre"
```

PowerShell — les variables doivent être posées séparément, puis **effacées de
la session** : contrairement au préfixe Bash ci-dessus, qui ne les expose que
le temps de la commande, `$env:` les laisse en mémoire pour tout le reste de
la session, y compris pour les commandes suivantes et l'historique.

```powershell
$env:SUPABASE_URL = '<url>'; $env:SUPABASE_SERVICE_ROLE_KEY = '<cle>'; node scripts/bootstrap-super-admin.mjs --email <votre-email> --name "Jean Alix Pierre"; Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY
```

Le `Remove-Item` s'exécute même si le script échoue, les commandes étant
chaînées par `;`. Fermer la fenêtre ensuite reste la garantie la plus simple.

Il crée l'organisation `MedFinder Haiti`, crée le compte Auth s'il n'existe
pas, force le changement de mot de passe à la première connexion, et assigne
le rôle `SUPER_ADMIN`. Le mot de passe temporaire est généré aléatoirement et
**affiché une seule fois à l'écran** — jamais écrit dans un fichier. Le
transmettre hors bande et le changer à la première connexion.

Le nom d'organisation par défaut est `MedFinder Haiti` ; l'option `--org`
permet d'en choisir un autre.

**Provisionné automatiquement par trigger à la création de l'organisation** —
rien à faire :

- **plan comptable** — 19 comptes (`app_private.seed_default_chart_of_accounts`) ;
- **journaux comptables** (`CASH`, `BANK`, `MISC`, …) ;
- **séquences de numérotation** (factures, dépenses, écritures).

Les 19 comptes couvrent déjà les besoins du démarrage, notamment
`1000 Caisse`, `1010 Banque`, `1020 Mobile Money`, `2200 Emprunt FDI`,
`3000 Capital / Apport fondateurs` et `6200 Charges financières — intérêts FDI`.

### 3.2 Rôles

**Rien à créer.** Le catalogue RBAC (9 rôles et l'ensemble des permissions) est
posé par les migrations 11 et 17. Les rôles s'**attribuent** ensuite aux
utilisateurs depuis `/settings/users`.

### 3.3 Utilisateurs réels

Depuis `/settings/users`, connecté en SUPER_ADMIN. Pour chaque personne :
adresse professionnelle réelle, rôle unique et minimal.

Principes à tenir :

- **aucune adresse `@medfinder.test`** en production — ce domaine identifie les
  comptes de démonstration ;
- **aucun mot de passe partagé** entre comptes ;
- respecter les séparations de fonctions déjà imposées par le moteur : le
  créateur d'une facture ne peut pas l'émettre, le proposant d'un
  rapprochement ne peut pas le valider, l'approbateur d'une dépense ne peut pas
  la payer. **Il faut donc au minimum deux personnes distinctes** sur la chaîne
  financière, sinon ces workflows sont bloqués par conception.

### 3.4 Exercice fiscal et période comptable ouverte

Depuis `/comptabilite`, section « Exercices et périodes comptables » :

1. créer l'exercice (par exemple `2026-01-01` → `2026-12-31`) ;
2. créer la période mensuelle du **mois en cours**, statut `open`.

**Point critique, à ne pas oublier chaque mois.** Sans période ouverte couvrant
la date d'une opération, l'émission de facture, l'encaissement, le paiement de
dépense et la validation de rapprochement échouent tous avec
`no_accounting_period`. Ce n'est pas un défaut : c'est la garde de période. En
pratique, ouvrir les périodes de l'exercice à l'avance évite l'interruption.

### 3.5 Comptes de trésorerie

Depuis `/tresorerie` : créer les comptes **caisse**, **banque** et
**mobile money** réellement utilisés, chacun rattaché à son compte du plan
comptable (`1000`, `1010`, `1020`) et à sa devise (HTG ou USD).

Le solde s'initialise à zéro : il ne se saisit pas ici, il se constitue à
l'étape 3.7.

### 3.6 Budget initial

Depuis `/budget` : créer le budget rattaché à l'exercice, puis ses lignes.
Nécessaire avant toute dépense engagée sur budget.

### 3.7 Prêt et soldes d'ouverture

Les deux passent par le même mécanisme — `/papej`, « + Nouveau financement » —
qui crée en une opération atomique le mouvement de trésorerie, la mise à jour
du solde du compte et une écriture comptable équilibrée et comptabilisée.

**Prêt :**

| Champ | Valeur |
|---|---|
| Nature | `Emprunt / pret (passif)` |
| Nom | libellé du prêt (ex. « Prêt FDI ») |
| Bailleur | l'organisme prêteur |
| Montant accordé | principal du prêt |
| Compte comptable crédité | `2200 — Emprunt FDI (passif)` |

Puis, sur la fiche du financement, enregistrer la réception des fonds sur le
compte de trésorerie qui les a effectivement reçus. Écriture produite :
**Dr Trésorerie / Cr Emprunt**.

**Soldes d'ouverture — un financement par compte de trésorerie :**

| Champ | Valeur |
|---|---|
| Nature | `Solde d'ouverture (capitaux propres)` |
| Nom | ex. « Solde d'ouverture — Caisse principale » |
| Montant accordé | le solde réel à la date de démarrage |
| Compte comptable crédité | `3000 — Capital / Apport fondateurs (capitaux propres)` |

Puis enregistrer la réception sur le compte concerné, à la **date de démarrage
des activités**. Écriture produite : **Dr Trésorerie / Cr Capitaux propres**.

> Cette capacité vient du correctif `3612f5d`. Avant lui, le sélecteur était
> restreint aux comptes de **produit** : un prêt aurait été comptabilisé en
> revenu, gonflant le résultat et minorant la dette dès le premier jour.
> Vérifier que le déploiement de production embarque bien ce commit.

**Ne pas utiliser d'écriture manuelle** pour ces deux opérations : elle serait
juste au grand livre mais ne créerait ni mouvement de trésorerie ni mise à jour
du solde — la trésorerie et le rapprochement bancaire resteraient à zéro en
permanence.

**Intérêts du prêt** : ils ne sont pas suivis automatiquement (pas
d'échéancier). Les comptabiliser par écriture manuelle sur
`6200 — Charges financières — intérêts FDI`.

---

## 4. Checklist MFA

Le moteur exige déjà l'AAL2 pour `SUPER_ADMIN` et `DIRECTEUR_GENERAL` sur
**toute** permission, et pour `DIRECTEUR_TECHNIQUE` dès qu'il détient une
permission administrative sensible.

- [ ] **Enrôler le TOTP du SUPER_ADMIN dès la première connexion**, avant toute
      autre action. Un SUPER_ADMIN fraîchement bootstrappé peut se connecter
      sans MFA — c'est volontaire, pour ne pas se verrouiller dehors — mais il
      reste bridé sur les permissions tant qu'il n'est pas en AAL2.
- [ ] Enrôler le TOTP de chaque `DIRECTEUR_GENERAL` et `DIRECTEUR_TECHNIQUE`.
- [ ] Conserver les codes de récupération hors ligne, hors du dépôt et hors du
      gestionnaire de mots de passe partagé.
- [ ] Vérifier via `/settings/security` qu'aucun compte à rôle sensible n'est
      sans facteur enrôlé.
- [ ] Supabase → Authentication → Providers : activer la **protection contre
      les mots de passe compromis** si le plan du projet la propose. Sur le
      projet de test elle était indisponible et documentée comme limite de
      plateforme (Phase 2B) ; le revérifier sur le nouveau projet.
- [ ] Fixer une politique de mot de passe (longueur minimale, complexité).

---

## 5. Checklist sauvegarde et restauration

Rien de tout cela n'est actuellement en place ni vérifié — c'est un des
blocages Go-Live identifiés.

- [ ] Supabase → Database → Backups : confirmer la fréquence des sauvegardes
      automatiques et la durée de rétention effective du plan souscrit.
- [ ] Activer le **Point-in-Time Recovery** si le plan le permet, et noter la
      fenêtre de récupération réelle.
- [ ] Mettre en place un **export périodique hors Supabase** (`pg_dump`
      chiffré vers un stockage tiers). C'est le point D4 du `docs/roadmap.md`,
      encore ouvert. Une sauvegarde qui ne vit que chez le même fournisseur que
      la base ne protège pas d'une perte de compte.
- [ ] **Exécuter une restauration de bout en bout au moins une fois**, sur un
      projet jetable, et chronométrer la durée réelle. `docs/security.md` §10
      l'exige ; ce n'est aujourd'hui qu'une intention.
- [ ] Consigner la procédure de restauration, avec le RPO et le RTO constatés —
      pas visés — dans `docs/roadmap.md`.
- [ ] Définir qui détient l'accès de restauration et selon quelle procédure.

---

## 6. Checklist déploiement Vercel

État réel : **aucun projet ni configuration Vercel de production n'est encore
établi**. L'absence de `vercel.json` n'est pas un manque — Vercel déploie une
application Next.js sans ce fichier, en détectant le framework et en utilisant
les réglages par défaut. Il n'y a donc rien à créer côté dépôt : tout se fait
à la mise en place du projet Vercel.

- [ ] Créer le projet Vercel et le relier au dépôt Git.
- [ ] Framework : Next.js. Commande de build `npm run build`. Aucune surcharge
      nécessaire — `next.config.ts` ne fixe que la racine Turbopack.
- [ ] Renseigner les 4 variables de la section 2, portée `Production`.
- [ ] **Vérifier l'absence de `NODE_TLS_REJECT_UNAUTHORIZED`** dans toutes les
      portées.
- [ ] Vérifier que `SUPABASE_SERVICE_ROLE_KEY` n'est **pas** marquée comme
      exposée au navigateur.
- [ ] Rattacher le domaine de production et vérifier le certificat TLS.
- [ ] Aligner `NEXT_PUBLIC_APP_URL`, la `Site URL` Supabase et les
      `Redirect URLs` sur ce même domaine.
- [ ] Déployer depuis un commit contenant **`3612f5d`** au minimum.
- [ ] Après déploiement, vérifier `/login`, la connexion, l'enrôlement MFA, et
      qu'une route protégée redirige bien vers `/login` en session anonyme.
- [ ] Décider si les branches de prévisualisation Vercel sont autorisées : par
      défaut elles hériteraient de variables d'environnement — ne jamais leur
      donner les clés de production.

---

## 7. Contrôle final avant GO-LIVE

Un seul cycle réel contrôlé, sur les données de production, après les étapes
1 à 6 :

- [ ] `debug_tables_without_rls` → aucune ;
- [ ] `debug_functions_with_mutable_search_path` sur `public` **et**
      `app_private` → aucune ;
- [ ] Security Advisor Supabase exécuté et écarts arbitrés ;
- [ ] création d'un tiers client, d'une facture, émission par une **seconde**
      personne, encaissement, vérification de l'écriture comptable ;
- [ ] une dépense : création, approbation par une seconde personne, paiement,
      contrôle du mouvement de trésorerie et de l'écriture ;
- [ ] un import de relevé, une proposition automatique, une validation par une
      seconde personne, contrôle de `cash_movements.reconciled` ;
- [ ] `/comptabilite/rapports` : bilan équilibré et compte de résultat
      cohérents avec le prêt et les soldes d'ouverture saisis ;
- [ ] `/audit` : les opérations ci-dessus apparaissent avec leur acteur ;
- [ ] aucune donnée portant `[TEST-FIXTURE]`, aucun compte `@medfinder.test`.

---

## 8. Séparation durable des environnements

| | Test / développement | Production |
|---|---|---|
| Projet Supabase | `qwydgqheceglulfxwtgo` | nouveau projet |
| Données | démo + fixtures de test | réelles |
| Suite de tests | y écrit | **jamais** |
| `supabase/seed.sql` | local uniquement | jamais |

À faire dès la création du projet de production :

- [ ] ne jamais pointer `.env.local` ni `.env.staging` sur le projet de
      production ;
- [ ] `.env.staging` pointe aujourd'hui sur le **même** projet que
      `.env.local` — le corriger ou le supprimer, sans quoi la confusion
      subsistera ;
- [ ] vérifier avant chaque campagne de tests que
      `NEXT_PUBLIC_SUPABASE_URL` ne désigne pas la production.
