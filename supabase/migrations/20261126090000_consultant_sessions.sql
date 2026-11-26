-- Consultant sessions: one user may hold several conversations per project.
-- ai_conversations becomes the session table; every existing conversation stays and is the user's first session.
-- ai_messages stays insert-only for the service role (update and delete are revoked), so a streamed
-- assistant message is inserted once, at the end of the stream, with its final status.

alter table public.ai_conversations drop constraint ai_conversations_project_id_user_id_key;

alter table public.ai_conversations
  add column title text check (title is null or char_length(title) <= 80),
  add column status text not null default 'active' check (status in ('active', 'archived')),
  add column context_type text not null default 'plan' check (context_type in ('plan', 'room', 'object')),
  add column context_id text check (context_id is null or context_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  add column updated_at timestamptz not null default now();

create index ai_conversations_project_user_idx
  on public.ai_conversations (project_id, user_id, updated_at desc);

alter table public.ai_messages
  add column status text not null default 'complete' check (status in ('complete', 'interrupted', 'error')),
  add column context_ref jsonb check (context_ref is null or pg_column_size(context_ref) < 4096),
  add column metadata jsonb check (metadata is null or pg_column_size(metadata) < 4096);

-- Existing policies and grants still apply: signed-in users may only SELECT their own sessions and
-- the messages in them; every write goes through the backend with the service key.
