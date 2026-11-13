// pm2 del usuario de sistema `carrigraph` en el servidor (ver deploy/README.md).
// La configuración (JWT_SECRET, PORT, HOST, DB_PATH, CORS_ORIGIN, TRUST_PROXY) vive en el .env
// del clon, fuera de git: Node la carga con --env-file.
const path = require('path')

const root = path.resolve(__dirname, '..')

module.exports = {
  apps: [
    {
      name: 'carrigraph',
      cwd: root,
      script: 'server/index.js',
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      exp_backoff_restart_delay: 1000,
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
