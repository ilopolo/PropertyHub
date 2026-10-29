-- Cover application FKs identified by the hosted performance advisor.
create index bootstrap_profile_idx on private.bootstrap_state(profile_id);
create index requests_org_idx on public.access_requests(organization_id);
create index requests_reviewer_idx on public.access_requests(reviewed_by);
create index requests_requester_idx on public.access_requests(requester_profile_id);
create index audit_actor_idx on public.audit_events(actor_profile_id);
create index audit_org_idx on public.audit_events(organization_id);
create index audit_scope_idx on public.audit_events(scope_id);
create index buildings_org_idx on public.buildings(created_by_organization_id);
create index management_units_parents_idx on public.management_units(building_id,entrance_id);
create index roles_membership_profile_idx on public.user_roles(membership_id,profile_id);
