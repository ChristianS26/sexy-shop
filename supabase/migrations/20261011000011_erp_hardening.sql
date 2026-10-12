-- ============================================================================
-- SONROJA ERP — 011 Endurecimiento (linter de Supabase)
-- search_path fijo y funciones internas no invocables desde la API pública.
-- ============================================================================
alter function public.raise_immutable() set search_path = public;
alter function public.stock_status(int, int, int) set search_path = public;
alter function public.bi_prev_range(timestamptz, timestamptz) set search_path = public;
alter function public.update_updated_at() set search_path = public;
alter function public.handle_new_user() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.update_updated_at() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.fill_default_org() from public, anon, authenticated;
revoke all on function public.products_before_write() from public, anon, authenticated;
revoke all on function public.products_stock_guard() from public, anon, authenticated;
revoke all on function public.inventory_levels_after_write() from public, anon, authenticated;
revoke all on function public.variants_after_write() from public, anon, authenticated;
revoke all on function public.customers_before_write() from public, anon, authenticated;
revoke all on function public.customer_addresses_before_write() from public, anon, authenticated;
revoke all on function public.customer_addresses_after_write() from public, anon, authenticated;
revoke all on function public.po_items_after_write() from public, anon, authenticated;
revoke all on function public.sync_order_to_sale() from public, anon, authenticated;
revoke all on function public.normalize_text(text) from public, anon, authenticated;
revoke all on function public.stock_status(int, int, int) from public, anon, authenticated;
revoke all on function public.bi_prev_range(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.default_organization_id() from public, anon, authenticated;
revoke all on function public.create_expense(uuid,uuid,uuid,text,numeric,date,text,uuid,uuid,uuid,text,text) from public, anon, authenticated;
