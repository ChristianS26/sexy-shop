// ═══════════════════════════════════════════════════════════════════════════
// Configuración — usuarios, roles, sucursales/almacenes/cajas, categorías, marcas,
// métodos de pago, promociones, importación, auditoría y sistema
// ═══════════════════════════════════════════════════════════════════════════
import { api, friendlyError } from '../core/api.js';
import { me } from '../core/auth.js';
import { h, icon, fmt, replace, badge, $ } from '../core/dom.js';
import { DataTable } from '../ui/table.js';
import { openModal, openDrawer, confirm, toast, dropdown } from '../ui/overlay.js';
import { field, formData, showErrors, setLoading, spinner, emptyState, tabs } from '../ui/widgets.js';
import { loadCatalogRefs } from './products.js';

export const routes = ['/settings/:page'];
export const title = 'Configuración';
export const crumb = 'Configuración';

const PAGES = { users: 'Usuarios', roles: 'Roles y permisos', branches: 'Sucursales y almacenes', categories: 'Categorías', brands: 'Marcas', 'payment-methods': 'Métodos de pago', promotions: 'Promociones', import: 'Importar datos', audit: 'Auditoría', system: 'Sistema' };

export async function render(root, ctx) {
  const page = ctx.params.page;
  ctx.setTitle(PAGES[page] || 'Configuración', 'Configuración');
  const fn = ({ users, roles, branches, categories, brands, 'payment-methods': paymentMethods, promotions, import: importer, audit, system })[page];
  if (!fn) { replace(root, emptyState({ icon: 'settings', title: 'Sección no encontrada' })); return; }
  // mismas reglas que el menú: si el rol no tiene permiso, la sección no se muestra
  const PERMS = { users: ['users.read'], roles: ['roles.manage', 'users.read'], branches: ['branches.manage'], categories: ['categories.manage', 'products.read'], brands: ['brands.manage', 'products.read'], 'payment-methods': ['settings.manage'], promotions: ['promotions.manage', 'sales.create'], import: ['products.import', 'customers.create', 'suppliers.manage', 'inventory.adjust'], audit: ['audit.read'], system: ['settings.manage'] };
  if (!me.can(...(PERMS[page] || []))) { replace(root, h('div.empty', h('div.empty__icon', icon('lock')), h('div.empty__title', 'Sin acceso'), h('div.empty__text', 'Tu rol no tiene permiso para ver esta sección.'))); return; }
  await fn(root, ctx);
}

// ── Usuarios ────────────────────────────────────────────────────────────────
async function users(root) {
  if (!me.can('users.read')) return replace(root, emptyState({ icon: 'lock', title: 'Sin acceso' }));
  const roles = await api.get('/roles');
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Usuarios'), h('p.page-head__sub', 'Cuentas del equipo con rol, sucursal y estado. Las contraseñas se guardan con hash en Supabase Auth; nunca se muestran.')), h('div.page-head__actions', me.can('users.create') ? h('button.btn.btn--primary', { onclick: () => openUserForm(null, roles, () => table.reload()) }, icon('plus'), 'Nuevo usuario') : null)));
  const box = h('div'); root.append(box);
  const table = new DataTable({ id: 'users', endpoint: '/users', defaultSort: 'first_name', searchPlaceholder: 'Nombre, correo o usuario…', emptyTitle: 'Sin usuarios', emptyIcon: 'users',
    filters: [{ key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo'], ['SUSPENDED', 'Suspendido']].map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'first_name', label: 'Usuario', render: r => h('div.row.gap-2', { style: { flexWrap: 'nowrap' } }, h('div.avatar', fmt.initials(r)), h('div', h('div.cell-main', fmt.name(r)), h('div.cell-sub', `@${r.username} · ${r.email}`))) },
      { key: 'roles', label: 'Rol', sortable: false, render: r => h('div.row.gap-1', (r.roles || []).map(x => h('span.badge.badge--primary', x.name))) },
      { key: 'branches', label: 'Sucursales', sortable: false, hideSm: true, render: r => (r.branches || []).map(b => b.name).join(', ') || '—' },
      { key: 'phone', label: 'Teléfono', sortable: false, hideSm: true, render: r => r.phone || '—' },
      { key: 'last_login_at', label: 'Último acceso', render: r => r.last_login_at ? fmt.relative(r.last_login_at) : h('span.text-3', 'Nunca') },
      { key: 'created_at', label: 'Alta', hideSm: true, render: r => fmt.date(r.created_at) },
      { key: 'status', label: 'Estado', render: r => badge('user', r.status) },
      { key: '_actions', label: '', render: r => dropdown(h('button.btn.btn--ghost.btn--icon.btn--sm', { 'aria-label': 'Acciones' }, icon('more')), () => [
        me.can('users.update') ? { label: 'Editar', icon: 'edit', onClick: () => openUserForm(r, roles, () => table.reload()) } : null,
        me.can('users.update') ? { label: r.status === 'ACTIVE' ? 'Desactivar' : 'Activar', icon: r.status === 'ACTIVE' ? 'eyeOff' : 'check', onClick: async () => { try { const off = r.status === 'ACTIVE'; await api.post(`/users/${r.id}/status`, { status: off ? 'INACTIVE' : 'ACTIVE' }); toast(off ? `${fmt.name(r)} ya no puede iniciar sesión. Su historial se conserva.` : `${fmt.name(r)} puede volver a iniciar sesión.`, { title: off ? 'Usuario desactivado' : 'Usuario activado' }); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } } : null,
        me.can('users.update') ? { label: 'Enviar recuperación de contraseña', icon: 'send', onClick: async () => { try { await api.post(`/users/${r.id}/recover`); toast(`Le llegará un enlace a ${r.email} para elegir una contraseña nueva.`, { title: 'Correo de recuperación enviado' }); } catch (e) { toast.error(friendlyError(e)); } } } : null,
        me.can('users.update') ? { label: 'Asignar contraseña', icon: 'key', onClick: () => setPassword(r) } : null,
        me.can('users.delete') ? { sep: true } : null, me.can('users.delete') ? { label: 'Eliminar', icon: 'trash', danger: true, onClick: async () => { if (await confirm({ title: `Eliminar a ${fmt.name(r)}`, text: 'Perderá el acceso. Su historial (ventas, auditoría) se conserva.', confirmText: 'Eliminar', danger: true })) { try { await api.del(`/users/${r.id}`); toast(`${fmt.name(r)} perdió el acceso; sus ventas y su registro en auditoría se conservan.`, { title: 'Usuario eliminado' }); table.reload(); } catch (e) { toast.error(friendlyError(e)); } } } } : null]) },
    ] }).mount(box);
  function setPassword(u) { const p = field({ label: 'Nueva contraseña (mínimo 8 caracteres)', name: 'password', type: 'password' }); openModal({ title: `Contraseña de ${fmt.name(u)}`, body: p, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { if (p.input.value.length < 8) return toast.warn('La contraseña debe tener al menos 8 caracteres.'); setLoading(e.target.closest('button'), true); try { await api.post(`/users/${u.id}/password`, { password: p.input.value }); toast(`Compártela con ${fmt.name(u)} de forma segura; puede cambiarla en Mi perfil.`, { title: 'Contraseña asignada' }); m.close(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] }); }
}
function openUserForm(u, roles, onDone) {
  const form = h('form', { novalidate: true });
  const roleChecks = roles.map(r => h('label.check', h('input', { type: 'checkbox', name: 'role', value: r.id, checked: (u?.roles || []).some(x => x.id === r.id), disabled: r.code === 'SUPER_ADMIN' && !me.isSuperAdmin }), h('span', r.name, h('span.text-xs.text-3', ` · ${r.description || ''}${r.max_discount_pct != null ? ` · desc. máx ${r.max_discount_pct} %` : ''}`))));
  const branchChecks = (me.data?.all_branches || []).map(b => h('label.check', h('input', { type: 'checkbox', name: 'branch', value: b.id, checked: (u?.branches || []).some(x => x.id === b.id) }), b.name));
  form.append(h('div.form-grid', field({ label: 'Nombre', name: 'first_name', required: true, value: u?.first_name }), field({ label: 'Apellidos', name: 'last_name', value: u?.last_name }), field({ label: 'Correo', name: 'email', type: 'email', required: true, value: u?.email }), field({ label: 'Teléfono', name: 'phone', type: 'tel', value: u?.phone }), field({ label: 'Usuario', name: 'username', required: true, value: u?.username, hint: 'Único, sin espacios.' }), u ? null : field({ label: 'Contraseña inicial', name: 'password', type: 'password', required: true, hint: 'Mínimo 8 caracteres. La persona puede cambiarla desde su perfil.', autocomplete: 'new-password' }), field({ label: 'Sucursal principal', name: 'default_branch_id', type: 'select', options: me.data?.all_branches || [], value: u?.default_branch_id, placeholder: 'Elige…' })),
    h('div.form-section', h('div.form-section__title', icon('shield'), 'Roles'), h('div.stack', { style: { gap: '6px' } }, roleChecks)),
    h('div.form-section', h('div.form-section__title', icon('store'), 'Acceso a sucursales'), h('div.row.gap-4', branchChecks)));
  openDrawer({ title: u ? `Editar ${fmt.name(u)}` : 'Nuevo usuario', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
    const data = formData(form); delete data.role; delete data.branch;
    data.role_ids = [...form.querySelectorAll('input[name="role"]:checked')].map(x => x.value); data.branch_ids = [...form.querySelectorAll('input[name="branch"]:checked')].map(x => x.value);
    const local = {};
    if (!data.first_name?.trim()) local.first_name = 'El nombre es obligatorio.';
    if (!data.email?.trim()) local.email = 'El correo es obligatorio: con él inicia sesión.'; else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) local.email = 'Escribe un correo válido.';
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(data.username || '')) local.username = 'De 3 a 30 caracteres, sin espacios (letras, números, punto o guion).';
    if (!u && (data.password || '').length < 8) local.password = 'Mínimo 8 caracteres.';
    if (Object.keys(local).length) { showErrors(form, { details: local }); toast.warn(Object.values(local)[0], { title: 'Revisa los campos marcados' }); return; }
    if (!data.role_ids.length) return toast.warn('Asigna al menos un rol: define qué puede hacer la persona.');
    if (!data.branch_ids.length) return toast.warn('Marca al menos una sucursal a la que tenga acceso.');
    setLoading(e.target.closest('button'), true);
    try { if (u) await api.patch(`/users/${u.id}`, data); else await api.post('/users', data); const rn = roles.filter(r => data.role_ids.includes(r.id)).map(r => r.name).join(', '); toast(u ? `${data.first_name} · ${rn}` : `${data.first_name} (${rn}) ya puede entrar con ${data.email} y la contraseña inicial.`, { title: u ? 'Usuario actualizado' : 'Usuario creado', timeout: 6000 }); m.close(); onDone?.(); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); }
  } }, 'Guardar')] });
}

// ── Roles ───────────────────────────────────────────────────────────────────
async function roles(root) {
  const [roleList, perms] = await Promise.all([api.get('/roles'), api.get('/permissions')]);
  const byModule = perms.reduce((m, p) => { (m[p.module] ||= []).push(p); return m; }, {});
  const MOD = { catalog: 'Catálogo', inventory: 'Inventario', purchasing: 'Compras', sales: 'Ventas', customers: 'Clientes', cash: 'Caja', bi: 'Analytics', reports: 'Reportes', admin: 'Administración' };
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Roles y permisos'), h('p.page-head__sub', 'RBAC real: el backend valida cada permiso. Los roles del sistema solo los edita un super administrador; puedes crear roles propios.')), h('div.page-head__actions', me.can('roles.manage') ? h('button.btn.btn--primary', { onclick: () => openRoleForm(null) }, icon('plus'), 'Nuevo rol') : null)));
  const grid = h('div.grid.grid--2');
  root.append(grid);
  replace(grid, roleList.map(r => h('div.card', h('div.card__head', h('div', h('div.card__title', r.name, r.is_system ? h('span.badge', { style: { marginLeft: '8px' } }, 'sistema') : null), h('div.card__sub', `${r.code} · ${r.description || ''}${r.max_discount_pct != null ? ` · descuento máx. ${r.max_discount_pct} %` : ' · sin límite de descuento'}`)), me.can('roles.manage') && (!r.is_system || me.isSuperAdmin) ? h('button.btn.btn--ghost.btn--sm', { onclick: () => openRoleForm(r) }, icon('edit'), 'Editar') : null),
    h('div.card__body', h('div.row.gap-1', (r.permissions || []).map(p => h('span.badge', p)), !(r.permissions || []).length ? h('span.text-sm.text-3', 'Sin permisos') : null)))));
  function openRoleForm(r) {
    const code = field({ label: 'Código', name: 'code', value: r?.code, required: true, disabled: !!r, placeholder: 'EJ. CAJERO' });
    const name = field({ label: 'Nombre', name: 'name', value: r?.name, required: true });
    const desc = field({ label: 'Descripción', name: 'description', value: r?.description, span: 2 });
    const maxD = field({ label: 'Descuento máximo (%) · vacío = sin límite', name: 'max_discount_pct', type: 'number', min: 0, max: 100, value: r?.max_discount_pct });
    const checks = {};
    const permBox = h('div.stack', Object.entries(byModule).map(([mod, list]) => h('div.form-section', h('div.form-section__title', MOD[mod] || mod, h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => { const all = list.every(p => checks[p.code].checked); list.forEach(p => { checks[p.code].checked = !all; }); } }, 'Todos')), h('div.grid.grid--2', { style: { gap: '6px' } }, list.map(p => h('label.check', (checks[p.code] = h('input', { type: 'checkbox', checked: (r?.permissions || []).includes(p.code) })), h('span', p.code, h('span.text-xs.text-3', ` · ${p.description}`))))))));
    openDrawer({ title: r ? `Editar rol ${r.name}` : 'Nuevo rol', size: 'lg', body: [h('div.form-grid', code, name, desc, maxD), permBox], footer: (m) => [r && !r.is_system ? h('button.btn.btn--danger-soft', { onclick: async () => { if (await confirm({ title: `Eliminar rol ${r.name}`, confirmText: 'Eliminar', danger: true })) { try { await api.del(`/roles/${r.id}`); toast(`El rol “${r.name}” ya no existe.`, { title: 'Rol eliminado' }); m.close(); roles(replace(root)); } catch (e) { toast.error(friendlyError(e)); } } } }, 'Eliminar') : null, h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => {
      const payload = { name: name.input.value.trim(), description: desc.input.value || null, max_discount_pct: maxD.input.value === '' ? null : Number(maxD.input.value), permissions: Object.entries(checks).filter(([, c]) => c.checked).map(([k]) => k) };
      if (!r && !/^[A-Za-z][A-Za-z0-9_ ]{1,29}$/.test(code.input.value.trim())) { toast.warn('El código debe empezar con letra y usar solo letras, números o guion bajo (ej. CAJERO).'); code.input.focus(); return; }
      if (!payload.name) { toast.warn('Escribe el nombre del rol.'); name.input.focus(); return; }
      if (payload.max_discount_pct != null && (payload.max_discount_pct < 0 || payload.max_discount_pct > 100)) { toast.warn('El descuento máximo debe estar entre 0 y 100 %.'); maxD.input.focus(); return; }
      if (!payload.permissions.length) { toast.warn('Marca al menos un permiso.'); return; }
      setLoading(e.target.closest('button'), true);
      try { if (r) await api.patch(`/roles/${r.id}`, payload); else await api.post('/roles', { ...payload, code: code.input.value.trim() }); toast(`${fmt.plural(payload.permissions.length, 'permiso', 'permisos')}${payload.max_discount_pct != null ? ` · descuento máx. ${payload.max_discount_pct} %` : ''}.`, { title: `Rol “${payload.name}” ${r ? 'actualizado' : 'creado'}` }); m.close(); roles(replace(root)); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); }
    } }, 'Guardar')] });
  }
}

// ── Sucursales, almacenes y cajas ───────────────────────────────────────────
async function branches(root) {
  const load = async () => { const [b, w, r] = await Promise.all([api.get('/branches', { all: 'true' }), api.get('/warehouses', { all: 'true' }), api.get('/cash-registers', { all: 'true' })]); return { b, w, r }; };
  const body = h('div');
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Sucursales y almacenes'), h('p.page-head__sub', 'Organización → Sucursal → Almacenes y cajas. Preparado para Guaymas Centro, San Carlos, Hermosillo o e-commerce.')), h('div.page-head__actions', h('button.btn.btn--primary', { onclick: () => edit('branches', null, OrgFields.branch, 'Nueva sucursal') }, icon('plus'), 'Nueva sucursal'))), body);
  const edit = (table, row, fields, title) => {
    const form = h('form', { novalidate: true }, h('div.form-grid', fields(row)));
    openModal({ title, size: 'md', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); const data = formData(form); const local = {}; if (!data.code?.trim()) local.code = 'El código es obligatorio.'; if (!data.name?.trim()) local.name = 'El nombre es obligatorio.'; if (Object.keys(local).length) { showErrors(form, { details: local }); toast.warn(Object.values(local)[0], { title: 'Revisa los campos marcados' }); setLoading(e.target.closest('button'), false); return; } try { if (row) await api.patch(`/${table}/${row.id}`, data); else await api.post(`/${table}`, data); const what = { branches: ['Sucursal', 'creada', 'actualizada'], warehouses: ['Almacén', 'creado', 'actualizado'], 'cash-registers': ['Caja', 'creada', 'actualizada'] }[table]; toast(row ? 'Los cambios quedaron guardados.' : (table === 'branches' ? 'Agrégale un almacén y una caja para empezar a vender.' : 'Ya está disponible para operar.'), { title: `${what[0]} “${data.name}” ${row ? what[2] : what[1]}` }); m.close(); renderAll(); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] });
  };
  const OrgFields = {
    branch: (b) => [field({ label: 'Código', name: 'code', required: true, value: b?.code, placeholder: 'GYM' }), field({ label: 'Nombre', name: 'name', required: true, value: b?.name }), field({ label: 'Teléfono', name: 'phone', value: b?.phone }), field({ label: 'Correo', name: 'email', type: 'email', value: b?.email }), field({ label: 'Calle y número', name: 'street', value: b?.street }), field({ label: 'Colonia', name: 'neighborhood', value: b?.neighborhood }), field({ label: 'Ciudad', name: 'city', value: b?.city || 'Guaymas' }), field({ label: 'Estado', name: 'state', value: b?.state || 'Sonora' }), field({ label: 'C.P.', name: 'zip', value: b?.zip }), field({ label: 'Activa', name: 'is_active', type: 'switch', value: b ? b.is_active : true })],
    warehouse: (w, bid) => [field({ label: 'Sucursal', name: 'branch_id', type: 'select', options: me.data?.all_branches || [], value: w?.branch_id || bid }), field({ label: 'Código', name: 'code', required: true, value: w?.code }), field({ label: 'Nombre', name: 'name', required: true, value: w?.name }), field({ label: 'Almacén principal de la sucursal', name: 'is_default', type: 'switch', value: w?.is_default }), field({ label: 'Surte la tienda en línea', name: 'is_default_online', type: 'switch', value: w?.is_default_online }), field({ label: 'Activo', name: 'is_active', type: 'switch', value: w ? w.is_active : true })],
    register: (r, bid) => [field({ label: 'Sucursal', name: 'branch_id', type: 'select', options: me.data?.all_branches || [], value: r?.branch_id || bid }), field({ label: 'Código', name: 'code', required: true, value: r?.code }), field({ label: 'Nombre', name: 'name', required: true, value: r?.name }), field({ label: 'Activa', name: 'is_active', type: 'switch', value: r ? r.is_active : true })],
  };
  async function renderAll() {
    replace(body, spinner());
    const { b, w, r } = await load();
    replace(body, b.map(br => h('div.card', h('div.card__head', h('div', h('div.card__title', br.name, br.is_default ? h('span.badge.badge--primary', { style: { marginLeft: '8px' } }, 'principal') : null, !br.is_active ? h('span.badge', { style: { marginLeft: '8px' } }, 'inactiva') : null), h('div.card__sub', `${br.code} · ${[br.street, br.neighborhood, br.city].filter(Boolean).join(', ') || 'Sin dirección'} · ${br.phone || ''}`)), h('div.row.gap-1', h('button.btn.btn--ghost.btn--sm', { onclick: () => edit('branches', br, OrgFields.branch, 'Editar sucursal') }, icon('edit'), 'Editar'))),
      h('div.card__body', h('div.grid.grid--2',
        h('div', h('div.row.row--between.mb-2', h('div.eyebrow', 'Almacenes'), h('button.btn.btn--ghost.btn--sm', { onclick: () => edit('warehouses', null, (x) => OrgFields.warehouse(x, br.id), 'Nuevo almacén') }, icon('plus'), 'Almacén')), w.filter(x => x.branch_id === br.id).map(x => h('div.stat-row', h('span', x.name, h('span.text-xs.text-3', ` · ${x.code}`), x.is_default ? h('span.badge', { style: { marginLeft: '6px' } }, 'principal') : null, x.is_default_online ? h('span.badge.badge--info', { style: { marginLeft: '6px' } }, 'online') : null, !x.is_active ? h('span.badge', { style: { marginLeft: '6px' } }, 'inactivo') : null), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => edit('warehouses', x, OrgFields.warehouse, 'Editar almacén') }, icon('edit'))))),
        h('div', h('div.row.row--between.mb-2', h('div.eyebrow', 'Cajas'), h('button.btn.btn--ghost.btn--sm', { onclick: () => edit('cash-registers', null, (x) => OrgFields.register(x, br.id), 'Nueva caja') }, icon('plus'), 'Caja')), r.filter(x => x.branch_id === br.id).map(x => h('div.stat-row', h('span', x.name, h('span.text-xs.text-3', ` · ${x.code}`), !x.is_active ? h('span.badge', { style: { marginLeft: '6px' } }, 'inactiva') : null), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => edit('cash-registers', x, OrgFields.register, 'Editar caja') }, icon('edit'))))))))));
  }
  await renderAll();
}

// ── Categorías ──────────────────────────────────────────────────────────────
async function categories(root) {
  const canEdit = me.can('categories.manage');
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Categorías'), h('p.page-head__sub', 'Jerarquía Categoría → Subcategoría. Nada está hardcodeado: crea las que necesites.')), h('div.page-head__actions', canEdit ? h('button.btn.btn--primary', { onclick: () => edit(null) }, icon('plus'), 'Nueva categoría') : null)));
  const body = h('div'); root.append(body);
  let flat = [];
  async function renderAll() {
    replace(body, spinner());
    const data = await api.get('/categories'); flat = data.flat;
    const row = (c, depth) => h('div.stat-row', { style: { paddingLeft: `${depth * 24}px` } }, h('span.row.gap-2', depth ? icon('chevronRight') : null, c.icon ? h('span', c.icon) : null, h('span', { class: depth ? '' : 'strong' }, c.name), h('span.badge', `${c.product_count} productos`), !c.is_active ? h('span.badge', 'inactiva') : null), canEdit ? h('div.row.gap-1', depth === 0 ? h('button.btn.btn--ghost.btn--sm', { onclick: () => edit(null, c.id) }, icon('plus'), 'Subcategoría') : null, h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => edit(c) }, icon('edit')), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: async () => { if (await confirm({ title: `Eliminar ${c.name}`, confirmText: 'Eliminar', danger: true })) { try { await api.del(`/categories/${c.id}`); toast(`“${c.name}” se eliminó.`, { title: 'Categoría eliminada' }); loadCatalogRefs(true); renderAll(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash'))) : null);
    replace(body, h('div.card', h('div.card__body', data.tree.length ? data.tree.map(c => [row(c, 0), (c.children || []).map(k => row(k, 1))]) : emptyState({ icon: 'grid', title: 'Sin categorías', action: canEdit ? { label: 'Crear categoría', onClick: () => edit(null) } : null }))));
  }
  function edit(c, parentId = null) {
    const form = h('form', { novalidate: true }, h('div.form-grid', field({ label: 'Nombre', name: 'name', required: true, value: c?.name }), field({ label: 'Icono (emoji)', name: 'icon', value: c?.icon, placeholder: '💧' }), field({ label: 'Categoría padre', name: 'parent_id', type: 'select', options: flat.filter(x => !x.parent_id && x.id !== c?.id).map(x => ({ value: x.id, label: x.name })), value: c?.parent_id || parentId, placeholder: 'Ninguna (nivel principal)' }), field({ label: 'Orden', name: 'display_order', type: 'number', value: c?.display_order ?? 0 }), field({ label: 'Descripción', name: 'description', value: c?.description, span: 2 }), c ? field({ label: 'Activa', name: 'is_active', type: 'switch', value: c.is_active }) : null));
    openModal({ title: c ? 'Editar categoría' : 'Nueva categoría', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); const d0 = formData(form); if (!d0.name?.trim()) { showErrors(form, { details: { name: 'El nombre es obligatorio.' } }); toast.warn('Escribe el nombre de la categoría.'); setLoading(e.target.closest('button'), false); return; } try { const d = formData(form); if (c) await api.patch(`/categories/${c.id}`, d); else await api.post('/categories', d); const parent = flat.find(x => x.id === d.parent_id)?.name; toast(parent ? `Subcategoría de ${parent}.` : 'Categoría de nivel principal.', { title: `Categoría “${d.name}” ${c ? 'actualizada' : 'creada'}` }); m.close(); loadCatalogRefs(true); renderAll(); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] });
  }
  await renderAll();
}

// ── Marcas ──────────────────────────────────────────────────────────────────
async function brands(root) {
  const canEdit = me.can('brands.manage');
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Marcas'), h('p.page-head__sub', 'Marcas con logo, sitio web y estado, relacionadas con los productos.')), h('div.page-head__actions', canEdit ? h('button.btn.btn--primary', { onclick: () => edit(null) }, icon('plus'), 'Nueva marca') : null)));
  const body = h('div'); root.append(body);
  async function renderAll() {
    replace(body, spinner());
    const list = await api.get('/brands');
    replace(body, list.length ? h('div.grid.grid--4', list.map(b => h('div.card', { style: { padding: '16px' } }, h('div.row.gap-2', h('div.thumb', b.logo_url ? h('img', { src: b.logo_url, alt: '' }) : icon('star')), h('div.flex-1', h('div.strong', b.name), h('div.text-xs.text-3', `${b.product_count} productos${b.website ? ' · ' + b.website.replace(/^https?:\/\//, '') : ''}`)), !b.is_active ? h('span.badge', 'inactiva') : null), canEdit ? h('div.row.gap-1.mt-4', h('button.btn.btn--ghost.btn--sm', { onclick: () => edit(b) }, icon('edit'), 'Editar'), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: async () => { if (await confirm({ title: `Eliminar ${b.name}`, confirmText: 'Eliminar', danger: true })) { try { await api.del(`/brands/${b.id}`); toast(`“${b.name}” se eliminó.`, { title: 'Marca eliminada' }); loadCatalogRefs(true); renderAll(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash'))) : null))) : emptyState({ icon: 'star', title: 'Sin marcas', action: canEdit ? { label: 'Crear marca', onClick: () => edit(null) } : null }));
  }
  function edit(b) {
    const form = h('form', { novalidate: true }, h('div.form-grid', field({ label: 'Nombre', name: 'name', required: true, value: b?.name }), field({ label: 'Sitio web', name: 'website', value: b?.website }), field({ label: 'Logo (URL)', name: 'logo_url', value: b?.logo_url, span: 2 }), field({ label: 'Descripción', name: 'description', type: 'textarea', rows: 2, value: b?.description, span: 2 }), b ? field({ label: 'Activa', name: 'is_active', type: 'switch', value: b.is_active }) : null));
    openModal({ title: b ? 'Editar marca' : 'Nueva marca', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); const d0 = formData(form); if (!d0.name?.trim()) { showErrors(form, { details: { name: 'El nombre es obligatorio.' } }); toast.warn('Escribe el nombre de la marca.'); setLoading(e.target.closest('button'), false); return; } try { const d = formData(form); if (b) await api.patch(`/brands/${b.id}`, d); else await api.post('/brands', d); toast(b ? 'Los cambios quedaron guardados.' : 'Ya puedes asignarla a tus productos.', { title: `Marca “${d.name}” ${b ? 'actualizada' : 'creada'}` }); m.close(); loadCatalogRefs(true); renderAll(); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] });
  }
  await renderAll();
}

// ── Métodos de pago e impuestos ─────────────────────────────────────────────
async function paymentMethods(root) {
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Métodos de pago e impuestos'), h('p.page-head__sub', 'Efectivo afecta el cajón; los demás solo el corte por método. Agrega nuevos métodos sin tocar código.'))));
  const body = h('div.grid.grid--2'); root.append(body);
  async function renderAll() {
    const [pm, tax] = await Promise.all([api.get('/payment-methods', { all: 'true' }), api.get('/tax-rates', { all: 'true' })]);
    replace(body, h('div.card', h('div.card__head', h('div.card__title', 'Métodos de pago'), h('button.btn.btn--primary.btn--sm', { onclick: () => editPm(null) }, icon('plus'), 'Nuevo')), h('div.card__body', pm.map(m => h('div.stat-row', h('span', h('b', m.name), h('span.text-xs.text-3', ` · ${m.code}${m.is_cash ? ' · efectivo' : ''}${m.requires_reference ? ' · requiere referencia' : ''}${m.fee_pct ? ` · comisión ${m.fee_pct} %` : ''}`), !m.is_active ? h('span.badge', { style: { marginLeft: '6px' } }, 'inactivo') : null), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => editPm(m) }, icon('edit')))))),
      h('div.card', h('div.card__head', h('div.card__title', 'Tasas de IVA'), h('button.btn.btn--primary.btn--sm', { onclick: () => editTax(null) }, icon('plus'), 'Nueva')), h('div.card__body', tax.map(t => h('div.stat-row', h('span', h('b', t.name), h('span.text-xs.text-3', ` · ${(t.rate * 100).toFixed(1)} %`), t.is_default ? h('span.badge.badge--primary', { style: { marginLeft: '6px' } }, 'por defecto') : null), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => editTax(t) }, icon('edit')))), h('p.text-xs.text-3.mt-4', 'Los precios de venta incluyen IVA (configurable en Sistema → Impuestos). El IVA por producto se elige en su ficha.'))));
  }
  function editPm(m) { const form = h('form', { novalidate: true }, h('div.form-grid', field({ label: 'Código', name: 'code', required: true, value: m?.code, disabled: !!m, placeholder: 'STRIPE' }), field({ label: 'Nombre', name: 'name', required: true, value: m?.name }), field({ label: 'Es efectivo (va al cajón)', name: 'is_cash', type: 'switch', value: m?.is_cash }), field({ label: 'Requiere referencia', name: 'requires_reference', type: 'switch', value: m?.requires_reference }), field({ label: 'Comisión (%)', name: 'fee_pct', type: 'number', min: 0, step: '0.01', value: m?.fee_pct ?? 0 }), field({ label: 'Orden', name: 'display_order', type: 'number', value: m?.display_order ?? 0 }), m ? field({ label: 'Activo', name: 'is_active', type: 'switch', value: m.is_active }) : null)); openModal({ title: m ? 'Editar método' : 'Nuevo método de pago', body: form, footer: (x) => [h('button.btn.btn--secondary', { onclick: () => x.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); try { const d = formData(form); if (!m && !/^[A-Z][A-Z0-9_]{1,29}$/.test((d.code || '').toUpperCase())) throw Object.assign(new Error('El código debe usar letras, números o guion bajo (ej. STRIPE).'), {}); if (!d.name?.trim()) throw new Error('Escribe el nombre del método de pago.'); if (!m) d.code = d.code.toUpperCase(); if (m) await api.patch(`/payment-methods/${m.id}`, d); else await api.post('/payment-methods', d); toast(m && d.is_active === false ? 'Quedó inactivo: ya no aparece en el POS; el historial se conserva.' : d.is_cash ? 'Aparece en el POS y afecta el efectivo esperado en el cajón.' : 'Aparece en el POS y en el corte por método.', { title: `Método “${d.name}” ${m ? (d.is_active === false ? 'desactivado' : 'actualizado') : 'creado'}` }); x.close(); renderAll(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] }); }
  function editTax(t) { const form = h('form', { novalidate: true }, h('div.form-grid', field({ label: 'Código', name: 'code', required: true, value: t?.code, disabled: !!t, placeholder: 'IVA8' }), field({ label: 'Nombre', name: 'name', required: true, value: t?.name }), field({ label: 'Tasa (%)', name: 'rate', type: 'number', min: 0, max: 99, step: '0.01', value: t ? Math.round(t.rate * 10000) / 100 : 16, suffix: '%' }), field({ label: 'Por defecto', name: 'is_default', type: 'switch', value: t?.is_default }), t ? field({ label: 'Activa', name: 'is_active', type: 'switch', value: t.is_active }) : null)); openModal({ title: t ? 'Editar tasa' : 'Nueva tasa de IVA', body: form, footer: (x) => [h('button.btn.btn--secondary', { onclick: () => x.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { setLoading(e.target.closest('button'), true); try { const d = formData(form); if (d.rate == null || d.rate < 0 || d.rate >= 100) throw new Error('La tasa debe estar entre 0 y 99 % (ej. 16).'); if (!d.name?.trim()) throw new Error('Escribe el nombre de la tasa.'); d.rate = Math.round(d.rate * 100) / 10000; if (!t) d.code = (d.code || '').toUpperCase(); if (t) await api.patch(`/tax-rates/${t.id}`, d); else await api.post('/tax-rates', d); toast(`${(d.rate * 100).toFixed(2).replace(/\.00$/, '')} %${d.is_default ? ' · tasa por defecto' : ''}.`, { title: `Tasa “${d.name}” ${t ? 'actualizada' : 'creada'}` }); x.close(); renderAll(); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] }); }
  await renderAll();
}

// ── Promociones ─────────────────────────────────────────────────────────────
async function promotions(root) {
  const canEdit = me.can('promotions.manage');
  const refs = await loadCatalogRefs();
  const TYPES = { PERCENT: 'Descuento %', FIXED: 'Descuento fijo por unidad', BUY_X_GET_Y: '2x1 / 3x2 (compra X, lleva Y gratis)', BUNDLE: 'Bundle (monto fijo al llevar el conjunto)', FREE_PRODUCT: 'Producto gratis por monto mínimo', CATEGORY_PERCENT: 'Descuento % por categoría', QUANTITY_DISCOUNT: 'Descuento por cantidad' };
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Promociones'), h('p.page-head__sub', 'Se aplican automáticamente en el POS. Los descuentos manuales son aparte y están limitados por rol.')), h('div.page-head__actions', canEdit ? h('button.btn.btn--primary', { onclick: () => edit(null) }, icon('plus'), 'Nueva promoción') : null)));
  const body = h('div'); root.append(body);
  async function renderAll() {
    replace(body, spinner());
    const list = await api.get('/promotions');
    const typeDesc = (p) => p.promo_type === 'BUY_X_GET_Y' ? `Compra ${p.buy_qty} lleva ${p.get_qty} gratis` : p.promo_type === 'QUANTITY_DISCOUNT' ? `${p.value} % desde ${p.min_quantity} uds` : p.promo_type === 'FREE_PRODUCT' ? `Regalo desde ${fmt.money(p.min_amount)}` : p.promo_type.includes('PERCENT') ? `${p.value} %` : fmt.money(p.value);
    const scope = (p) => [(p.promotion_products || []).map(x => x.products?.name).filter(Boolean).join(', '), (p.promotion_categories || []).map(x => x.categories?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const rowOf = (p) => h('tr',
      h('td', h('div.cell-main', p.name), h('div.cell-sub', p.description || '')),
      h('td', h('span.badge.badge--secondary', TYPES[p.promo_type]), h('div.cell-sub', typeDesc(p))),
      h('td.text-sm', scope(p) || h('span.text-3', 'Todo el catálogo')),
      h('td.text-sm', (p.starts_at ? fmt.date(p.starts_at) : '—') + ' → ' + (p.ends_at ? fmt.date(p.ends_at) : '∞')),
      h('td.num', String(p.uses_count) + (p.max_uses ? ' / ' + p.max_uses : '')),
      h('td', badge('generic', p.status)),
      h('td.actions', canEdit ? [h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: () => edit(p) }, icon('edit')), h('button.btn.btn--ghost.btn--sm.btn--icon', { onclick: async () => { if (await confirm({ title: 'Eliminar ' + p.name, confirmText: 'Eliminar', danger: true })) { try { await api.del('/promotions/' + p.id); toast(p.uses_count > 0 ? 'Ya se había usado, así que quedó inactiva para conservar el historial.' : 'Ya no se aplicará en el POS.', { title: `Promoción “${p.name}” ${p.uses_count > 0 ? 'desactivada' : 'eliminada'}` }); renderAll(); } catch (e) { toast.error(friendlyError(e)); } } } }, icon('trash'))] : null));
    const table = h('div.card', h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Promoción'), h('th', 'Tipo'), h('th', 'Aplica a'), h('th', 'Vigencia'), h('th.num', 'Usos'), h('th', 'Estado'), h('th', ''))), h('tbody', list.map(rowOf)))));
    replace(body, list.length ? table : emptyState({ icon: 'gift', title: 'Sin promociones', text: 'Crea 2x1, descuentos por categoría o bundles.', action: canEdit ? { label: 'Nueva promoción', onClick: () => edit(null) } : null }));
  }
  function edit(p) {
    const type = field({ label: 'Tipo', name: 'promo_type', type: 'select', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })), value: p?.promo_type || 'PERCENT', onChange: upd });
    const value = field({ label: 'Valor (% o monto)', name: 'value', type: 'number', min: 0, step: '0.01', value: p?.value ?? 10 });
    const buy = field({ label: 'Compra (X)', name: 'buy_qty', type: 'number', min: 1, value: p?.buy_qty ?? 1 }); const get = field({ label: 'Lleva gratis (Y)', name: 'get_qty', type: 'number', min: 1, value: p?.get_qty ?? 1 });
    const minQ = field({ label: 'Cantidad mínima', name: 'min_quantity', type: 'number', min: 2, value: p?.min_quantity ?? 3 });
    const minA = field({ label: 'Monto mínimo del carrito', name: 'min_amount', type: 'number', min: 0, step: '0.01', value: p?.min_amount });
    const freeP = field({ label: 'Producto de regalo', name: 'free_product_id', type: 'select', options: [], placeholder: 'Elige el producto…', hint: 'Se agrega gratis al carrito cuando se alcanza el monto mínimo.' });
    const prodSel = h('select.select', { multiple: true, size: 6, name: 'product_ids' }); const catSel = h('select.select', { multiple: true, size: 6, name: 'category_ids' }, refs.categories.map(c => h('option', { value: c.id, selected: (p?.promotion_categories || []).some(x => x.category_id === c.id) }, c.parent_id ? `— ${c.name}` : c.name)));
    api.get('/products', { size: 200, sort: 'name', active: 'true' }).then(r => r.data.forEach(x => { prodSel.appendChild(h('option', { value: x.id, selected: (p?.promotion_products || []).some(y => y.product_id === x.id) }, x.name)); freeP.input.appendChild(h('option', { value: x.id, selected: p?.free_product_id === x.id }, `${x.name} · ${fmt.money(x.price)}`)); })).catch(e => toast.error(friendlyError(e), { title: 'No se cargó la lista de productos' }));
    const form = h('form', { novalidate: true }, h('div.form-grid', field({ label: 'Nombre', name: 'name', required: true, value: p?.name, span: 2 }), field({ label: 'Descripción', name: 'description', value: p?.description, span: 2 }), type, value, buy, get, minQ, minA, freeP, field({ label: 'Máximo de usos', name: 'max_uses', type: 'number', min: 1, value: p?.max_uses }), field({ label: 'Inicio', name: 'starts_at', type: 'datetime-local', value: p?.starts_at?.slice(0, 16) }), field({ label: 'Fin', name: 'ends_at', type: 'datetime-local', value: p?.ends_at?.slice(0, 16) }), field({ label: 'Estado', name: 'status', type: 'select', options: [{ value: 'ACTIVE', label: 'Activa' }, { value: 'INACTIVE', label: 'Inactiva' }], value: p?.status || 'ACTIVE' })),
      h('div.form-section', h('div.form-section__title', 'Aplica a', h('span.text-xs.text-3', '(vacío = todo el catálogo; Ctrl+clic para varios)')), h('div.form-grid', h('div.field', h('label.field__label', 'Productos'), prodSel), h('div.field', h('label.field__label', 'Categorías'), catSel))));
    function upd() { const t = type.input.value; value.hidden = t === 'BUY_X_GET_Y' || t === 'FREE_PRODUCT'; buy.hidden = get.hidden = t !== 'BUY_X_GET_Y'; minQ.hidden = t !== 'QUANTITY_DISCOUNT'; freeP.hidden = t !== 'FREE_PRODUCT'; } upd();
    openDrawer({ title: p ? 'Editar promoción' : 'Nueva promoción', size: 'lg', body: form, footer: (m) => [h('button.btn.btn--secondary', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.btn--primary', { onclick: async (e) => { const v = formData(form); const t = v.promo_type; const local = {};
      if (!v.name?.trim()) local.name = 'El nombre es obligatorio.';
      if (['PERCENT', 'CATEGORY_PERCENT', 'QUANTITY_DISCOUNT'].includes(t) && !(v.value > 0 && v.value <= 100)) local.value = 'El porcentaje debe estar entre 1 y 100.';
      if (['FIXED', 'BUNDLE'].includes(t) && !(v.value > 0)) local.value = 'El monto debe ser mayor a $0.';
      if (t === 'BUY_X_GET_Y' && !(v.buy_qty >= 1 && v.get_qty >= 1)) local.buy_qty = 'Indica cuántas compra y cuántas lleva gratis.';
      if (t === 'QUANTITY_DISCOUNT' && !(v.min_quantity >= 2)) local.min_quantity = 'La cantidad mínima debe ser 2 o más.';
      if (t === 'FREE_PRODUCT' && !v.free_product_id) local.free_product_id = 'Elige el producto de regalo.';
      if (t === 'FREE_PRODUCT' && !(v.min_amount > 0)) local.min_amount = 'Indica el monto mínimo del carrito.';
      if (t === 'CATEGORY_PERCENT' && !catSel.selectedOptions.length) local.value = 'Elige al menos una categoría en “Aplica a”.';
      if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) local.ends_at = 'El fin debe ser posterior al inicio.';
      if (Object.keys(local).length) { showErrors(form, { details: local }); toast.warn(Object.values(local)[0], { title: 'Revisa los campos marcados' }); return; }
      setLoading(e.target.closest('button'), true); try { const d = formData(form); delete d.product_ids; delete d.category_ids; d.product_ids = [...prodSel.selectedOptions].map(o => o.value); d.category_ids = [...catSel.selectedOptions].map(o => o.value); if (d.starts_at) d.starts_at = new Date(d.starts_at).toISOString(); if (d.ends_at) d.ends_at = new Date(d.ends_at).toISOString(); if (p) await api.patch(`/promotions/${p.id}`, d); else await api.post('/promotions', d); toast(d.status === 'ACTIVE' ? 'Se aplicará sola en el POS cuando el carrito cumpla la condición.' : 'Quedó inactiva; actívala cuando quieras usarla.', { title: `Promoción “${d.name}” ${p ? 'actualizada' : 'creada'}` }); m.close(); renderAll(); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: err?.details ? 'Revisa los campos marcados' : null }); setLoading(e.target.closest('button'), false); } } }, 'Guardar')] });
  }
  await renderAll();
}

// ── Importación ─────────────────────────────────────────────────────────────
async function importer(root) {
  const ENT = { products: { label: 'Productos', perm: 'products.import', cols: 'nombre, precio, costo, sku, codigo_de_barras, categoria, marca, proveedor, descripcion, stock_minimo, stock_maximo', note: 'Si el SKU ya existe se actualiza el producto. Categoría, marca y proveedor deben existir (por nombre).' }, customers: { label: 'Clientes', perm: 'customers.create', cols: 'nombre, apellidos, telefono, correo, colonia, calle, numero, cp, ciudad, estado, notas', note: 'El teléfono debe ser único.' }, suppliers: { label: 'Proveedores', perm: 'suppliers.manage', cols: 'nombre, contacto, telefono, correo, ciudad, estado, notas', note: '' }, inventory: { label: 'Inventario inicial', perm: 'inventory.adjust', cols: 'sku (o codigo_de_barras), cantidad, costo', note: 'Genera un ajuste INITIAL_STOCK con movimientos por producto en el almacén elegido.' } };
  const entities = Object.entries(ENT).filter(([, v]) => me.can(v.perm));
  if (!entities.length) return replace(root, emptyState({ icon: 'lock', title: 'Sin acceso' }));
  let entity = entities[0][0];
  const entSel = h('select.select', { style: { width: 'auto' } }, entities.map(([k, v]) => h('option', { value: k }, v.label)));
  const whSel = field({ label: 'Almacén destino', name: 'warehouse_id', type: 'select', options: me.warehouses, value: me.warehouses[0]?.id });
  const file = h('input', { type: 'file', accept: '.csv,.xlsx,text/csv', hidden: true });
  const drop = h('div.empty', { style: { border: '2px dashed var(--color-border-strong)', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }, onclick: () => file.click() }, h('div.empty__icon', icon('upload')), h('div.empty__title', 'Arrastra tu archivo o haz clic'), h('div.empty__text', 'CSV o Excel (.xlsx). Primera fila = encabezados.'));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.background = 'var(--color-primary-soft)'; }); drop.addEventListener('dragleave', () => { drop.style.background = ''; }); drop.addEventListener('drop', e => { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer.files[0]) preview(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) preview(file.files[0]); });
  const info = h('div.alert.alert--info'); const result = h('div');
  const renderInfo = () => { const e = ENT[entity]; replace(info, icon('info'), h('div', h('div.alert__title', `Columnas para ${e.label}`), h('div.alert__text', h('code', e.cols)), e.note ? h('div.alert__text', e.note) : null)); whSel.hidden = entity !== 'inventory'; };
  entSel.addEventListener('change', () => { entity = entSel.value; renderInfo(); replace(result); });
  renderInfo();
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Importar datos'), h('p.page-head__sub', 'Previsualiza, revisa errores por fila y confirma. Solo se importan las filas válidas.'))),
    h('div.card', h('div.card__body', h('div.stack', h('div.row.gap-4', h('div.field', h('label.field__label', 'Qué importar'), entSel), whSel), info, drop, file))), result);
  async function preview(f) {
    replace(result, h('div.card', h('div.card__body', spinner())));
    const fd = new FormData(); fd.append('file', f);
    try {
      const p = await api.upload(`/import/${entity}/preview`, fd);
      const invalid = p.rows.filter(r => !r.valid);
      replace(result, h('div.card', h('div.card__head', h('div', h('div.card__title', `${p.total} filas · ${p.valid} válidas · ${p.invalid} con errores`), h('div.card__sub', f.name)), h('div.row.gap-2', invalid.length ? h('button.btn.btn--secondary.btn--sm', { onclick: () => downloadErrors(invalid) }, icon('download'), 'Descargar errores') : null, p.valid ? h('button.btn.btn--primary', { onclick: async (e) => { if (!(await confirm({ title: `Importar ${p.valid} filas`, text: 'Las filas con errores se omiten.', confirmText: 'Importar' }))) return; setLoading(e.target.closest('button'), true); try { const r = await api.post(`/import/${entity}/commit`, { rows: p.rows.filter(x => x.valid).map(x => ({ ...x.data, row: x.row })), warehouse_id: whSel.input.value }); (r.failed?.length ? toast.warn : toast)(`${r.created} creados · ${r.updated} actualizados${r.failed?.length ? ` · ${r.failed.length} no se pudieron importar (revisa la tabla)` : ''}.`, { title: 'Importación terminada' }); replace(result, h('div.alert.alert--success', icon('checkCircle'), h('div', h('div.alert__title', 'Importación completada'), h('div.alert__text', `${r.created} creados · ${r.updated} actualizados · ${r.failed?.length || 0} fallidos`)))); loadCatalogRefs(true); } catch (err) { toast.error(friendlyError(err)); setLoading(e.target.closest('button'), false); } } }, icon('check'), `Importar ${p.valid} filas`) : null)),
        h('div.table-wrap', h('table.table.table--compact', h('thead', h('tr', h('th', 'Fila'), h('th', 'Estado'), h('th', 'Datos'), h('th', 'Errores'))), h('tbody', p.rows.slice(0, 300).map(r => h('tr', h('td', r.row), h('td', r.valid ? h('span.badge.badge--success', 'OK') : h('span.badge.badge--danger', 'Error')), h('td.text-xs', Object.entries(r.data).filter(([k, v]) => v != null && !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join(' · ')), h('td.text-xs.down', (r.errors || []).join('; ')))))), p.rows.length > 300 ? h('div.table-foot', `Mostrando 300 de ${p.rows.length}`) : null)));
    } catch (e) { replace(result, emptyState({ icon: 'alertCircle', title: 'No se pudo leer el archivo', text: friendlyError(e) })); }
  }
  function downloadErrors(rows) { const csv = '﻿fila,errores\r\n' + rows.map(r => `${r.row},"${(r.errors || []).join('; ').replace(/"/g, '""')}"`).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'errores-importacion.csv'; a.click(); }
}

// ── Auditoría ───────────────────────────────────────────────────────────────
async function audit(root) {
  if (!me.can('audit.read')) return replace(root, emptyState({ icon: 'lock', title: 'Sin acceso' }));
  const [users, actions] = await Promise.all([api.get('/users', { size: 100 }).catch(() => ({ data: [] })), api.get('/audit/actions').catch(() => [])]);
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Auditoría'), h('p.page-head__sub', 'Bitácora inmutable: quién hizo qué, cuándo, desde dónde y con qué valores antes y después. No se puede editar ni borrar desde el sistema.'))));
  const box = h('div'); root.append(box);
  const LBL = { 'auth.login': 'Inicio de sesión', 'auth.logout': 'Cierre de sesión', 'sales.create': 'Venta creada', 'sales.cancel': 'Venta cancelada', 'sales.refund': 'Devolución', 'sales.discount': 'Descuento aplicado', 'products.price.update': 'Cambio de precio/costo', 'cash.open': 'Apertura de caja', 'cash.close': 'Cierre de caja', 'inventory.adjust': 'Ajuste de inventario', 'users.create': 'Usuario creado', 'roles.update': 'Permisos modificados', 'customers.view': 'Consulta de cliente' };
  new DataTable({ id: 'audit', endpoint: '/audit', defaultSort: '-created_at', searchPlaceholder: 'Acción, usuario o entidad…', emptyTitle: 'Sin registros', emptyIcon: 'lock',
    filters: [{ key: 'created', label: 'Fecha', type: 'daterange' }, { key: 'user', label: 'Usuario', type: 'select', options: users.data.map(u => ({ value: u.id, label: fmt.name(u) })) }, { key: 'action', label: 'Acción', type: 'select', options: actions.map(a => ({ value: a, label: LBL[a] || a })) }, { key: 'entity_type', label: 'Entidad', type: 'select', options: ['SALE', 'PRODUCT', 'CUSTOMER', 'USER', 'CASH_SHIFT', 'ADJUSTMENT', 'TRANSFER', 'PURCHASE_ORDER', 'ROLE', 'SETTING'].map(e => ({ value: e, label: e })) }],
    columns: [{ key: 'created_at', label: 'Fecha', render: r => fmt.datetime(r.created_at) }, { key: 'user_name', label: 'Usuario', render: r => r.user_name || h('span.text-3', 'Sistema') }, { key: 'action', label: 'Acción', render: r => h('div', h('div.cell-main', LBL[r.action] || r.action), h('div.cell-sub.mono', r.action)) }, { key: 'entity', label: 'Entidad', sortable: false, render: r => r.entity_type ? h('div', h('div', r.entity_type), h('div.cell-sub.mono', (r.entity_id || '').slice(0, 8))) : '—' }, { key: 'ip', label: 'IP', sortable: false, hideSm: true, render: r => r.ip || '—' }, { key: '_actions', label: '', render: r => h('button.btn.btn--ghost.btn--sm', { onclick: () => openModal({ title: `${LBL[r.action] || r.action}`, size: 'md', sub: `${r.user_name || 'Sistema'} · ${fmt.datetime(r.created_at)} · ${r.ip || ''}`, body: h('div.grid.grid--2', { style: { gap: '12px' } }, h('div', h('div.eyebrow.mb-2', 'Antes'), h('pre.mono.text-xs', { style: { whiteSpace: 'pre-wrap', background: 'var(--color-bg-muted)', padding: '10px', borderRadius: '8px', maxHeight: '50vh', overflow: 'auto' } }, JSON.stringify(r.before, null, 2) || '—')), h('div', h('div.eyebrow.mb-2', 'Después / metadata'), h('pre.mono.text-xs', { style: { whiteSpace: 'pre-wrap', background: 'var(--color-bg-muted)', padding: '10px', borderRadius: '8px', maxHeight: '50vh', overflow: 'auto' } }, JSON.stringify(r.after ?? r.metadata, null, 2) || '—'))) }) }, 'Detalle') }] }).mount(box);
}

// ── Sistema ─────────────────────────────────────────────────────────────────
async function system(root) {
  if (!me.can('settings.manage')) return replace(root, emptyState({ icon: 'lock', title: 'Sin acceso' }));
  const org = await api.get('/org');
  const s = org.settings || {};
  root.append(h('div.page-head', h('div', h('h1.page-head__title', 'Sistema'), h('p.page-head__sub', 'Empresa, impuestos, tickets, inventario, alertas y seguridad. Cada cambio queda auditado.'))));
  const sections = [
    { key: 'company', title: 'Empresa', fields: [['name', 'Nombre comercial'], ['tagline', 'Lema'], ['phone', 'Teléfono'], ['email', 'Correo'], ['website', 'Sitio web']], extra: 'org' },
    { key: 'locale', title: 'Moneda y zona horaria', fields: [['currency', 'Moneda', 'select', [['MXN', 'Peso mexicano (MXN)'], ['USD', 'Dólar (USD)']]], ['timezone', 'Zona horaria', 'select', [['America/Hermosillo', 'Sonora (sin horario de verano)'], ['America/Mexico_City', 'Centro de México'], ['America/Tijuana', 'Baja California'], ['America/Mazatlan', 'Pacífico (Sinaloa, Nayarit, BCS)'], ['America/Chihuahua', 'Chihuahua'], ['America/Monterrey', 'Noreste'], ['America/Cancun', 'Quintana Roo'], ['America/Merida', 'Yucatán y Campeche']]], ['country', 'País']] },
    { key: 'tax', title: 'Impuestos', fields: [['prices_include_tax', 'Los precios de venta incluyen IVA', 'switch'], ['default_rate_code', 'Tasa por defecto (código)']] },
    { key: 'ticket', title: 'Ticket', fields: [['header', 'Encabezado'], ['tagline', 'Lema'], ['footer', 'Pie de ticket'], ['show_customer', 'Mostrar nombre del cliente en el ticket', 'switch'], ['auto_print', 'Imprimir automáticamente al cobrar', 'switch'], ['width_mm', 'Ancho (mm)', 'number']] },
    { key: 'sales', title: 'Ventas', fields: [['folio_prefix', 'Prefijo de folio'], ['allow_cancel_days', 'Días para cancelar una venta', 'number'], ['require_shift_for_cash', 'Exigir turno de caja para cobrar en efectivo', 'switch']] },
    { key: 'inventory', title: 'Inventario', fields: [['default_min_stock', 'Stock mínimo por defecto', 'number'], ['dead_stock_days', 'Días sin venta = stock muerto', 'number'], ['cost_method', 'Método de costo', 'select', [['LAST', 'Último costo de compra'], ['AVERAGE', 'Costo promedio ponderado']]], ['allow_negative', 'Permitir stock negativo', 'switch']] },
    { key: 'alerts', title: 'Alertas y anomalías', fields: [['cash_difference_threshold', 'Diferencia de caja que genera alerta ($)', 'number'], ['cancellations_per_day', 'Cancelaciones por usuario al día', 'number'], ['discounts_pct_per_day', 'Descuento promedio diario por vendedor (%)', 'number'], ['returns_per_week', 'Devoluciones por semana', 'number']] },
    ...(me.can('settings.system') ? [{ key: 'security', title: 'Seguridad (super administrador)', fields: [['session_hours', 'Horas de sesión', 'number'], ['discreet_mode_default', 'Modo discreto por defecto', 'switch']] }] : []),
  ];
  const grid = h('div.grid.grid--2');
  root.append(grid, h('div.card.mt-4', h('div.card__head', h('div.card__title', 'Información del sistema')), h('div.card__body', h('div.stat-row', h('span', 'Organización'), h('b', `${org.name} · ${org.slug}`)), h('div.stat-row', h('span', 'Zona horaria'), h('b', org.timezone)), h('div.stat-row', h('span', 'Versión ERP'), h('b', '1.0.0')), h('div.stat-row', h('span', 'Logo'), h('span.text-sm.text-2', 'Coloca el archivo oficial en erp/img/logo.svg (ver erp/img/README.md).')))));
  for (const sec of sections) {
    const cur = s[sec.key] || {};
    const form = h('form', { novalidate: true }, h('div.form-grid', sec.fields.map(([k, label, type, opts]) => field({ label, name: k, type: type || 'text', value: sec.extra === 'org' && k in org ? org[k] : cur[k], options: opts ? opts.map(([value, l]) => ({ value, label: l })) : undefined }))));
    grid.appendChild(h('div.card', h('div.card__head', h('div.card__title', sec.title)), h('div.card__body', form, h('div.row.row--end.mt-4', h('button.btn.btn--primary.btn--sm', { onclick: async (e) => { setLoading(e.target.closest('button'), true); try { const d = formData(form); if (sec.extra === 'org') { await api.patch('/org', { name: d.name, tagline: d.tagline }); } await api.put(`/settings/${sec.key}`, { ...cur, ...d }); Object.assign(cur, d); showErrors(form, null); toast('Los cambios ya aplican en todo el sistema y quedaron en la auditoría.', { title: `${sec.title}: cambios guardados` }); } catch (err) { showErrors(form, err); toast.error(friendlyError(err), { title: `${sec.title}: no se guardó` }); } setLoading(e.target.closest('button'), false); } }, 'Guardar')))));
  }
}
