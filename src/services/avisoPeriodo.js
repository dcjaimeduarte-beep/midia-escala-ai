/**
 * Período de exibição dos avisos (data/hora local do servidor).
 * data_* no formato YYYY-MM-DD (input date); hora_* HH:mm ou vazio.
 */

function parseLocalMs(dateYYYYMMDD, timeHHmm, fimDoDia) {
  if (!dateYYYYMMDD || !String(dateYYYYMMDD).trim()) return null
  const ymd = String(dateYYYYMMDD).trim().split('-').map(Number)
  if (ymd.length !== 3 || ymd.some((n) => Number.isNaN(n))) return null
  const [y, mo, d] = ymd
  let hh = 0
  let mm = 0
  let ss = 0
  let ms = 0
  if (timeHHmm && String(timeHHmm).trim()) {
    const p = String(timeHHmm).trim().split(':')
    hh = Number(p[0]) || 0
    mm = Number(p[1]) || 0
  } else if (fimDoDia) {
    hh = 23
    mm = 59
    ss = 59
    ms = 999
  }
  return new Date(y, mo - 1, d, hh, mm, ss, ms).getTime()
}

function msInicioAviso(a) {
  return parseLocalMs(a.data_inicio, a.hora_inicio, false)
}

function msFimAviso(a) {
  return parseLocalMs(a.data_fim, a.hora_fim, true)
}

/** true = deve aparecer no painel / lista ativa */
function avisoDentroDoPeriodoAtivo(a, agoraMs = Date.now()) {
  const ini = msInicioAviso(a)
  const fim = msFimAviso(a)
  if (ini != null && agoraMs < ini) return false
  if (fim != null && agoraMs > fim) return false
  return true
}

function validarPeriodoAviso(body) {
  const { data_inicio, hora_inicio, data_fim, hora_fim } = body
  const ini = msInicioAviso({ data_inicio, hora_inicio })
  const fim = msFimAviso({ data_fim, hora_fim })
  if (ini != null && fim != null && fim < ini) {
    return { ok: false, erro: 'A data/hora final deve ser posterior à inicial.' }
  }
  return { ok: true }
}

module.exports = {
  avisoDentroDoPeriodoAtivo,
  validarPeriodoAviso,
  msInicioAviso,
  msFimAviso
}
