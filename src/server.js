require('dotenv').config()
const express = require('express')
const path = require('path')
const eventBus = require('./events/eventBus')
const { bootstrap } = require('./db/bootstrap')
const { garantirConexaoWhatsApp } = require('./services/whatsapp')
const { iniciarAgendador }        = require('./services/backupScheduler')

const app = express()
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}
app.use(express.json({ limit: '10mb' }))

// CORS opcional (ex.: front Vite em outra porta)
const corsOrigin = process.env.CORS_ORIGIN
if (corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
}

// Servir frontend
app.use(express.static(path.join(__dirname, '..', 'public')))

// Servir logos e assets estáticos da pasta docs/
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')))

// ─── Rotas públicas ─────────────────────────────────────────────────────────
app.use('/auth', require('./routes/authRoutes'))

// ─── Rotas protegidas ────────────────────────────────────────────────────────
app.use('/departamento', require('./routes/departamentoRoutes'))
app.use('/usuario',      require('./routes/usuarioRoutes'))
app.use('/escala',       require('./routes/escalaRoutes'))
app.use('/agente',       require('./routes/agenteRoutes'))
app.use('/evento',       require('./routes/eventoRoutes'))
app.use('/aviso',        require('./routes/avisoRoutes'))
app.use('/financeiro',   require('./routes/financeiroRoutes'))
app.use('/congregacao',  require('./routes/congregacaoRoutes'))
app.use('/backup',       require('./routes/backupRoutes'))
app.use('/culto',        require('./routes/cultoRoutes'))
app.use('/checkin',      require('./routes/checkinRoutes'))
app.use('/perfil',       require('./routes/perfilRoutes'))
app.use('/visitante',    require('./routes/visitanteRoutes'))

// ─── EventBus listeners ──────────────────────────────────────────────────────
eventBus.on('escala_criada', (escala) => {
  console.log('[EventBus] 📅 Escala criada:', escala)
})

eventBus.on('notificacao_equipe', ({ tipo, mensagem }) => {
  console.log(`[EventBus] 🔔 [${tipo.toUpperCase()}] ${mensagem}`)
})

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
bootstrap()
  .then(() => {
    // Inicializa conexão WhatsApp em background para já exibir QR/pairing quando aplicável.
    garantirConexaoWhatsApp()
    iniciarAgendador()
    app.listen(PORT, () => {
      console.log(`🔥 Peniel Mídia — servidor rodando em http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco:', err)
    process.exit(1)
  })
