-- P26 known_from is a Bulgarian calendar date, independent of the database session timezone.
-- It remains a knowledge limit, not an acquisition date or a management-assignment period.
create or replace function private.check_provenance(source_kind text, source_reference text, known_from date) returns void language plpgsql set search_path='' as $$
begin
 if source_kind is null or source_kind not in ('declaration','document') or source_reference is null
 or length(btrim(source_reference)) not between 1 and 200 or known_from is null
 or known_from>(now() at time zone 'Europe/Sofia')::date then
  raise exception 'Source and known-from date required' using errcode='23514';
 end if;
end $$;
revoke all on function private.check_provenance(text,text,date) from public,anon,authenticated;
