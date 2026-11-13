# Despliegue en el servidor

Cómo está instalado CarriGraph en `https://carrigraph.jape.com.ar` y cómo se actualiza.

**Acá no van datos de conexión ni secretos.** La IP, el puerto SSH, el usuario y la clave viven en la
máquina de desarrollo. Donde dice `<...>` se completa en el momento y no se anota en el repo.

## Piezas y rutas

| Qué | Dónde (en el servidor) |
|---|---|
| Usuario de sistema | `carrigraph`, sin shell (`/usr/sbin/nologin`), home `/var/lib/carrigraph` |
| Clon del repo (público) | `/var/lib/carrigraph/carrigraph` (rama `main`) |
| Configuración | `/var/lib/carrigraph/carrigraph/.env` (fuera de git, permisos 600) |
| Base SQLite | `/var/lib/carrigraph/storage/carrigraph.db` (fuera del clon) |
| Respaldos de la base | `/var/lib/carrigraph/backups/` (uno por despliegue, se conservan 10) |
| Proceso | pm2 del usuario `carrigraph` (`deploy/ecosystem.config.cjs`), servicio systemd `pm2-carrigraph` |
| Logs | `/var/lib/carrigraph/.pm2/logs/` |
| nginx | `/etc/nginx/conf.d/carrigraph.jape.com.ar.conf` (copia de `deploy/nginx/`) |
| Backend | `127.0.0.1:34360` (solo local; afuera se entra por nginx) |
| DNS | registro `carrigraph` en Cloudflare, con proxy; certificado de origen `*.jape.com.ar` |

nginx manda todo a Node: con `NODE_ENV=production` el servidor sirve `dist/`, las rutas del SPA y la API.

## Actualizar (cada cambio)

Con los cambios ya en `main` de GitHub, en el servidor como root:

```bash
bash /var/lib/carrigraph/carrigraph/deploy/deploy.sh
```

Respalda la base, hace `git pull`, `npm ci`, `npm run build`, `npm run seed` (agrega o actualiza los
ejemplos, no toca proyectos de usuarios), recarga el proceso con pm2 y comprueba que responda.

Si cambió `deploy/nginx/carrigraph.jape.com.ar.conf`:

```bash
cp /var/lib/carrigraph/carrigraph/deploy/nginx/carrigraph.jape.com.ar.conf /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
```

## Volver atrás

```bash
cd /var/lib/carrigraph/carrigraph
sudo -u carrigraph -H git log --oneline -5          # elegir el commit bueno
sudo -u carrigraph -H git checkout <commit>
sudo -u carrigraph -H npm ci && sudo -u carrigraph -H npm run build
sudo -u carrigraph -H env PM2_HOME=/var/lib/carrigraph/.pm2 pm2 reload carrigraph
```

Para volver a `main`: `git checkout main`. La base se restaura copiando un archivo de `backups/` sobre
`storage/carrigraph.db` con el proceso detenido (`pm2 stop carrigraph`).

## Instalación inicial (una sola vez)

Todo como root. Para correr algo como `carrigraph`, que no tiene shell: `sudo -u carrigraph -H <comando>`.

```bash
# 1. usuario y carpetas
useradd --system --create-home --home-dir /var/lib/carrigraph --shell /usr/sbin/nologin carrigraph
chmod 711 /var/lib/carrigraph
sudo -u carrigraph -H mkdir -p /var/lib/carrigraph/storage /var/lib/carrigraph/backups

# 2. clon
sudo -u carrigraph -H git clone https://github.com/japentaca/carrigraph.git /var/lib/carrigraph/carrigraph

# 3. .env con un secreto nuevo (no copiar el de desarrollo)
cd /var/lib/carrigraph/carrigraph
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 48)
PORT=34360
HOST=127.0.0.1
CORS_ORIGIN=https://carrigraph.jape.com.ar
DB_PATH=/var/lib/carrigraph/storage/carrigraph.db
TRUST_PROXY=loopback
EOF
chown carrigraph:carrigraph .env && chmod 600 .env

# 4. instalar, compilar, ejemplos, arrancar
sudo -u carrigraph -H npm ci --no-audit --no-fund
sudo -u carrigraph -H npm run build
sudo -u carrigraph -H npm run seed
sudo -u carrigraph -H env PM2_HOME=/var/lib/carrigraph/.pm2 pm2 start deploy/ecosystem.config.cjs
sudo -u carrigraph -H env PM2_HOME=/var/lib/carrigraph/.pm2 pm2 save

# 5. servicio systemd (arranque con el servidor): igual a pm2-looper, con el usuario y PM2_HOME de carrigraph
sed -e 's/User=looper/User=carrigraph/' -e 's#/var/lib/looper#/var/lib/carrigraph#g' \
  /etc/systemd/system/pm2-looper.service > /etc/systemd/system/pm2-carrigraph.service
systemctl daemon-reload && systemctl enable pm2-carrigraph

# 6. nginx
cp deploy/nginx/carrigraph.jape.com.ar.conf /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
```

7. En Cloudflare: registro `A` `carrigraph` → IP del servidor, con proxy activado (como `looper`).

## Qué mirar después

```bash
sudo -u carrigraph -H env PM2_HOME=/var/lib/carrigraph/.pm2 pm2 ls
sudo -u carrigraph -H env PM2_HOME=/var/lib/carrigraph/.pm2 pm2 logs carrigraph --lines 50 --nostream
curl -s http://127.0.0.1:34360/api/gallery | head -c 300
```

- Cambiar `JWT_SECRET` cierra todas las sesiones.
- Los límites de intentos (login, registro) son por IP: dependen de `TRUST_PROXY=loopback` y de que nginx
  mande `X-Forwarded-For` con la IP real.
