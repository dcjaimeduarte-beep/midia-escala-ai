const express = require('express')
const router = express.Router()
const db = require('../db/database')
const { autenticar, apenasAdmin } = require('../auth/middleware')
const { syncTudoParaMemoria } = require('../db/bootstrap')

// Ordem de exportação (dependências primeiro)
const TABELAS = [
  'congregacoes',
  'departamentos',
  'eventos',
  'categorias_financeiro',
  'usuarios',
  'usuario_departamento',
  'escalas',
  'escala_voluntarios',
  'escala_trocas',
  'lancamentos_financeiro',
  'troca_solicitacoes',
  'avisos',
]

// GET /backup/exportar — admin only
router.get('/exportar', autenticar, apenasAdmin, (req, res) => {
  const tabelas = {}
  for (const t of TABELAS) {
    try {
      tabelas[t] = db.all(`SELECT * FROM ${t}`)
    } catch (_) {
      tabelas[t] = []
    }
  }

  const payload = {
    versao: '1.0',
    app: 'peniel-midia',
    gerado_em: new Date().toISOString(),
    tabelas,
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="backup-peniel-${new Date().toISOString().slice(0,10)}.json"`)
  res.json(payload)
})

// POST /backup/restaurar — admin only
router.post('/restaurar', autenticar, apenasAdmin, (req, res) => {
  const { versao, app: appName, tabelas } = req.body || {}

  if (appName !== 'peniel-midia' || !tabelas || typeof tabelas !== 'object') {
    return res.status(400).json({ erro: 'Arquivo de backup inválido ou incompatível.' })
  }

  try {
    const restaurar = db.transaction(() => {
      // Apaga na ordem inversa para respeitar FK
      const inversa = [...TABELAS].reverse()
      for (const t of inversa) {
        try { db.run(`DELETE FROM ${t}`) } catch (_) {}
      }

      // Insere na ordem correta
      for (const t of TABELAS) {
        const rows = tabelas[t]
        if (!Array.isArray(rows) || !rows.length) continue
        const cols = Object.keys(rows[0])
        const ph   = cols.map(() => '?').join(',')
        const stmt = db._db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(',')}) VALUES (${ph})`)
        for (const row of rows) {
          try { stmt.run(cols.map(c => row[c] ?? null)) } catch (_) {}
        }
      }
    })

    restaurar()
    syncTudoParaMemoria()
    res.json({ ok: true, mensagem: 'Backup restaurado com sucesso.' })
  } catch (e) {
    console.error('[backup/restaurar]', e)
    res.status(500).json({ erro: 'Falha ao restaurar backup: ' + e.message })
  }
})

module.exports = router
