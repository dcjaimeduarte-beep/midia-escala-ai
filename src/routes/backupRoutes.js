const express = require('express')
const router  = express.Router()
const fs      = require('fs')
const path    = require('path')
const db      = require('../db/database')
const { autenticar, apenasAdmin } = require('../auth/middleware')
const { syncTudoParaMemoria }     = require('../db/bootstrap')
const { lerConfig, salvarConfig, gerarBackup } = require('../services/backupScheduler')

// ── BACKUP MANUAL (download JSON) ────────────────────────────────────────────
router.get('/exportar', autenticar, apenasAdmin, (req, res) => {
  const todasTabelas = db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).map(r => r.name)

  const tabelas = {}
  for (const t of todasTabelas) {
    try { tabelas[t] = db.all(`SELECT * FROM ${t}`) } catch { tabelas[t] = [] }
  }

  const payload = {
    versao: '1.1', app: 'peniel-midia',
    gerado_em: new Date().toISOString(), tabelas,
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="backup-peniel-${new Date().toISOString().slice(0,10)}.json"`)
  res.json(payload)
})

// ── RESTAURAR ────────────────────────────────────────────────────────────────
router.post('/restaurar', autenticar, apenasAdmin, (req, res) => {
  const { versao, app: appName, tabelas } = req.body || {}

  if (appName !== 'peniel-midia' || !tabelas || typeof tabelas !== 'object')
    return res.status(400).json({ erro: 'Arquivo de backup inválido ou incompatível.' })

  const raw = db._db
  try {
    raw.pragma('foreign_keys = OFF')
    const restaurar = db.transaction(() => {
      const lista = Object.keys(tabelas)
      for (const t of [...lista].reverse()) {
        try { db.run(`DELETE FROM ${t}`) } catch {}
      }
      for (const t of lista) {
        const rows = tabelas[t]
        if (!Array.isArray(rows) || !rows.length) continue
        const cols = Object.keys(rows[0])
        const ph   = cols.map(() => '?').join(',')
        const stmt = raw.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(',')}) VALUES (${ph})`)
        for (const row of rows) {
          try { stmt.run(cols.map(c => row[c] ?? null)) } catch {}
        }
      }
    })
    restaurar()
    raw.pragma('foreign_keys = ON')
    syncTudoParaMemoria()
    res.json({ ok: true, mensagem: 'Backup restaurado com sucesso.' })
  } catch (e) {
    try { raw.pragma('foreign_keys = ON') } catch {}
    console.error('[backup/restaurar]', e)
    res.status(500).json({ erro: 'Falha ao restaurar backup: ' + e.message })
  }
})

// ── BACKUP AUTOMÁTICO — configuração ─────────────────────────────────────────
router.get('/config', autenticar, apenasAdmin, (req, res) => {
  res.json(lerConfig())
})

router.put('/config', autenticar, apenasAdmin, (req, res) => {
  const { ativo, hora, pasta, manter_dias, enviar_email, email_destino } = req.body
  const config = {
    ativo: !!ativo,
    hora: (hora || '02:00').slice(0, 5),
    pasta: (pasta || '').trim(),
    manter_dias: Math.max(0, Number(manter_dias) || 7),
    enviar_email: !!enviar_email,
    email_destino: (email_destino || '').trim(),
  }
  salvarConfig(config)
  res.json({ ok: true, config })
})

// ── BACKUP AUTOMÁTICO — executar agora ───────────────────────────────────────
router.post('/agora', autenticar, apenasAdmin, (req, res) => {
  const result = gerarBackup()
  if (result.ok) res.json(result)
  else res.status(500).json(result)
})

// ── BACKUP AUTOMÁTICO — listar arquivos ──────────────────────────────────────
router.get('/listar', autenticar, apenasAdmin, (req, res) => {
  const config = lerConfig()
  if (!config.pasta) return res.json([])
  const destino = path.resolve(config.pasta)
  if (!fs.existsSync(destino)) return res.json([])
  try {
    const arquivos = fs.readdirSync(destino)
      .filter(f => f.startsWith('backup-peniel-') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(destino, f))
        return { nome: f, tamanho: stat.size, gerado_em: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.gerado_em.localeCompare(a.gerado_em))
    res.json(arquivos)
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

// ── BACKUP AUTOMÁTICO — excluir arquivo ──────────────────────────────────────
router.delete('/arquivo/:nome', autenticar, apenasAdmin, (req, res) => {
  const nome = req.params.nome
  if (/[/\\.]\./.test(nome) || !nome.endsWith('.json'))
    return res.status(400).json({ erro: 'Nome de arquivo inválido.' })
  const config  = lerConfig()
  const destino = path.resolve(config.pasta)
  try {
    fs.unlinkSync(path.join(destino, nome))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

module.exports = router
