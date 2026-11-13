#!/usr/bin/env bash
# Actualiza CarriGraph en el servidor: trae main, instala, compila, refresca los ejemplos y
# recarga el proceso. Se corre EN el servidor, como root:
#
#   bash /var/lib/carrigraph/carrigraph/deploy/deploy.sh
#
# La instalación inicial (usuario, clon, .env, pm2, nginx) está en deploy/README.md.
set -euo pipefail

APP_USER=carrigraph
APP_HOME=/var/lib/carrigraph
APP_DIR="$APP_HOME/carrigraph"

as_app() { sudo -u "$APP_USER" -H env PM2_HOME="$APP_HOME/.pm2" "$@"; }

cd "$APP_DIR"
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
DB=$(grep -E '^DB_PATH=' .env | cut -d= -f2)

echo "== respaldo de la base"
if [ -f "$DB" ]; then
  mkdir -p "$APP_HOME/backups"
  chown "$APP_USER:$APP_USER" "$APP_HOME/backups"
  as_app sqlite3 "$DB" ".backup '$APP_HOME/backups/carrigraph-$(date +%Y%m%d-%H%M%S).db'" 2>/dev/null \
    || as_app cp "$DB" "$APP_HOME/backups/carrigraph-$(date +%Y%m%d-%H%M%S).db"
  # se conservan los 10 respaldos más nuevos
  ls -1t "$APP_HOME"/backups/carrigraph-*.db | tail -n +11 | xargs -r rm -f
fi

echo "== código"
as_app git pull --ff-only
as_app npm ci --no-audit --no-fund
as_app npm run build

echo "== ejemplos"
as_app npm run -s seed

echo "== proceso"
as_app pm2 startOrReload deploy/ecosystem.config.cjs
as_app pm2 save

echo "== comprobación"
sleep 2
curl -fsS -o /dev/null -w "galería: HTTP %{http_code}\n" "http://127.0.0.1:$PORT/api/gallery"
curl -fsS -o /dev/null -w "portada: HTTP %{http_code}\n" "http://127.0.0.1:$PORT/"
echo "Deploy OK: $(git log --oneline -1)"
