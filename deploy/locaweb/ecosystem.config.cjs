const path = require('path')

/** Raiz do repositório (independe de /var/www/... no servidor). */
const repoRoot = path.join(__dirname, '..', '..')

module.exports = {
  apps: [
    {
      name: 'midia-escala-ai',
      script: path.join(repoRoot, 'src', 'server.js'),
      cwd: repoRoot,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
}
