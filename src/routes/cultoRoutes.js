const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const QRCode = require('qrcode')
const sql = require('../db/database')
const { autenticar, apenasAdminOuLider } = require('../auth/middleware')

function getAppUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`
}

// ── PROTEGIDOS (admin / lider) ─────────────────────────────────────────────

router.get('/listar', autenticar, apenasAdminOuLider, (req, res) => {
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

router.post('/criar', autenticar, apenasAdminOuLider, (req, res) => {
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

router.put('/:id', autenticar, apenasAdminOuLider, (req, res) => {
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

router.post('/:id/encerrar', autenticar, apenasAdminOuLider, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  sql.run(`UPDATE cultos SET encerrado = 1 WHERE id = ?`, req.params.id)
  res.json({ ok: true })
})

router.post('/:id/reabrir', autenticar, apenasAdminOuLider, (req, res) => {
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

router.get('/:id/qrcode', autenticar, apenasAdminOuLider, async (req, res) => {
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

router.get('/:id/presencas', autenticar, apenasAdminOuLider, (req, res) => {
  if (!sql.get(`SELECT id FROM cultos WHERE id = ?`, req.params.id))
    return res.status(404).json({ erro: 'Culto não encontrado' })
  const presencas = sql.all(
    `SELECT * FROM presencas WHERE culto_id = ? ORDER BY registrado_em ASC`,
    req.params.id
  )
  res.json(presencas)
})

module.exports = router
