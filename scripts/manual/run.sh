#!/usr/bin/env bash
# Regenera las capturas del manual (/ayuda) con datos ficticios en la base local packatelas_manual.
# Requiere el servidor de desarrollo en $BASE (por defecto http://localhost:3100) apuntando a esa base.
set -euo pipefail
cd "$(dirname "$0")/../../packages/db"
export DATABASE_URL=$(grep DATABASE_URL .env | cut -d'"' -f2 | sed 's#/packatelas?#/packatelas_manual?#')
DB=${DATABASE_URL%%\?*}
su postgres -c "psql -qc 'DROP DATABASE IF EXISTS packatelas_manual WITH (FORCE)' -c 'CREATE DATABASE packatelas_manual OWNER packatelas'"
npx prisma migrate deploy >/dev/null
npx tsx src/seed.ts && npx tsx src/seed-manual.ts
q() { psql "$DB" -Atc "$1"; }
export IDS=$(printf '{"pk1":"%s","pk6":"%s","cli":"%s","task":"%s"}' \
  "$(q "select id from \"Order\" where code='PK-000001'")" "$(q "select id from \"Order\" where code='PK-000006'")" \
  "$(q "select id from \"Client\" where \"publicId\"='cmx00001'")" "$(q "select id from \"Task\" limit 1")")
cd ../..
node scripts/manual/shots.cjs "${1:-apps/web/public/ayuda}" "${2:-}"
# PNG → WebP (más ligero para el celular)
python3 - "${1:-apps/web/public/ayuda}" <<'PY'
import glob, os, sys
from PIL import Image
for f in glob.glob(os.path.join(sys.argv[1], "*.png")):
    Image.open(f).save(f[:-4] + ".webp", "WEBP", quality=78, method=6)
    os.remove(f)
PY
