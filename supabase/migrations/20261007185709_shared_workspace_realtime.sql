-- Every recipe/selection mutation already increments the private workspace revision.
-- Publishing it covers removals too, without depending on filtered DELETE payloads.
alter publication supabase_realtime add table public.workspaces;
