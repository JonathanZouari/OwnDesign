-- A failed consultant call keeps its quota slot (it may have been billed), so releasing is not needed.
drop function public.release_ai_message(bigint);
