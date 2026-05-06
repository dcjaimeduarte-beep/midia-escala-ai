module.exports = {
  apps: [
    {
      name: 'midia-escala-ai',
      script: 'src/server.js',
      cwd: '/var/www/midia-escala-ai',
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
