-- MedFinder Gestion — Phase 1A
-- Extensions requises + schema interne pour les fonctions non exposees via l'API REST.

create extension if not exists pgcrypto;

-- Schema prive : les fonctions ici ne sont JAMAIS exposees en RPC via PostgREST
-- (seuls les schemas "public" et "graphql_public" sont exposes, voir
-- supabase/config.toml [api] schemas). Toute logique interne sensible
-- (has_permission, audit, validations) vit ici.
create schema if not exists app_private;

comment on schema app_private is
  'Fonctions et objets internes non exposes via l''API Data (PostgREST). '
  'Ne jamais deplacer ces objets dans public sans revue de securite.';

-- Trigger generique de mise a jour de updated_at, reutilise par toutes les
-- tables metier (voir data-model.md, conventions globales).
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
