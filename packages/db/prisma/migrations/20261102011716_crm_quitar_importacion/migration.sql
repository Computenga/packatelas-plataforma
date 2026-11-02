-- La primera importación de prerregistros no reconoció a los clientes migrados (no tienen teléfono
-- ni correo) y marcó como «Perdido» registros que sí son clientes. Se quita para volver a importar.
DELETE FROM "Lead" WHERE "source" = 'PRERREGISTRO';
