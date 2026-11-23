-- Phase 1 focuses on homeowners designing on their own: a project may exist without a studio.
-- Access is unchanged: projects_select already admits the owning client (client_user_id = auth.uid()),
-- and a null studio_id never matches a membership, so no studio member can see such a project.
alter table public.projects alter column studio_id drop not null;
