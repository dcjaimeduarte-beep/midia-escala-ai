const express = require('express')
const router = express.Router()
const db = require('../db/database')
const { autenticar, apenasAdmin } = require('../auth/middleware')
const { syncTudoParaMemoria } = require('../db/bootstrap')

// GET /backup/exportar — exporta todas as tabelas dinamicamente
router.get('/exportar', autenticar, apenasAdmin, (req, res) => {
  const todasTabelas = db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).map(r => r.name)

  const tabelas = {}
  for (const t of todasTabelas) {
    try {
      tabelas[t] = db.all(`SELECT * FROM ${t}`)
    } catch (_) {
      tabelas[t] = []
    }
  }

  const payload = {
    versao: '1.1',
    app: 'peniel-midia',
    gerado_em: new Date().toISOString(),
    tabelas,
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="backup-peniel-${new Date().toISOString().slice(0,10)}.json"`)
  res.json(payload)
})

// POST /backup/restaurar — restaura todas as tabelas presentes no arquivo
router.post('/restaurar', autenticar, apenasAdmin, (req, res) => {
  const { versao, app: appName, tabelas } = req.body || {}

  if (appName !== 'peniel-midia' || !tabelas || typeof tabelas !== 'object') {
    return res.status(400).json({ erro: 'Arquivo de backup inválido ou incompatível.' })
  }

  const raw = db._db
  try {
    raw.pragma('foreign_keys = OFF')

    const restaurar = db.transaction(() => {
      const lista = Object.keys(tabelas)

      // Apaga na ordem inversa para não violar FKs (FK desligada, mas por segurança)
      for (const t of [...lista].reverse()) {
        try { db.run(`DELETE FROM ${t}`) } catch (_) {}
      }

      // Reinsere na ordem original do arquivo
      for (const t of lista) {
        const rows = tabelas[t]
        if (!Array.isArray(rows) || !rows.length) continue
        const cols = Object.keys(rows[0])
        const ph   = cols.map(() => '?').join(',')
        const stmt = raw.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(',')}) VALUES (${ph})`)
        for (const row of rows) {
          try { stmt.run(cols.map(c => row[c] ?? null)) } catch (_) {}
        }
      }
    })

    restaurar()
    raw.pragma('foreign_keys = ON')
    syncTudoParaMemoria()
    res.json({ ok: true, mensagem: 'Backup restaurado com sucesso.' })
  } catch (e) {
    try { raw.pragma('foreign_keys = ON') } catch (_) {}
    console.error('[backup/restaurar]', e)
    res.status(500).json({ erro: 'Falha ao restaurar backup: ' + e.message })
  }
})

module.exports = router
