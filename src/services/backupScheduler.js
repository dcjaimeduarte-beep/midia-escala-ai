const fs   = require('fs')
const path = require('path')

const CONFIG_FILE = path.join(__dirname, '..', '..', 'backup_config.json')

function lerConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {}
  return { ativo: false, hora: '02:00', pasta: '', manter_dias: 7, enviar_email: false, email_destino: '' }
}

function salvarConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

async function gerarBackup() {
  const config = lerConfig()
  if (!config.pasta && !config.enviar_email)
    return { ok: false, erro: 'Configure a pasta de destino ou o e-mail de backup.' }

  const db = require('../db/database')
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

  // Salvar em pasta
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

  // Enviar por e-mail
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
    if (!config.ativo || !config.hora || !config.pasta) return
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
