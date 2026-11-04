-- Evaluate the authorized source feed once. Inlining it at each JSON projection
-- repeated permission scans and exceeded the hosted API statement deadline.
-- No change to authorization, legacy A-only visibility, snapshots or RPC grants.
create or replace function public.charge_batch_feed() returns jsonb language sql security invoker set search_path='' as $$
 with data as materialized(select private.charge_batch_feed() x),a as(select x,coalesce((select jsonb_agg(b) from jsonb_array_elements(x->'batches') b where b->>'publication_model'='sole-owner-v1'),'[]') batches from data),
 c as(select x,batches,coalesce((select jsonb_agg(c) from jsonb_array_elements(x->'charges') c where exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=c->>'batch_id')),'[]') charges from a)
 select x||jsonb_build_object('batches',batches,'charges',charges,
 'parties',coalesce((select jsonb_agg(p) from jsonb_array_elements(x->'parties') p where exists(select 1 from jsonb_array_elements(charges) c where c->>'id'=p->>'charge_id')),'[]'),
 'history',coalesce((select jsonb_agg(h) from jsonb_array_elements(x->'history') h where exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=h->>'target_id')),'[]')) from c
$$;
