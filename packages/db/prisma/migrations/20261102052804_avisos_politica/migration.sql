-- Política de avisos por WhatsApp: a las tiendas solo «recolección registrada» y «en camino»;
-- a compradores solo en pedidos externos (esto último va en el código). Si ya había configuración
-- guardada, se apagan los avisos a tiendas que ya no van.
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{enabled}', COALESCE("value"::jsonb -> 'enabled', '{}'::jsonb) || '{"regresa_bodega": false, "recoleccion_asignada": false, "recoleccion_bloqueada": false, "recordatorio_pago": false, "recoleccion_creada": true, "recoleccion_en_camino": true}'::jsonb)
WHERE "key" = 'notify.settings';
