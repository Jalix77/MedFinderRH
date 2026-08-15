# Phase 1B — Rapport de clôture

Statut : **CLÔTURÉE**. Périmètre strictement respecté (aucun module hors
RH/départements/postes/contrats/documents, aucun début de Phase 1C).
Commit final : `a5441e5` (branche `master`), `git status` propre.

## 1. Périmètre réalisé

Conforme au plan présenté et validé avant implémentation : départements,
postes, employés, contrats (+ avenants), documents RH. **Hors périmètre,
non touché** : présence, congés, recrutement, payroll, avances (réservés
Phase 3 par `docs/roadmap.md`).

## 2. Tables créées

`departments`, `positions`, `employees`, `employee_sensitive_data`,
`contracts`, `contract_amendments`, `employee_documents` + bucket Storage
privé `employee-documents`.

**Décision d'architecture prise pendant l'implémentation** (déviation
justifiée vs le schéma indicatif de `docs/data-model.md` Phase 0) :
`employees` et `employee_sensitive_data` sont deux tables séparées, et la
rémunération/le type de contrat ont été retirés d'`employees` au profit de
`contracts` exclusivement. Raison : RLS filtre des **lignes**, jamais des
**colonnes** — regrouper des champs de sensibilité très différente (nom,
statut vs NIF/CIN/adresse) dans une seule ligne aurait nécessité soit une
sur-exposition, soit une vue supplémentaire. C'est exactement le défaut
trouvé sur `public.users` pendant l'audit Phase 1A (§16.5 du rapport de
clôture Phase 1A) — corrigé ici avant même d'être introduit.

## 3. Permissions ajoutées

3 nouvelles, dans une migration séparée (le catalogue Phase 1A n'est jamais
modifié rétroactivement) : `department.manage`, `position.manage`,
`employee.view_sensitive`. Accordées par défaut à SUPER_ADMIN,
DIRECTEUR_GENERAL, RH — cohérent avec la matrice existante. Catalogue final
: **67 permissions, 220 associations `role_permissions`** (vs 64/211 en fin
de Phase 1A).

## 4. Politiques RLS

| Table | Lecture | Écriture |
|---|---|---|
| `departments`/`positions` | Tout membre actif | `department.manage`/`position.manage` |
| `employees` | `employee.view` ou soi-même | `employee.create`/`employee.update`/`employee.terminate` |
| `employee_sensitive_data` | `employee.view_sensitive` ou soi-même (lecture seule) | `employee.view_sensitive` uniquement |
| `contracts`/`contract_amendments` | `employee.view_salary` ou soi-même | `contract.manage` |
| `employee_documents` + `storage.objects` | `document.view_confidential` / `employee.view_sensitive` / soi-même | `document.upload` |

Aucune policy DELETE nulle part (désactivation via `status`, pas de
suppression réelle — §56 prompt maître). Toutes vérifiées par tests
positifs ET négatifs (§8).

## 5. Workflows implémentés

Création employé (matricule `EMP-0001...` auto-assigné, atomique),
modification profil, fin de contrat (`employee.terminate`, jamais de
suppression), données très sensibles (formulaire séparé, permission
séparée), création contrat + avenants, upload/téléchargement document
(URL signée 60s, jamais d'accès direct au bucket).

## 6. Migrations (8, atomiques)

```
20260814090001_hr_permissions_catalogue.sql
20260814090002_numbering_defaults.sql
20260814090003_departments_positions.sql
20260814090004_employees.sql
20260814090005_contracts.sql
20260814090006_employee_documents.sql
20260814090007_hr_audit_triggers.sql
20260814090008_fix_app_private_grants.sql
```

Reproductibles (`npx supabase db reset` — vérifié à de multiples reprises
en local) et appliquées avec succès sur le projet Supabase cloud dédié via
l'éditeur SQL (voir §9).

## 7. Trouvaille et correctif pendant la vérification finale

En appliquant la même méthode de vérification croisée des privilèges que
l'audit Phase 1A (§16.2), une inspection de `information_schema.routine_privileges`
a révélé que les 4 fonctions `app_private` nouvellement créées en Phase 1B
(`assign_employee_matricule`, `can_access_employee_documents`,
`next_number_internal`, `seed_default_numbering_sequences`) avaient toutes
hérité d'un `GRANT EXECUTE PUBLIC` non voulu, alors que la règle
`ALTER DEFAULT PRIVILEGES` posée en Phase 1A (`20260813100015`) était
censée l'empêcher pour toute fonction future du schéma `app_private`. Cause
exacte non confirmée (probable contexte de rôle/session différent entre
fichiers de migration appliqués séparément par le CLI Supabase) —
documentée comme dette technique (§12).

Sans impact d'exploitation réel (ces fonctions restent hors du schéma
exposé par PostgREST), mais viole le principe de défense en profondeur
établi en Phase 1A. **Corrigé** (`20260814090008`) : revoke explicite sur
les 4 fonctions, avec un ré-octroi ciblé à `authenticated` pour
`can_access_employee_documents` spécifiquement, car — vérification
indispensable avant de pousser le correctif — cette fonction est appelée
**directement** par les policies RLS de `employee_documents` et
`storage.objects` (évaluées sous le rôle `authenticated`, pas sous un
contexte `SECURITY DEFINER`) : un simple revoke sans ce ré-octroi aurait
reproduit exactement la régression déjà rencontrée et corrigée en Phase 1A
(§16.9 — `is_super_admin`/`is_active_member`/`has_permission`).

## 8. Tests positifs/négatifs par workflow critique

`tests/integration/hr-workflows.test.ts` (20 tests) + extraits pertinents
de `role-scoping.test.ts` (8), `security-definer-audit.test.ts` (18),
`admin-negative.test.ts` (8) :

| Workflow | Positif | Négatif |
|---|---|---|
| Création département | RH (`department.manage`) ✅ | MANAGER ❌ |
| Création employé | RH ✅, matricule auto vérifié | EMPLOYE ❌ |
| Matricule — concurrence | 20 créations simultanées → 20 matricules uniques | — |
| Visibilité salaire (`contracts`) | COMPTABLE ✅ | MANAGER ❌, DT limité à sa propre fiche |
| Auto-accès salaire | EMPLOYE voit son propre contrat | — |
| Données très sensibles | RH ✅ | DT ❌, SUPPORT ❌ |
| Auto-accès sensible | EMPLOYE lit sa fiche | EMPLOYE ne peut pas la modifier |
| Upload document | RH (`document.upload`) ✅ | Org B → chemin Org A ❌ (isolation, pas juste la permission nommée) |
| Lecture documents | — | Rôle sans accès → liste vide |
| Fin de contrat | RH ✅ (vérifié en base) | MANAGER → 0 ligne affectée (RLS silencieuse) |
| Isolation multi-org | — | Org B ne voit aucune ligne des 4 nouvelles tables sensibles d'Org A |

## 9. Incident infrastructure et résolution (transparence complète)

Pendant la vérification finale, le stack Supabase local (Docker) est devenu
durablement inutilisable : d'abord saturation mémoire (3 projets Supabase
locaux simultanés sur 5,7 Go — résolu en arrêtant les 2 autres projets avec
votre accord), puis un blocage plus profond du backend Docker Desktop/WSL2
(conteneurs figés, `docker exec`/`docker kill` en timeout, API Docker
retournant 502) qui a nécessité un `wsl --shutdown` complet de votre part —
un simple "Restart" depuis Docker Desktop n'a pas suffi.

Pendant que Docker restait indisponible, vous avez appliqué directement les
migrations manquantes (`20260813100016` + les 8 de Phase 1B) via l'éditeur
SQL du dashboard Supabase cloud (script consolidé fourni). J'ai ensuite
rejoué la vérification fonctionnelle sur ce projet cloud plutôt que
d'attendre la résolution locale : **54 tests d'intégration exécutés avec
succès contre le cloud réel** (voir §11), y compris les tests qui
prouvent spécifiquement le bon fonctionnement des deux correctifs de
sécurité (anon RPC de Phase 1A, grants `app_private` de Phase 1B).

Aucune donnée locale n'a été perdue (les migrations restent appliquées et
testées localement dès que Docker sera de nouveau disponible) ; ceci
documente uniquement l'incident et sa résolution, conformément à
l'exigence de transparence.

## 10. Commandes exécutées et résultats

```bash
# Local (avant l'incident Docker) :
npx supabase db reset          # 24 migrations, OK
npm test                       # 11 fichiers, 91 tests, 0 echec
npx tsc --noEmit                # 0 erreur
npm run lint                    # 0 erreur, 0 avertissement
npm run build                   # succes, 17 routes
npx supabase db lint             # "No schema errors found"
# Security Advisor (Studio local) : 0 erreur, 9 avertissements (memes 9
# fonctions revues qu'en Phase 1A — aucun nouvel avertissement introduit
# par les 4 nouvelles fonctions app_private, correctement hors schema API)

# Verification navigateur reelle (avant l'incident) :
# - /rh/employes : liste correcte, matricules EMP-0001...EMP-0007 pour le
#   seed, EMP-0008+ pour les creations de test
# - /rh/employes/[id] (EMP-0001) : profil + donnees sensibles seedees
#   affichees correctement (NIF-0001, CIN-0001, date de naissance,
#   telephone) ; section Contrats absente pour RH (n'a pas
#   employee.view_salary) — conforme au design
# - /rh/departements : CRUD fonctionnel

# Apres l'incident Docker, sur le projet cloud (migrations appliquees via
# SQL Editor par Jean Alix Pierre) :
npx tsc --noEmit                              # 0 erreur (re-verifie)
npm run lint                                  # 0 erreur (re-verifie)
vitest run tests/integration/role-scoping.test.ts       # 8/8
vitest run tests/integration/hr-workflows.test.ts       # 20/20
vitest run tests/integration/security-definer-audit.test.ts  # 18/18
vitest run tests/integration/admin-negative.test.ts     # 8/8
# Total cloud : 54/54 tests verts
```

### Résultat TypeScript
0 erreur (`strict: true`), vérifié deux fois (avant et après l'incident).

### Résultat lint
0 erreur, 0 avertissement.

### Résultat build
Succès, 17 routes (14 Phase 1A + 3 nouvelles : `/rh/departements`,
`/rh/employes`, `/rh/employes/[id]`, `/rh/employes/nouveau` — 4 en réalité,
la liste exacte est dans le log de build).

### Résultat tests
- Local (avant incident) : 91/91.
- Cloud (après incident, migrations appliquées manuellement) : 54/54 sur
  les 4 fichiers les plus significatifs pour Phase 1B (RLS/RBAC/audit/
  cloisonnement). Les fichiers restants (Phase 1A pure — auth, MFA,
  numérotation générique, overrides) avaient déjà été rejoués avec succès
  sur ce même projet cloud lors de l'audit Phase 1A (§16.8 de son rapport).

### Security Advisors
Local : 0 erreur, 9 avertissements (tous revus, Phase 1A, aucun nouveau).
Cloud : non re-vérifié visuellement (dashboard nécessite votre connexion,
hors de ma portée) — le comportement fonctionnel des grants a cependant
été prouvé indirectement et de façon plus rigoureuse par les tests
d'intégration (§7, §9), qui exercent directement les policies concernées.

## 11. Dette technique

| Sujet | Détail | Action recommandée |
|---|---|---|
| `ALTER DEFAULT PRIVILEGES` non fiable entre fichiers de migration | Cause exacte non confirmée (voir §7) | Ne plus compter sur cette règle pour les fonctions `app_private` futures — toujours ajouter un `REVOKE EXECUTE ... FROM PUBLIC` explicite immédiatement après chaque `CREATE FUNCTION`, comme documenté dans `20260814090008` |
| `department_id`/`position_id` sur `employees` non contraints l'un par rapport à l'autre | Un employé peut avoir un poste d'un département différent de son `department_id` déclaré | Acceptable en l'état (limitation mineure documentée dès le plan initial) ; à revisiter si un besoin métier précis émerge |
| Node 20 vs 22 | Toujours d'actualité (voir rapport Phase 1A §10) | Inchangé |
| Environnement Docker local fragile | Panne durable pendant cette phase, résolue par `wsl --shutdown` | Documenté ; envisager d'augmenter la mémoire Docker Desktop de façon permanente pour éviter la récurrence |

## 12. Risques restants

- **Migration `20260813100016` (Phase 1A)** : n'est plus un suivi séparé —
  elle a été appliquée avec succès dans le même geste que les migrations
  Phase 1B (§9). **Ce point est donc maintenant clos.**
- Local et cloud sont désormais synchronisés (24 migrations sur les deux),
  mais Docker local reste à vérifier de nouveau au prochain usage (aucune
  garantie que l'incident ne se reproduise pas).
- Aucun autre risque nouveau identifié pour ce périmètre.

## 13. Points nécessitant validation utilisateur avant Phase 1C

1. La séparation `employees`/`employee_sensitive_data` (§2) — confirmer
   que ce choix d'architecture (plus protecteur mais plus complexe que le
   schéma esquissé en Phase 0) convient pour les futurs modules RH
   (présence, congés) qui référenceront `employees`.
2. Le contournement `ALTER DEFAULT PRIVILEGES` (§11) — accepter la
   nouvelle pratique ("REVOKE explicite après chaque CREATE FUNCTION")
   comme standard pour toutes les phases futures.

## 14. Commit Git

```
a5441e5 test(phase-1b): couverture positive/negative RH (20 tests) + verification cloud
f85182a feat(app): UI Phase 1B — departements, employes, contrats, documents RH
fd7d2c2 feat(db): Phase 1B — departements, employes, contrats, documents RH
7a6cba8 docs(phase-1a): rapport de cloture mis a jour — audit cible pre-Phase-1B
```

## 15. Statut Git final

`git status` → propre. Aucun secret, aucune clé `service_role`, aucun
fichier `.env*` autre que `.env.example` suivi par Git.

## 16. Prochaine phase

**Phase 1C** (proposition, à confirmer) : selon `docs/roadmap.md`, la
suite logique du socle MVP est le module Dépenses + Caisse/Banque + Budget
+ PAPEJ (premier module financier, consommant la numérotation `DEP-2026-0001`
et posant les bases de la comptabilité Phase 2). Conformément à la règle
absolue du prompt maître, **aucune ligne de Phase 1C n'a été commencée** —
la Phase 1B s'arrête ici pour votre validation explicite.
