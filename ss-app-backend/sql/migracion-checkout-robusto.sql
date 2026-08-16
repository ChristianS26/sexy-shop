-- ═══════════════════════════════════════════════════════════════
-- Blindaje del checkout (portado de MultiHaus)
-- Aplicada en Supabase el 2026-08-15 (migración: checkout_robusto).
--
-- 1. Un pago de Mercado Pago no puede generar dos pedidos.
-- 2. Dos compradores simultáneos no pueden llevarse la misma última pieza.
-- 3. Conciliación con MP y constancia de entrega en el pedido.
-- ═══════════════════════════════════════════════════════════════

-- ── Columnas nuevas en orders ──────────────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS mp_payment_id TEXT,
    ADD COLUMN IF NOT EXISTS mp_fee NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS mp_net NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS mp_installments INT,
    ADD COLUMN IF NOT EXISTS mp_method TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS received_by TEXT,
    ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT;

-- ── 1. Un pago, un pedido ──────────────────────────────────────
-- El candado contra duplicados vivía sólo en memoria del proceso, así que un
-- reinicio de Railway (cada despliegue lo es) lo dejaba en blanco. Mercado
-- Pago manda payment.created y payment.updated para el mismo pago, y reintenta
-- si no le contestamos rápido.
--
-- Índice parcial: los pedidos en efectivo o transferencia no tienen
-- mp_payment_id y no deben estorbarse entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_mp_payment_id
    ON orders (mp_payment_id)
    WHERE mp_payment_id IS NOT NULL;

-- ── 2. Descuento de inventario atómico ─────────────────────────
-- El backend hacía leer-y-luego-escribir (stock - cantidad). Entre la lectura
-- y la escritura cabe otra compra, así que dos pedidos simultáneos por la
-- última pieza pasaban los dos y el stock quedaba en negativo.
CREATE OR REPLACE FUNCTION descontar_stock(p_producto UUID, p_cantidad INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_restante INT;
BEGIN
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_INVALIDA';
    END IF;

    UPDATE products
       SET stock = stock - p_cantidad,
           updated_at = NOW()
     WHERE id = p_producto
       AND stock >= p_cantidad
    RETURNING stock INTO v_restante;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE';
    END IF;

    RETURN v_restante;
END;
$$;

-- Devolver existencias al cancelar. Sin condición: reponer siempre procede.
CREATE OR REPLACE FUNCTION devolver_stock(p_producto UUID, p_cantidad INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_restante INT;
BEGIN
    UPDATE products
       SET stock = stock + p_cantidad,
           updated_at = NOW()
     WHERE id = p_producto
    RETURNING stock INTO v_restante;
    RETURN COALESCE(v_restante, 0);
END;
$$;

REVOKE ALL ON FUNCTION descontar_stock(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION devolver_stock(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION descontar_stock(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION devolver_stock(UUID, INT) TO service_role;
