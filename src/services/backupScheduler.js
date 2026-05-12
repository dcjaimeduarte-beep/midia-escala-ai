const fs   = require('fs')
const path = require('path')

// Arquivo legado — mantido apenas para migração automática para o SQLite
const CONFIG_FILE_LEGADO = path.join(__dirname, '..', '..', 'backup_config.json')

const DEFAULTS = { ativo: false, hora: '02:00', pasta: '', manter_dias: 7, enviar_email: false, email_destino: '' }

function _db() {
  return require('../db/database')
}

function lerConfig() {
  try {
    const row = _db().get(`SELECT valor FROM configuracoes WHERE chave = 'backup_config'`)
    if (row) return { ...DEFAULTS, ...JSON.parse(row.valor) }

    // Migração automática: arquivo JSON legado → SQLite
    if (fs.existsSync(CONFIG_FILE_LEGADO)) {
      const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE_LEGADO, 'utf8')) }
      salvarConfig(cfg)
      try { fs.unlinkSync(CONFIG_FILE_LEGADO) } catch {}
      return cfg
    }
  } catch {}
  return { ...DEFAULTS }
}

function salvarConfig(cfg) {
  const agora = new Date().toISOString()
  _db().run(
    `INSERT INTO configuracoes (chave, valor, criado_em, atualizado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
    'backup_config',
    JSON.stringify(cfg),
    agora,
    agora
  )
}

async function gerarBackup() {
  const config = lerConfig()
  if (!config.pasta && !config.enviar_email)
    return { ok: false, erro: 'Configure a pasta de destino ou o e-mail de backup.' }

  const db = _db()
  const tabelas = {}
  db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .forEach(({ name }) => {
      try { tabelas[name] = db.all(`SELECT * FROM ${name}`) } catch { tabelas[name] = [] }
    })

  const agora      = new Date()
  const dataStr    = agora.toISOString().slice(0, 10)
  const horaStr    = `${String(agora.getHours()).padStart(2,'0')}-${String(agora.getMinutes()).padStart(2,'0')}`
  const nomeArq    = `backup-peniel-${dataStr}_${horaStr}.json`
  const conteudo   = JSON.stringify({ versao: '1.1', app: 'peniel-midia', gerado_em: agora.toISOString(), tabelas })
  const resultado  = { ok: true, arquivo: nomeArq, gerado_em: agora.toISOString(), pasta: false, email: false }

  if (config.pasta) {
    try {
      const destino = path.resolve(config.pasta)
      fs.mkdirSync(destino, { recursive: true })
      fs.writeFileSync(path.join(destino, nomeArq), conteudo, 'utf8')
      resultado.pasta = true

      const dias = Number(config.manter_dias) || 0
      if (dias > 0) {
        const limite = Date.now() - dias * 86400000
        fs.readdirSync(destino)
          .filter(f => f.startsWith('backup-peniel-') && f.endsWith('.json'))
          .forEach(f => {
            try { if (fs.statSync(path.join(destino, f)).mtimeMs < limite) fs.unlinkSync(path.join(destino, f)) } catch {}
          })
      }
      console.log(`[backup] ✅ pasta: ${nomeArq}`)
    } catch (e) {
      console.error('[backup] ❌ pasta:', e.message)
      resultado.erro_pasta = e.message
    }
  }

  if (config.enviar_email && config.email_destino) {
    try {
      const { enviarBackupEmail } = require('./mail')
      await enviarBackupEmail({ para: config.email_destino, nomeArquivo: nomeArq, conteudoJson: conteudo })
      resultado.email = true
      console.log(`[backup] ✅ e-mail: ${config.email_destino}`)
    } catch (e) {
      console.error('[backup] ❌ e-mail:', e.message)
      resultado.erro_email = e.message
    }
  }

  if (!resultado.pasta && !resultado.email)
    return { ok: false, erro: resultado.erro_pasta || resultado.erro_email || 'Falha ao salvar e enviar backup.' }

  return resultado
}

let _timer = null
let _ultimaExecucao = ''

function iniciarAgendador() {
  if (_timer) clearInterval(_timer)
  _timer = setInterval(() => {
    const config = lerConfig()
    if (!config.ativo || !config.hora) return
    if (!config.pasta && !config.enviar_email) return
    const agora   = new Date()
    const horaNow = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`
    const chave   = `${agora.toISOString().slice(0,10)}_${horaNow}`
    if (horaNow === config.hora && chave !== _ultimaExecucao) {
      _ultimaExecucao = chave
      gerarBackup().catch(e => console.error('[backup] erro agendado:', e.message))
    }
  }, 60_000)
  console.log('[backup] Agendador iniciado.')
}

module.exports = { lerConfig, salvarConfig, gerarBackup, iniciarAgendador }
