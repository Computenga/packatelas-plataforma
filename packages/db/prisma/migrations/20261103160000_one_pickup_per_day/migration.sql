-- Una sola recolección activa por sucursal y día.
-- 1) Las repetidas que siguen abiertas se cancelan; se queda la más avanzada (asignada > agendada > bloqueada)
--    y, entre iguales, la más antigua. Las ya recolectadas o fallidas no se tocan.
WITH ranked AS (
  SELECT id, "branchId", "scheduledFor",
         ROW_NUMBER() OVER (
           PARTITION BY "branchId", "scheduledFor"
           ORDER BY CASE status WHEN 'COLLECTED' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'FAILED' THEN 2 WHEN 'SCHEDULED' THEN 3 ELSE 4 END, "createdAt"
         ) AS rn
  FROM "Pickup"
  WHERE status <> 'CANCELLED'
)
UPDATE "Pickup" p
SET status = 'CANCELLED', note = LEFT(CONCAT_WS(' · ', NULLIF(p.note, ''), 'Cancelada: recolección repetida del mismo día'), 300)
FROM ranked r
WHERE p.id = r.id AND r.rn > 1 AND p.status IN ('SCHEDULED', 'BLOCKED', 'ASSIGNED');

-- Su pedido RC- también queda cancelado.
UPDATE "Order" o SET status = 'CANCELLED'
FROM "Pickup" p
WHERE o."pickupId" = p.id AND p.status = 'CANCELLED' AND o.status NOT IN ('DELIVERED', 'CANCELLED');

-- 2) Candado: no puede haber dos abiertas para la misma sucursal y día.
CREATE UNIQUE INDEX IF NOT EXISTS "Pickup_one_open_per_branch_day"
  ON "Pickup" ("branchId", "scheduledFor")
  WHERE status IN ('SCHEDULED', 'ASSIGNED', 'BLOCKED');
