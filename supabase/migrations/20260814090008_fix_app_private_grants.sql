-- MedFinder Gestion — Phase 1B, verification finale
-- Trouvaille (verification croisee des privileges, meme methode que
-- l'audit Phase 1A §16.2) : les 4 fonctions app_private creees en Phase 1B
-- (assign_employee_matricule, can_access_employee_documents,
-- next_number_internal, seed_default_numbering_sequences) avaient toutes
-- un GRANT EXECUTE PUBLIC implicite, alors que 20260813100015 avait pose
-- une regle ALTER DEFAULT PRIVILEGES censee l'empecher pour toute fonction
-- future du schema app_private. La regle par defaut ne s'applique
-- visiblement pas de maniere fiable a travers des fichiers de migration
-- CLI separes (cause exacte non confirmee — piste : contexte de role/
-- session different entre fichiers de migration appliques par le CLI
-- Supabase). Plutot que de deboguer plus avant, on applique desormais un
-- REVOKE explicite immediatement apres chaque creation de fonction
-- app_private (pratique a suivre pour toute migration future), et on
-- corrige les 4 fonctions concernees ici. Sans impact fonctionnel : ces
-- fonctions ne sont de toute facon jamais atteignables via PostgREST
-- (schema hors [api].schemas) — durcissement defense-in-depth uniquement,
-- comme la trouvaille equivalente en Phase 1A (20260813100016).

-- assign_employee_matricule et seed_default_numbering_sequences sont des
-- fonctions TRIGGER : leur execution est declenchee par le mecanisme de
-- trigger lui-meme, jamais par un appel SQL direct du role connecte — le
-- revoke n'affecte donc pas leur fonctionnement (meme principe que les
-- triggers d'audit de Phase 1A, deja sans grant explicite).
revoke execute on function app_private.assign_employee_matricule() from public;
revoke execute on function app_private.seed_default_numbering_sequences() from public;

-- next_number_internal n'est appelee que depuis public.next_number() et le
-- trigger assign_employee_matricule (tous deux SECURITY DEFINER/trigger,
-- executes sous le contexte du proprietaire) — jamais directement par une
-- policy RLS. Revoke sans grant complementaire.
revoke execute on function app_private.next_number_internal(uuid, text) from public;

-- can_access_employee_documents EST appelee directement par les policies
-- RLS de employee_documents et de storage.objects (evaluees sous le role
-- "authenticated" du connecteur, pas sous un contexte SECURITY DEFINER) —
-- necessite donc, comme is_super_admin/is_active_member/has_permission en
-- Phase 1A (§16.9), un grant explicite a authenticated en remplacement du
-- grant PUBLIC retire, sous peine de casser tout acces aux documents RH.
revoke execute on function app_private.can_access_employee_documents(uuid, uuid) from public;
grant execute on function app_private.can_access_employee_documents(uuid, uuid) to authenticated;
