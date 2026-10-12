-- ============================================================================
-- SONROJA ERP — 010 Llaves foráneas a users
-- Permite embeber nombres de usuario desde PostgREST (alias:users!constraint(...)).
-- ============================================================================
alter table public.inventory_movements add constraint inventory_movements_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
alter table public.inventory_adjustments add constraint inventory_adjustments_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.inventory_transfers add constraint inventory_transfers_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.inventory_transfers add constraint inventory_transfers_sent_by_fkey foreign key (sent_by) references public.users(id) on delete set null;
alter table public.inventory_transfers add constraint inventory_transfers_received_by_fkey foreign key (received_by) references public.users(id) on delete set null;
alter table public.inventory_counts add constraint inventory_counts_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.inventory_counts add constraint inventory_counts_finalized_by_fkey foreign key (finalized_by) references public.users(id) on delete set null;
alter table public.purchase_orders add constraint purchase_orders_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.purchase_receipts add constraint purchase_receipts_received_by_fkey foreign key (received_by) references public.users(id) on delete set null;
alter table public.cash_shifts add constraint cash_shifts_opened_by_fkey foreign key (opened_by) references public.users(id) on delete set null;
alter table public.cash_shifts add constraint cash_shifts_closed_by_fkey foreign key (closed_by) references public.users(id) on delete set null;
alter table public.cash_movements add constraint cash_movements_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
alter table public.sale_returns add constraint sale_returns_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
alter table public.sales add constraint sales_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.sales add constraint sales_cancelled_by_fkey foreign key (cancelled_by) references public.users(id) on delete set null;
alter table public.expenses add constraint expenses_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
alter table public.notifications add constraint notifications_resolved_by_fkey foreign key (resolved_by) references public.users(id) on delete set null;
alter table public.audit_logs add constraint audit_logs_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
create index if not exists idx_cash_movements_user on public.cash_movements (user_id);
create index if not exists idx_sales_created_by on public.sales (created_by);
