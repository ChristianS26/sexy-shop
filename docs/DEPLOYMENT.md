# Despliegue, entornos y respaldos

## Entornos

| | Development | Staging | Production |
|---|---|---|---|
| Backend | `./gradlew run` local (puerto 8080) con `.env` | Railway (servicio aparte, misma imagen) | Railway `ss-app-backend-production` (auto-deploy al push a `main`) |
| Frontend | servidor estático local → `localhost:8080/api` | GitHub Pages de una rama `staging` (workflow `deploy-frontend.yml`) | GitHub Pages `sexyshoptoys.com.mx` (`/erp/`) |
| Base de datos | proyecto Supabase dev (pendiente: el plan gratuito permite 2 proyectos y están ocupados por SexyShop y MultiHaus) | mismo proyecto que dev | Supabase `litzzmjoiujifddkrryp` |
| Datos demo | `seed_demo_data()` | idem | organización **Sonroja Demo** aislada (`purge_demo_data()` para quitarla) |

Mientras no exista proyecto dev: la organización demo cumple el papel de staging dentro de producción sin mezclar datos (todas las tablas llevan `organization_id`; el storefront solo ve la organización por defecto).

## Variables de entorno del backend

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_API_KEY` (service role) | PostgREST, Storage, verificación de tokens, Admin API de Auth |
| `SUPABASE_ANON_KEY` | correos de recuperación de contraseña (`/auth/v1/recover`) |
| `SUPABASE_STORAGE_BUCKET` | `product-images` (imágenes y comprobantes bajo `erp/…`) |
| `ERP_SCHEDULER` | `false` desactiva la detección de anomalías programada |
| `MP_*`, `RESEND_*`, `NOTIFICATION_EMAIL`, `FRONTEND_URL`, `BACKEND_URL`, `ENVIA_API_KEY`, `SHIPPER_ZIP` | tienda en línea (sin cambios) |

Secrets nunca en el código. `.env` está en `.gitignore`.

## Pasos para publicar esta versión

1. `git push origin main` → Railway construye el fat jar (Dockerfile) y despliega; GitHub Pages publica `ss-app-frontend/erp/`.
2. En Railway añadir `SUPABASE_ANON_KEY` (opcional, para recuperación de contraseña desde Usuarios).
3. Las migraciones ya están aplicadas en Supabase. Para un proyecto nuevo: ejecutar `supabase/migrations/*.sql` en orden y luego `select public.seed_demo_data();` si se quieren datos demo.
4. En Supabase → Authentication → habilitar *Leaked password protection* (recomendación del linter).
5. Colocar el logotipo oficial en `ss-app-frontend/erp/img/logo.svg`.

## Migraciones

Convención `supabase/migrations/AAAAMMDD000NNN_nombre.sql`, idempotentes (`if not exists`, `create or replace`). Se aplican con el MCP de Supabase, el SQL Editor o `supabase db push`. Historial en `supabase_migrations.schema_migrations`.

## Respaldos

- **Supabase** realiza respaldos diarios automáticos (plan gratuito: 7 días de retención; Pro: PITR hasta 7–28 días). Restaurar desde Dashboard → Database → Backups.
- **Respaldo lógico propio** (recomendado semanal, antes de migraciones): `pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --format=custom -f sonroja-$(date +%F).dump` y guardarlo cifrado fuera de Supabase (Drive/S3). Restaurar con `pg_restore --clean --if-exists -d "$DB_URL" archivo.dump`.
- **Storage**: `product-images` es público; exportar con `supabase storage cp -r ss://product-images ./backup` (CLI) o desde el dashboard.
- **Qué no perder**: `audit_logs`, `inventory_movements`, `cash_movements`, `sales*` son la verdad operativa e inmutable; cualquier restauración debe incluirlas completas.
- Probar la restauración en el proyecto dev al menos cada trimestre.

## Monitoreo

- Logs de Railway (estructurados por Logback; los errores de BD se registran con el detalle técnico y el usuario recibe un mensaje amable).
- Supabase → Advisors (seguridad/rendimiento) tras cada migración.
- Alertas del ERP (`/alerts`): inventario, caja, anomalías. `run_anomaly_checks()` corre cada 15 min desde el backend.

## Escalabilidad futura

Multi-sucursal, multi-almacén y multi-canal ya están en el modelo. Integraciones previstas sin cambios de esquema: e-commerce/Shopify (canal + almacén online), Stripe/Mercado Pago (métodos de pago + `sale_payments.reference`), WhatsApp/CRM (clientes con `accepts_marketing`), cupones/gift cards (`promotions` + nuevo método de pago), CFDI (campos fiscales en `organizations`/`customers` + tabla `invoices`), API pública (mismas rutas con tokens de API).
