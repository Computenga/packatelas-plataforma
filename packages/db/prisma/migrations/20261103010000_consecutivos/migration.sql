-- Últimos consecutivos asignados fuera de la plataforma al 2026-11-02 (hoja de registro, checador y flotilla).
INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES ('consecutivos', '{"cmx": 293, "emx": 216, "empleado": 115, "moto": 8}', NOW())
ON CONFLICT ("key") DO NOTHING;
