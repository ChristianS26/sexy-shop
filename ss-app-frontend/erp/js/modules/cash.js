// ═══════════════════════════════════════════════════════════════════════════
// Caja — turnos (abrir / movimientos / cerrar con arqueo) y gastos
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast } from '../ui/overlay.js';
import { field, setLoading, spinner, emptyState, tabs, kpi } from '../ui/widgets.js';

export const route = '/cash';
export const title = 'Caja';
export const crumb = 'Operación';
export const perms = ['cash.read', 'cash.open'];

export async function render(root) {
  const head = h('div.page-head', h('div', h('h1.page-head__title', 'Caja'), h('p.page-head__sub', 'Turnos con fondo inicial, ventas por método de pago, entradas, salidas y arqueo al cierre.')), h('div.page-head__actions'));
  const current = h('div');
  const body = h('div');
  const tabBar = tabs([{ key: 'shifts', label: 'Turnos', icon: 'cash' }, ...(me.can('expenses.manage', 'cash.read', 'analytics.financial') ? [{ key: 'expenses', label: 'Gastos', icon: 'wallet' }] : [])], 'shifts', (k) => k === 'shifts' ? renderShifts() : renderExpenses());
  root.append(head, current, tabBar, body);
  await renderCurrent();
  renderShifts();

  async function renderCurrent() {
    replace(current, spinner());
    let r; try { r = await api.get('/cash/shifts/current'); } catch (e) { replace(current, emptyState({ icon: 'alertCircle', title: 'No se pudo consultar la caja', text: friendlyError(e) })); return; }
    const actions = head.querySelector('.page-head__actions'); replace(actions);
    if (!r.shift) {
      replace(current, h('div.card', h('div.card__body', h('div.row.row--between', h('div', h('div.card__title', 'No tienes un turno abierto'), h('div.card__sub', me.can('cash.open') ? 'Abre tu turno con el fondo inicial para cobrar en efectivo.' : 'Pide a un gerente que abra el turno.')), me.can('cash.open') ? h('button.btn.btn--primary', { onclick: openShift }, icon('cash'), 'Abrir turno') : null))));
      if (r.open_shifts?.length) current.appendChild(h('div.alert.alert--info.mt-4', icon('info'), h('div', h('div.alert__title', `${r.open_shifts.length} turno(s) abierto(s) por otras personas`), h('div.alert__text', r.open_shifts.map(s => `${s.cash_registers?.name} · ${fmt.name(s.opener)} desde ${fmt.time(s.opened_at)}`).join(' · ')))));
      return;
    }
    const s = r.shift;
    const byType = s.totals_by_type || {};
    actions.append(me.can('cash.movements') ? h('button.btn.btn--secondary', { onclick: () => addMovement(s) }, icon('plus'), 'Entrada / salida') : null, me.can('cash.close') ? h('button.btn.btn--primary', { onclick: () => closeShift(s) }, icon('lock'), 'Cerrar turno') : null);
    replace(current, h('div.grid.grid--kpi',
      kpi({ label: `Turno abierto · ${s.cash_registers?.name}`, value: s.expected_cash_live, tone: 'accent', foot: `Abierto por ${fmt.name(s.opener)} · ${fmt.datetime(s.opened_at)}`, format: fmt.money }),
      kpi({ label: 'Ventas del turno', value: s.sales_total_live, format: fmt.money, foot: `${fmt.int(s.sales_count_live)} tickets`, icon: 'receipt' }),
      kpi({ label: 'Fondo inicial', value: s.opening_amount, format: fmt.money, icon: 'wallet' }),
      kpi({ label: 'Entradas / salidas', value: (byType.DEPOSIT || 0) + (byType.WITHDRAWAL || 0) + (byType.EXPENSE || 0), format: fmt.money, icon: 'shuffle', foot: `Dep. ${fmt.money(byType.DEPOSIT || 0)} · Ret. ${fmt.money(Math.abs(byType.WITHDRAWAL || 0))} · Gastos ${fmt.money(Math.abs(byType.EXPENSE || 0))}` }),
    ), h('div.grid.grid--main-aside.mt-4',
      h('div.card', h('div.card__head', h('div.card__title', 'Movimientos del turno')), h('div.card__body.card__body--flush', movementsTable(s.movements))),
      h('div.card', h('div.card__head', h('div.card__title', 'Por método de pago')), h('div.card__body', Object.entries(s.totals_by_method_live || {}).map(([k, v]) => h('div.stat-row', h('span', me.paymentMethods.find(m => m.code === k)?.name || k), h('b', fmt.money(v)))), h('div.divider'), h('div.stat-row', h('span.strong', 'Efectivo esperado en cajón'), h('b.serif', { style: { fontSize: '1.1rem' } }, fmt.money(s.expected_cash_live)))))));
  }
  function movementsTable(movs) {
    if (!movs?.length) return emptyState({ icon: 'cash', title: 'Sin movimientos' });
    const lbl = { OPENING: 'Fondo inicial', SALE: 'Venta', REFUND: 'Reembolso', DEPOSIT: 'Depósito', WITHDRAWAL: 'Retiro', EXPENSE: 'Gasto', ADJUSTMENT: 'Ajuste' };
    return h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Hora'), h('th', 'Tipo'), h('th', 'Descripción'), h('th', 'Método'), h('th.num', 'Monto'))), h('tbody', movs.slice().reverse().map(m => h('tr', h('td', fmt.time(m.created_at)), h('td', h(`span.badge${m.amount < 0 ? '.badge--warning' : '.badge--success'}`, lbl[m.movement_type] || m.movement_type)), h('td', m.description || '—', m.users ? h('div.cell-sub', fmt.name(m.users)) : null), h('td', m.affects_cash ? 'Efectivo' : (me.paymentMethods.find(x => x.code === m.payment_method_code)?.name || m.payment_method_code || '—')), h('td.num', { class: m.amount < 0 ? 'down' : '' }, fmt.money(m.amount)))))));
  }
  function openShift() {
    const branch = me.user?.default_branch_id || me.branches[0]?.id;
    const branchSel = field({ label: 'Sucursal', name: 'branch', type: 'select', options: me.branches, value: branch, onChange: (v) => { regSel.input.replaceChildren(...me.registersOf(v).map(r => h('option', { value: r.id }, r.name))); } });
    const regSel = field({ label: 'Caja', name: 'cash_register_id', type: 'select', options: me.registersOf(branch) });
    const amount = field({ label: 'Fondo inicial en efectivo', name: 'opening_amount', type: 'number', value: 500, min: 0, step: '0.01', prefix: '$', required: true, hint: 'Cuenta el efectivo con el que inicias.' });
    const notes = field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2 });
    openModal({ title: 'Abrir turno de caja', body: h('div.form-grid', me.branches.length > 1 ? branchSel : null, regSel, amount, notes), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      if (!regSel.input.value) { toast.warn('Esta sucursal no tiene cajas. Crea una en Configuración → Sucursales.'); return; }
      setLoading(e.target.closest('button'), true);
      try { await api.post('/cash/shifts/open', { cash_register_id: regSel.input.value, opening_amount: Number(amount.input.value), notes: notes.input.value || null }); toast('Turno abierto'); m.close(); renderCurrent(); renderShifts(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, 'Abrir turno')] });
  }
  function addMovement(s) {
    const type = field({ label: 'Tipo', name: 'type', type: 'select', options: [{ value: 'DEPOSIT', label: 'Depósito (entra efectivo)' }, { value: 'WITHDRAWAL', label: 'Retiro (sale efectivo)' }] });
    const amount = field({ label: 'Monto', name: 'amount', type: 'number', min: 0.01, step: '0.01', prefix: '$', required: true });
    const desc = field({ label: 'Descripción', name: 'description', required: true, placeholder: 'Ej. retiro para depósito bancario' });
    openModal({ title: 'Movimiento de efectivo', body: h('div.form-grid', type, amount, h('div.span-2', desc)), footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      setLoading(e.target.closest('button'), true);
      try { await api.post(`/cash/shifts/${s.id}/movements`, { type: type.input.value, amount: Number(amount.input.value), description: desc.input.value }); toast('Movimiento registrado'); m.close(); renderCurrent(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, 'Registrar')] });
  }
  function closeShift(s) {
    const counted = h('input.input', { type: 'number', step: '0.01', min: 0, placeholder: '0.00', style: { fontSize: '1.4rem', textAlign: 'right' }, 'aria-label': 'Efectivo contado' });
    const diff = h('div.change-display', 'Diferencia: —');
    counted.addEventListener('input', () => { const d = (Number(counted.value) || 0) - s.expected_cash_live; diff.textContent = `Diferencia: ${d >= 0 ? '+' : ''}${fmt.money(d)}`; diff.className = 'change-display' + (Math.abs(d) > (me.settings?.alerts?.cash_difference_threshold ?? 50) ? ' down' : ''); diff.style.background = Math.abs(d) > (me.settings?.alerts?.cash_difference_threshold ?? 50) ? 'var(--color-danger-soft)' : ''; });
    const notes = field({ label: 'Notas del cierre', name: 'notes', type: 'textarea', rows: 2 });
    const denoms = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
    const denomInputs = {};
    const denomGrid = h('div.form-grid.form-grid--3', denoms.map(d => { const i = h('input.input.input--sm', { type: 'number', min: 0, placeholder: '0', 'aria-label': `Billetes/monedas de ${d}` }); denomInputs[d] = i; i.addEventListener('input', () => { counted.value = denoms.reduce((a, x) => a + (Number(denomInputs[x].value) || 0) * x, 0).toFixed(2); counted.dispatchEvent(new Event('input')); }); return h('div.field', h('label.field__label', `$${d}`), i); }));
    openModal({ title: 'Cerrar turno · arqueo', size: 'md', body: h('div.stack', h('div.alert.alert--info', icon('info'), h('div', h('div.alert__title', `Efectivo esperado: ${fmt.money(s.expected_cash_live)}`), h('div.alert__text', 'Fondo + ventas en efectivo − reembolsos + depósitos − retiros − gastos'))), h('details', h('summary.text-sm.strong', { style: { cursor: 'pointer' } }, 'Contar por denominación'), h('div.mt-2', denomGrid)), h('div.field', h('label.field__label', 'Efectivo contado'), counted), diff, notes),
      footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
        if (counted.value === '') { toast.warn('Indica el efectivo contado.'); counted.focus(); return; }
        const d = (Number(counted.value) || 0) - s.expected_cash_live;
        if (Math.abs(d) > 0.5 && !(await confirm({ title: 'Hay diferencia de caja', text: `La diferencia es ${fmt.money(d)}. Se generará una alerta para gerencia. ¿Cerrar de todos modos?`, confirmText: 'Cerrar turno', danger: true }))) return;
        setLoading(e.target.closest('button'), true);
        try { await api.post(`/cash/shifts/${s.id}/close`, { counted_cash: Number(counted.value), notes: notes.input.value || null }); toast('Turno cerrado'); m.close(); renderCurrent(); renderShifts(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
      } }, icon('lock'), 'Cerrar turno')] });
    setTimeout(() => counted.focus(), 60);
  }
  function renderShifts() {
    replace(body);
    new DataTable({ id: 'shifts', endpoint: '/cash/shifts', defaultSort: '-opened_at', search: false, exportKey: 'cash_shifts', emptyTitle: 'Sin turnos', emptyIcon: 'cash',
      filters: [{ key: 'opened', label: 'Fecha', type: 'daterange' }, { key: 'status', label: 'Estado', type: 'select', options: [{ value: 'OPEN', label: 'Abiertos' }, { value: 'CLOSED', label: 'Cerrados' }] }, ...(me.branches.length > 1 ? [{ key: 'branch', label: 'Sucursal', type: 'select', options: me.branches.map(b => ({ value: b.id, label: b.name })) }] : [])],
      columns: [
        { key: 'opened_at', label: 'Apertura', render: r => h('div', h('div.cell-main', fmt.datetime(r.opened_at)), h('div.cell-sub', `${r.cash_registers?.name || ''} · ${fmt.name(r.opener)}`)) },
        { key: 'closed_at', label: 'Cierre', hideSm: true, render: r => r.closed_at ? h('div', h('div', fmt.datetime(r.closed_at)), h('div.cell-sub', fmt.name(r.closer))) : badge('shift', 'OPEN') },
        { key: 'sales_count', label: 'Ventas', num: true, render: r => r.sales_count ?? '—' },
        { key: 'sales_total', label: 'Total ventas', num: true, render: r => r.sales_total != null ? fmt.money(r.sales_total) : '—' },
        { key: 'expected_cash', label: 'Esperado', num: true, hideSm: true, render: r => r.expected_cash != null ? fmt.money(r.expected_cash) : '—' },
        { key: 'counted_cash', label: 'Contado', num: true, hideSm: true, render: r => r.counted_cash != null ? fmt.money(r.counted_cash) : '—' },
        { key: 'difference', label: 'Diferencia', num: true, render: r => r.difference == null ? '—' : h('b', { class: Math.abs(r.difference) > 0.5 ? 'down' : 'up' }, `${r.difference >= 0 ? '+' : ''}${fmt.money(r.difference)}`) },
      ],
      onRow: (r) => openShiftDetail(r.id),
    }).mount(body);
  }
  async function openShiftDetail(id) {
    const box = h('div', spinner());
    const d = openDrawer({ title: 'Turno de caja', size: 'lg', body: box });
    try {
      const s = await api.get(`/cash/shifts/${id}`);
      replace(box, h('div.row.gap-2.mb-4', badge('shift', s.status), h('span.text-sm.text-2', `${s.cash_registers?.name} · ${s.branches?.name}`)),
        h('div.grid.grid--2', { style: { gap: '12px' } }, h('div.card.card--soft', { style: { padding: '14px' } }, h('div.stat-row', h('span', 'Abrió'), h('b', `${fmt.name(s.opener)} · ${fmt.datetime(s.opened_at)}`)), s.closed_at ? h('div.stat-row', h('span', 'Cerró'), h('b', `${fmt.name(s.closer)} · ${fmt.datetime(s.closed_at)}`)) : null, h('div.stat-row', h('span', 'Fondo inicial'), h('b', fmt.money(s.opening_amount))), h('div.stat-row', h('span', 'Ventas'), h('b', `${fmt.int(s.sales_count ?? s.sales_count_live)} · ${fmt.money(s.sales_total ?? s.sales_total_live)}`))),
          h('div.card.card--soft', { style: { padding: '14px' } }, h('div.stat-row', h('span', 'Efectivo esperado'), h('b', fmt.money(s.expected_cash ?? s.expected_cash_live))), s.counted_cash != null ? h('div.stat-row', h('span', 'Contado'), h('b', fmt.money(s.counted_cash))) : null, s.difference != null ? h('div.stat-row', h('span', 'Diferencia'), h('b', { class: Math.abs(s.difference) > 0.5 ? 'down' : 'up' }, fmt.money(s.difference))) : null, Object.entries(s.totals_by_method || s.totals_by_method_live || {}).map(([k, v]) => h('div.stat-row', h('span.text-2', me.paymentMethods.find(m => m.code === k)?.name || k), h('b', fmt.money(v)))))),
        s.close_notes ? h('div.alert.alert--info.mt-4', icon('info'), h('div', s.close_notes)) : null,
        h('div.mt-4', h('div.eyebrow.mb-2', 'Movimientos'), movementsTable(s.movements)),
        h('div.mt-4', h('div.eyebrow.mb-2', 'Ventas'), s.sales?.length ? h('div.table-wrap', h('table.table.table--compact', h('tbody', s.sales.map(v => h('tr.clickable', { onclick: () => location.hash = `#/sales/${v.id}` }, h('td', v.folio), h('td', fmt.time(v.sold_at)), h('td', badge('sale', v.status)), h('td.num', fmt.money(v.total))))))) : h('p.text-sm.text-3', 'Sin ventas.')));
    } catch (e) { replace(box, emptyState({ icon: 'alertCircle', title: 'No se pudo cargar', text: friendlyError(e) })); }
  }
  async function renderExpenses() {
    replace(body);
    const cats = await api.get('/expense-categories').catch(() => []);
    const btn = me.can('expenses.manage') ? h('button.btn.btn--primary.btn--sm', { onclick: () => openExpenseForm(null, () => t.reload(), cats) }, icon('plus'), 'Registrar gasto') : null;
    const t = new DataTable({ id: 'expenses', endpoint: '/expenses', defaultSort: '-expense_date', exportKey: 'finance_expenses', searchPlaceholder: 'Descripción…', emptyTitle: 'Sin gastos registrados', emptyIcon: 'wallet', emptyAction: me.can('expenses.manage') ? { label: 'Registrar gasto', onClick: () => openExpenseForm(null, () => t.reload(), cats) } : null, toolbar: [btn].filter(Boolean),
      filters: [{ key: 'expense', label: 'Fecha', type: 'daterange' }, { key: 'category', label: 'Categoría', type: 'select', options: cats.map(c => ({ value: c.id, label: c.name })) }, { key: 'method', label: 'Método', type: 'select', options: me.paymentMethods.map(m => ({ value: m.code, label: m.name })) }],
      columns: [
        { key: 'expense_date', label: 'Fecha', render: r => fmt.date(r.expense_date) },
        { key: 'description', label: 'Descripción', sortable: false, render: r => h('div', h('div.cell-main', r.description), h('div.cell-sub', [r.expense_categories?.name, r.suppliers?.name].filter(Boolean).join(' · '))) },
        { key: 'payment_method_code', label: 'Método', sortable: false, hideSm: true, render: r => me.paymentMethods.find(m => m.code === r.payment_method_code)?.name || r.payment_method_code || '—' },
        { key: 'branch', label: 'Sucursal', sortable: false, hideSm: true, render: r => r.branches?.name || '—' },
        { key: 'user', label: 'Registró', sortable: false, hideSm: true, render: r => fmt.name(r.users) },
        { key: 'receipt_url', label: '', sortable: false, render: r => r.receipt_url ? h('a.btn.btn--ghost.btn--sm.btn--icon', { href: r.receipt_url, target: '_blank', 'aria-label': 'Comprobante' }, icon('file')) : null },
        { key: 'amount', label: 'Monto', num: true, render: r => h('b', fmt.money(r.amount)) },
        { key: '_actions', label: '', render: r => me.can('expenses.manage') && !r.cash_shift_id ? h('div.row.gap-1', { style: { justifyContent: 'flex-end' } }, h('button.btn.btn--ghost.btn--sm.btn--icon', { 'aria-label': 'Editar', onclick: () => openExpenseForm(r, () => t.reload(), cats) }, icon('edit')), h('button.btn.btn--ghost.btn--sm.btn--icon', { 'aria-label': 'Eliminar', onclick: async () => { if (await confirm({ title: 'Eliminar gasto', text: r.description, confirmText: 'Eliminar', danger: true })) { try { await api.del(`/expenses/${r.id}`); toast('Gasto eliminado'); t.reload(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash'))) : null },
      ],
    }).mount(body);
  }
  function openExpenseForm(x, onDone, cats) {
    const f = {
      category: field({ label: 'Categoría', name: 'expense_category_id', type: 'select', required: true, options: cats.map(c => ({ value: c.id, label: c.name })), value: x?.expense_category_id, placeholder: 'Elige…' }),
      amount: field({ label: 'Monto', name: 'amount', type: 'number', min: 0.01, step: '0.01', prefix: '$', required: true, value: x?.amount }),
      desc: field({ label: 'Descripción', name: 'description', required: true, value: x?.description, span: 2 }),
      date: field({ label: 'Fecha', name: 'expense_date', type: 'date', value: x?.expense_date || fmt.dateInput(), required: true }),
      method: field({ label: 'Método de pago', name: 'payment_method_code', type: 'select', options: me.paymentMethods.map(m => ({ value: m.code, label: m.name })), value: x?.payment_method_code || 'TRANSFER' }),
      branch: field({ label: 'Sucursal', name: 'branch_id', type: 'select', options: me.branches, value: x?.branch_id || me.user?.default_branch_id }),
      fromShift: x ? null : field({ label: 'Sale del efectivo de mi turno abierto', name: 'from_shift', type: 'switch', value: false }),
      receipt: field({ label: 'Comprobante (imagen o PDF)', name: 'receipt', type: 'file', accept: 'image/*,application/pdf' }),
      notes: field({ label: 'Notas', name: 'notes', type: 'textarea', rows: 2, value: x?.notes, span: 2 }),
    };
    openModal({ title: x ? 'Editar gasto' : 'Registrar gasto', size: 'md', body: h('div.form-grid', f.category, f.amount, f.desc, f.date, f.method, me.branches.length > 1 ? f.branch : null, f.fromShift, f.receipt, f.notes),
      footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
        setLoading(e.target.closest('button'), true);
        try {
          let receiptUrl = x?.receipt_url || null;
          const file = f.receipt.input.files?.[0];
          if (file) { const fd = new FormData(); fd.append('file', file); fd.append('entity_type', 'EXPENSE'); receiptUrl = (await api.upload('/files', fd)).url; }
          const payload = { expense_category_id: f.category.input.value, amount: Number(f.amount.input.value), description: f.desc.input.value, expense_date: f.date.input.value, payment_method_code: f.method.input.value, branch_id: f.branch.input.value, notes: f.notes.input.value || null, receipt_url: receiptUrl };
          if (x) await api.patch(`/expenses/${x.id}`, payload);
          else { let shiftId = null; if (f.fromShift.querySelector('input').checked) { const cur = await api.get('/cash/shifts/current'); shiftId = cur.shift?.id; if (!shiftId) throw new Error('No tienes un turno abierto.'); payload.payment_method_code = 'CASH'; } await api.post('/expenses', { ...payload, cash_shift_id: shiftId }); }
          toast('Gasto guardado'); m.close(); onDone?.();
        } catch (err) { toast.error(friendlyError(err) || err.message); setLoading(e.target.closest('button'), false); }
      } }, 'Guardar')] });
  }
}
