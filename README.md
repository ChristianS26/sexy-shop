# SONROJA — tienda en línea + ERP

Monorepo de SONROJA (antes SexyShop Guaymas): storefront público, checkout con Mercado Pago y el **ERP interno** (POS, inventario, compras, clientes, caja, analytics, reportes, auditoría).

```
SS App/
├── ss-app-backend/      Ktor 3 (Kotlin) · API /api/* (tienda) y /api/erp/* (ERP) · Railway
├── ss-app-frontend/     GitHub Pages
│   ├── index.html, js/, css/      storefront (sin cambios)
│   ├── admin.html                 admin legado (pedidos web, envíos)
│   └── erp/                       SONROJA ERP (SPA en ES modules, sin build)
├── supabase/migrations/ esquema del ERP (aditivo sobre la BD existente)
└── docs/                arquitectura, modelo de datos, API, permisos, reglas, despliegue
```

## Arranque rápido

| Qué | Cómo |
|---|---|
| Backend local | `cd ss-app-backend && cp .env.example .env` (llenar `SUPABASE_URL`, `SUPABASE_API_KEY` = service role, `SUPABASE_ANON_KEY`) y `./gradlew run`. Puerto 8080. |
| Pruebas backend | `./gradlew test` (unitarias + API de permisos; no requieren red) |
| Frontend ERP local | servir `ss-app-frontend/` con cualquier servidor estático (`npx serve ss-app-frontend` o Live Server) y abrir `/erp/`. Apunta a `http://localhost:8080/api` cuando corre en localhost. |
| Chequeo de sintaxis del ERP | `cd ss-app-frontend/erp && npm run check` |
| Migraciones | `supabase/migrations/*.sql` en orden (ya aplicadas al proyecto `litzzmjoiujifddkrryp`) |
| Datos demo | `select public.seed_demo_data();` crea la organización **Sonroja Demo** aislada (100 productos, 500 clientes, ~1 100 ventas de un año). `select public.purge_demo_data();` la elimina. |

### Usuarios

- Producción: el administrador existente (`christianug26@gmail.com`) quedó como `SUPER_ADMIN` de la organización SONROJA.
- Demo (organización aparte, contraseña `Sonroja2026!`): `demo.admin@sonroja.demo` (ADMIN), `demo.gerente@sonroja.demo` (MANAGER), `demo.ana@sonroja.demo` y `demo.lucia@sonroja.demo` (SALES), `demo.almacen@sonroja.demo` (WAREHOUSE).

## Documentación

- [Arquitectura y decisiones](docs/ARCHITECTURE.md)
- [Modelo de datos](docs/DATA_MODEL.md)
- [API del ERP](docs/API.md)
- [Roles y permisos](docs/PERMISSIONS.md)
- [Reglas de negocio](docs/BUSINESS_RULES.md)
- [Estrategia de Business Intelligence](docs/BI_STRATEGY.md)
- [Criterios de aceptación y flujo de prueba](docs/ACCEPTANCE.md)
- [Despliegue, entornos y respaldos](docs/DEPLOYMENT.md)

## Principio del producto

**Operación** (¿qué está pasando?) → **Inteligencia** (¿qué significa?) → **Acción** (¿qué debería hacer?). La navegación del ERP sigue esas tres zonas.
