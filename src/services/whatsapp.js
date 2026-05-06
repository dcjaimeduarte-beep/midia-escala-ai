/**
 * Envio de texto via WhatsApp (opcional). Configure WHATSAPP_PROVIDER no .env.
 *
 * - zapi  → Z-API (https://developer.z-api.io)
 * - twilio → Twilio WhatsApp API
 * - pywhatkit → automatiza WhatsApp Web via script Python local
 * - whatsapp-web.js / wwebjs → sessão persistente sem abrir aba por mensagem
 */

const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const qrcodeTerminal = require('qrcode-terminal')
const { Client, LocalAuth } = require('whatsapp-web.js')

const PROVIDER = (process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim()
const PYTHON_BIN = process.env.PYWHATKIT_PYTHON_BIN || 'python'
const PYWHATKIT_SCRIPT =
  process.env.PYWHATKIT_SCRIPT_PATH ||
  path.resolve(__dirname, '..', '..', 'scripts', 'whatsapp_pywhatkit.py')
const PYWHATKIT_WAIT_TIME = Number(process.env.PYWHATKIT_WAIT_TIME || 20)
const PYWHATKIT_CLOSE_TIME = Number(process.env.PYWHATKIT_CLOSE_TIME || 3)
const WWEBJS_SESSION_DIR = path.resolve(
  process.cwd(),
  process.env.WWEBJS_SESSION_DIR || '.wwebjs_auth'
)
const WWEBJS_CLIENT_ID = String(process.env.WWEBJS_CLIENT_ID || 'midia-escala-ai').trim()

let filaPywhatkit = Promise.resolve()
let filaWwebjs = Promise.resolve()
let wwebjsClient = null
let wwebjsConectado = false
let wwebjsConectando = null
let wwebjsReiniciando = null
let wwebjsUltimoErro = ''
let wwebjsQr = ''

/** Normaliza celular BR para dígitos no formato internacional (ex.: 5511999998888). */
function digitosWhatsApp(celular) {
  const d = String(celular || '').replace(/\D/g, '')
  if (!d) return null
  if (d.length >= 12 && d.startsWith('55')) return d
  if (d.length === 11) return `55${d}`
  if (d.length === 10) return `55${d}`
  if (d.length === 13 && d.startsWith('55')) return d
  if (d.length >= 8 && d.length <= 15) return d
  return null
}

function montarTextoComunicado({
  nomeDestinatario,
  titulo,
  corpo,
  departamentoNome
}) {
  const escopo = departamentoNome
    ? `📁 ${departamentoNome}`
    : '📢 Aviso geral da equipe'
  const t = titulo && String(titulo).trim() ? `*${String(titulo).trim()}*\n\n` : ''
  const corpoStr = String(corpo || '')
  const trecho =
    corpoStr.length > 3500 ? `${corpoStr.slice(0, 3497)}...` : corpoStr
  const saud = nomeDestinatario ? `Olá, ${nomeDestinatario}!` : 'Olá!'
  return `${saud}

${escopo}

${t}${trecho}

_ Peniel Mídia_`
}

function whatsappEstaConfigurado() {
  if (!PROVIDER || PROVIDER === 'none') return false
  if (PROVIDER === 'zapi') {
    return !!(process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN)
  }
  if (PROVIDER === 'twilio') {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
    )
  }
  if (PROVIDER === 'pywhatkit') {
    return true
  }
  if (PROVIDER === 'wwebjs' || PROVIDER === 'whatsapp-web.js') {
    return true
  }
  return false
}

async function enviarZApi(phoneDigits, message) {
  const instance = process.env.ZAPI_INSTANCE_ID
  const token = process.env.ZAPI_TOKEN
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || ''
  if (!instance || !token) {
    return { enviado: false, motivo: 'zapi_incompleto' }
  }
  const url = `https://api.z-api.io/instances/${encodeURIComponent(instance)}/token/${encodeURIComponent(token)}/send-text`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clientToken ? { 'Client-Token': clientToken } : {})
    },
    body: JSON.stringify({ phone: phoneDigits, message })
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Z-API HTTP ${res.status}: ${errBody.slice(0, 200)}`)
  }
  return { enviado: true }
}

async function enviarTwilioWhatsApp(phoneDigits, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  if (!sid || !auth || !from) {
    return { enviado: false, motivo: 'twilio_incompleto' }
  }
  const to = `whatsapp:+${phoneDigits.replace(/^\+/, '')}`
  const authHeader = `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`
  const params = new URLSearchParams({
    From: from,
    To: to,
    Body: message
  })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    }
  )
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Twilio HTTP ${res.status}: ${errBody.slice(0, 200)}`)
  }
  return { enviado: true }
}

function enviarPywhatkit(phoneDigits, message) {
  return new Promise((resolve, reject) => {
    const args = [
      PYWHATKIT_SCRIPT,
      '--to',
      `+${phoneDigits.replace(/^\+/, '')}`,
      '--message',
      message,
      '--instant',
      '--wait-time',
      String(Number.isFinite(PYWHATKIT_WAIT_TIME) ? PYWHATKIT_WAIT_TIME : 20),
      '--close-time',
      String(Number.isFinite(PYWHATKIT_CLOSE_TIME) ? PYWHATKIT_CLOSE_TIME : 3)
    ]
    const proc = spawn(PYTHON_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk || '')
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) return resolve({ enviado: true })
      reject(
        new Error(
          `[pywhatkit] processo terminou com código ${code}. ${stderr.trim().slice(0, 250)}`
        )
      )
    })
  })
}

function destruirClienteWwebjs() {
  const atual = wwebjsClient
  wwebjsClient = null
  wwebjsConectado = false
  wwebjsConectando = null
  if (!atual) return Promise.resolve()
  return atual.destroy().catch(() => {})
}

async function conectarWwebjs() {
  if (wwebjsClient && wwebjsConectado) return wwebjsClient
  if (wwebjsConectando) return wwebjsConectando

  wwebjsConectando = new Promise((resolve, reject) => {
    let timeoutRef = null
    let finalizado = false
    const resolver = (value) => {
      if (finalizado) return
      finalizado = true
      if (timeoutRef) clearTimeout(timeoutRef)
      resolve(value)
    }
    const rejeitar = (err) => {
      if (finalizado) return
      finalizado = true
      if (timeoutRef) clearTimeout(timeoutRef)
      reject(err)
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: WWEBJS_CLIENT_ID,
        dataPath: WWEBJS_SESSION_DIR
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
    })

    client.on('qr', (qr) => {
      wwebjsQr = qr || ''
      wwebjsUltimoErro = ''
      console.log('\n[whatsapp/wwebjs] Escaneie o QR abaixo no WhatsApp:')
      if (wwebjsQr) qrcodeTerminal.generate(wwebjsQr, { small: true })
    })

    client.on('ready', () => {
      wwebjsConectado = true
      wwebjsQr = ''
      wwebjsUltimoErro = ''
      console.log('[whatsapp/wwebjs] Conectado com sucesso.')
      resolver(client)
    })

    client.on('auth_failure', (msg) => {
      wwebjsConectado = false
      wwebjsUltimoErro = msg || 'Falha de autenticação no WhatsApp.'
    })

    client.on('disconnected', (reason) => {
      wwebjsConectado = false
      wwebjsUltimoErro = reason || 'WhatsApp desconectado.'
      wwebjsConectando = null
      wwebjsClient = null
    })

    client
      .initialize()
      .then(() => {
        wwebjsClient = client
      })
      .catch((err) => {
        wwebjsUltimoErro = err?.message || 'Falha ao inicializar WhatsApp.'
        rejeitar(err)
      })

    timeoutRef = setTimeout(() => {
      rejeitar(
        new Error(
          'WhatsApp ainda não conectado. Escaneie o QR exibido no terminal para ativar o envio.'
        )
      )
    }, 30000)
  })

  try {
    return await wwebjsConectando
  } finally {
    if (!wwebjsConectado) wwebjsConectando = null
  }
}

async function enviarWwebjs(phoneDigits, message) {
  const client = await conectarWwebjs()
  if (!wwebjsConectado || !client) {
    return { enviado: false, motivo: 'whatsapp_desconectado' }
  }

  const numero = phoneDigits.replace(/^\+/, '')
  const numeroId = await client.getNumberId(numero).catch(() => null)
  if (!numeroId?._serialized) {
    return { enviado: false, motivo: 'numero_sem_whatsapp' }
  }

  await client.sendMessage(numeroId._serialized, message)
  return { enviado: true, via: 'whatsapp-web.js' }
}

async function garantirConexaoWhatsApp() {
  if (PROVIDER !== 'wwebjs' && PROVIDER !== 'whatsapp-web.js') return
  conectarWwebjs().catch((e) => {
    wwebjsUltimoErro = e?.message || 'Falha ao conectar'
  })
}

async function resetarSessaoWwebjs() {
  wwebjsQr = ''
  wwebjsUltimoErro = ''
  await destruirClienteWwebjs()
  try {
    if (fs.existsSync(WWEBJS_SESSION_DIR)) {
      fs.rmSync(WWEBJS_SESSION_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(WWEBJS_SESSION_DIR, { recursive: true })
  } catch (e) {
    wwebjsUltimoErro = e?.message || 'Falha ao resetar sessão'
  }
}

async function reconectarWhatsApp() {
  if (PROVIDER !== 'wwebjs' && PROVIDER !== 'whatsapp-web.js') return
  if (wwebjsReiniciando) return wwebjsReiniciando
  wwebjsReiniciando = (async () => {
    await resetarSessaoWwebjs()
    await garantirConexaoWhatsApp()
  })().finally(() => {
    wwebjsReiniciando = null
  })
  return wwebjsReiniciando
}

function imprimirQrNoTerminal() {
  if (PROVIDER !== 'wwebjs' && PROVIDER !== 'whatsapp-web.js') return false
  garantirConexaoWhatsApp()
  return true
}

function statusWhatsApp() {
  if (!PROVIDER || PROVIDER === 'none') {
    return { provider: 'none', configurado: false, conectado: false, detalhe: 'desligado' }
  }
  if (PROVIDER === 'wwebjs' || PROVIDER === 'whatsapp-web.js') {
    return {
      provider: 'whatsapp-web.js',
      configurado: true,
      conectado: !!wwebjsConectado,
      detalhe: wwebjsConectado ? 'conectado' : wwebjsQr ? 'aguardando_qr' : 'iniciando',
      pairing_code: '',
      ultimo_erro: wwebjsUltimoErro || ''
    }
  }
  const configurado = whatsappEstaConfigurado()
  return {
    provider: PROVIDER,
    configurado,
    conectado: configurado,
    detalhe: configurado ? 'pronto' : 'incompleto',
    ultimo_erro: ''
  }
}

async function enviarTextoWhatsApp({ celular, texto }) {
  const phone = digitosWhatsApp(celular)
  if (!phone) return { enviado: false, motivo: 'sem_numero' }
  if (!whatsappEstaConfigurado()) return { enviado: false, motivo: 'whatsapp_desligado' }
  const message = String(texto || '').trim()
  if (!message) return { enviado: false, motivo: 'sem_texto' }
  try {
    if (PROVIDER === 'zapi') return await enviarZApi(phone, message)
    if (PROVIDER === 'twilio') return await enviarTwilioWhatsApp(phone, message)
    if (PROVIDER === 'pywhatkit') {
      const proximo = filaPywhatkit.then(() => enviarPywhatkit(phone, message))
      filaPywhatkit = proximo.catch(() => {})
      return await proximo
    }
    if (PROVIDER === 'wwebjs' || PROVIDER === 'whatsapp-web.js') {
      const proximo = filaWwebjs.then(() => enviarWwebjs(phone, message))
      filaWwebjs = proximo.catch(() => {})
      return await proximo
    }
    return { enviado: false, motivo: 'provider_invalido' }
  } catch (e) {
    console.error('[whatsapp] Falha ao enviar texto:', e.message)
    throw e
  }
}

/**
 * Envia um comunicado por WhatsApp. Sem provider configurado, não envia e regista aviso.
 */
async function enviarComunicadoWhatsApp({
  celular,
  nomeDestinatario,
  titulo,
  corpo,
  departamentoNome
}) {
  const phone = digitosWhatsApp(celular)
  if (!phone) {
    return { enviado: false, motivo: 'sem_numero' }
  }

  if (!whatsappEstaConfigurado()) {
    return { enviado: false, motivo: 'whatsapp_desligado' }
  }

  const texto = montarTextoComunicado({
    nomeDestinatario,
    titulo,
    corpo,
    departamentoNome
  })

  try {
    if (PROVIDER === 'zapi') return await enviarZApi(phone, texto)
    if (PROVIDER === 'twilio') return await enviarTwilioWhatsApp(phone, texto)
    if (PROVIDER === 'pywhatkit') {
      // O WhatsApp Web não lida bem com muitos disparos concorrentes.
      const proximo = filaPywhatkit.then(() => enviarPywhatkit(phone, texto))
      filaPywhatkit = proximo.catch(() => {})
      return await proximo
    }
    if (PROVIDER === 'wwebjs' || PROVIDER === 'whatsapp-web.js') {
      const proximo = filaWwebjs.then(() => enviarWwebjs(phone, texto))
      filaWwebjs = proximo.catch(() => {})
      return await proximo
    }
    console.warn(`[whatsapp] WHATSAPP_PROVIDER desconhecido: ${PROVIDER}`)
    return { enviado: false, motivo: 'provider_invalido' }
  } catch (e) {
    console.error('[whatsapp] Falha ao enviar:', e.message)
    throw e
  }
}

module.exports = {
  digitosWhatsApp,
  enviarComunicadoWhatsApp,
  enviarTextoWhatsApp,
  whatsappEstaConfigurado,
  garantirConexaoWhatsApp,
  statusWhatsApp,
  reconectarWhatsApp,
  imprimirQrNoTerminal
}
