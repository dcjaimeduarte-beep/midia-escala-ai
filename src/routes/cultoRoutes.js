const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const QRCode = require('qrcode')
const sql = require('../db/database')
const { autenticar, apenasAdmin, apenasAdminOuLider, apenasAcessoCultosOuLider } = require('../auth/middleware')

function getAppUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`
}

// ── PROTEGIDOS (admin / lider) ─────────────────────────────────────────────

router.get('/listar', autenticar, (req, res) => {
  const cultos = sql.all(`
    SELECT
      c.*,
      e.nome  AS evento_nome,
      u.nome  AS criado_por_nome,
      (SELECT COUNT(*) FROM presencas WHERE culto_id = c.id)                                    AS total_presencas,
      (SELECT COUNT(*) FROM presencas WHERE culto_id = c.id AND tipo = 'membro')                AS total_membros,
      (SELECT COUNT(*) FROM presencas WHERE culto_id = c.id AND tipo = 'visitante')             AS total_visitantes,
      (SELECT COUNT(*) FROM presencas WHERE culto_id = c.id AND tipo = 'visitante_convidado')   AS total_convidados
    FROM cultos c
    LEFT JOIN eventos   e ON c.evento_id  = e.id
    LEFT JOIN usuarios  u ON c.criado_por = u.id
    ORDER BY c.data DESC, c.criado_em DESC
  `)
  res.json(cultos.map(c => ({ ...c, encerrado: !!c.encerrado })))
})

router.post('/criar', autenticar, apenasAcessoCultosOuLider, (req, res) => {
  const { titulo, evento_id, data, descricao } = req.body
  if (!data) return res.status(400).json({ erro: 'data é obrigatória' })

  const id    = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO cultos (id, titulo, evento_id, congregacao_id, data, descricao, encerrado, criado_por, criado_em)
     VALUES (?,?,?,?,?,?,0,?,?)`,
    id,
    titulo || '',
    evento_id || null,
    req.usuario.congregacao_id || null,
    data,
    descricao || '',
    req.usuario.id,
    agora
  )
  const culto = sql.get(`SELECT * FROM cultos WHERE id = ?`, id)
  res.status(201).json({ ...culto, encerrado: !!culto.encerrado })
})

// PUT /culto/presenca/:id — editar dados de uma presença (admin/lider/acesso_cultos)
router.put('/presenca/:id', autenticar, apenasAcessoCultosOuLider, (req, res) => {
  const p = sql.get('SELECT id FROM presencas WHERE id = ?', req.params.id)
  if (!p) return res.status(404).json({ erro: 'Presença não encontrada' })
  const { nome, tipo, celular, bairro, igreja, convidado_por } = req.body
  const fields = { nome, tipo, celular, bairro, igreja, convidado_por }
  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined) sql.run(`UPDATE presencas SET ${col}=? WHERE id=?`, String(val).trim(), req.params.id)
  }
  res.json({ ok: true })
})

// DELETE /culto/presenca/:id — excluir uma presença (admin/lider)
router.delete('/presenca/:id', autenticar, apenasAdminOuLider, (req, res) => {
  if (!sql.get('SELECT id FROM presencas WHERE id = ?', req.params.id))
    return res.status(404).json({ erro: 'Presença não encontrada' })
  sql.run('DELETE FROM presencas WHERE id = ?', req.params.id)
  res.json({ ok: true })
})

router.put('/:id', autenticar, apenasAcessoCultosOuLider, (req, res) => {
  const culto = sql.get(`SELECT * FROM cultos WHERE id = ?`, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })

  const { titulo, evento_id, data, descricao } = req.body
  if (titulo    !== undefined) sql.run(`UPDATE cultos SET titulo    = ? WHERE id = ?`, titulo,    req.params.id)
  if (evento_id !== undefined) sql.run(`UPDATE cultos SET evento_id = ? WHERE id = ?`, evento_id || null, req.params.id)
  if (data      !== undefined) sql.run(`UPDATE cultos SET data      = ? WHERE id = ?`, data,      req.params.id)
  if (descricao !== undefined) sql.run(`UPDATE cultos SET descricao = ? WHERE id = ?`, descricao, req.params.id)

  const atual = sql.get(`SELECT * FROM cultos WHERE id = ?`, req.params.id)
  res.json({ ...atual, encerrado: !!atual.encerrado })
})

router.post('/:id/encerrar', autenticar, apenasAcessoCultosOuLider, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  sql.run(`UPDATE cultos SET encerrado = 1 WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

router.post('/:id/reabrir', autenticar, apenasAdmin, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  sql.run(`UPDATE cultos SET encerrado = 0 WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

router.delete('/:id', autenticar, apenasAdminOuLider, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  sql.run(`DELETE FROM cultos WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

router.get('/:id/qrcode', autenticar, async (req, res) => {
  const culto = sql.get(`SELECT * FROM cultos WHERE id = ?`, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })

  const url = `${getAppUrl(req)}/checkin/${culto.id}`
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: '#0c0e11', light: '#ffffff' }
    })
    res.json({ qrcode: dataUrl, url })
  } catch {
    res.status(500).json({ erro: 'Erro ao gerar QR code' })
  }
})

router.get('/visitantes-geral', autenticar, apenasAcessoCultosOuLider, (req, res) => {
  const TIPOS_VALIDOS = ['membro', 'visitante', 'visitante_convidado']
  const tipos = (req.query.tipos || 'membro,visitante,visitante_convidado')
    .split(',').map(t => t.trim()).filter(t => TIPOS_VALIDOS.includes(t))
  if (!tipos.length) return res.json([])
  const de = req.query.de || null
  const ate = req.query.ate || null
  const placeholders = tipos.map(() => '?').join(',')
  const params = [...tipos]
  let dateClause = ''
  if (de) { dateClause += ' AND c.data >= ?'; params.push(de) }
  if (ate) { dateClause += ' AND c.data <= ?'; params.push(ate) }
  const rows = sql.all(
    `SELECT p.*,
       c.titulo AS culto_titulo, c.data AS culto_data,
       e.nome AS evento_nome,
       CASE WHEN p.celular = '' THEN 0
            ELSE (SELECT COUNT(*) FROM presencas p2
                  WHERE p2.celular = p.celular AND p2.celular != ''
                    AND p2.tipo IN ('visitante','visitante_convidado'))
       END AS total_visitas
     FROM presencas p
     JOIN cultos c ON c.id = p.culto_id
     LEFT JOIN eventos e ON c.evento_id = e.id
     WHERE p.tipo IN (${placeholders})${dateClause}
     ORDER BY c.data DESC, c.id, p.registrado_em ASC`,
    ...params
  )
  res.json(rows)
})

router.get('/:id/presencas', autenticar, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  const presencas = sql.all(
    `SELECT p.*,
       CASE WHEN p.celular = '' THEN 0
            ELSE (SELECT COUNT(*) FROM presencas p2
                  WHERE p2.celular = p.celular AND p2.celular != ''
                    AND p2.tipo IN ('visitante','visitante_convidado'))
       END AS total_visitas
     FROM presencas p WHERE p.culto_id = ?
     ORDER BY p.registrado_em ASC`,
    req.params.id
  )
  res.json(presencas)
})

// Histórico de visitas de um visitante pelo celular (autenticado)
router.get('/visitante-historico', autenticar, (req, res) => {
  const celular = (req.query.celular || '').trim()
  if (!celular) return res.json([])
  const digitos = celular.replace(/\D/g, '')
  const sufixo = `%${digitos.slice(-8)}`
  const historico = sql.all(
    `SELECT c.id AS culto_id, c.titulo, c.data, e.nome AS evento_nome, p.tipo, p.registrado_em
     FROM presencas p
     JOIN cultos c ON c.id = p.culto_id
     LEFT JOIN eventos e ON c.evento_id = e.id
     WHERE p.celular LIKE ? AND p.celular != ''
     ORDER BY c.data DESC, p.registrado_em DESC`,
    sufixo
  )
  res.json(historico)
})

module.exports = router
