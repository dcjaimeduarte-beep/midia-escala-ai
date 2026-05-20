const express = require('express')
const router = express.Router()
const { v4: uuid } = require('uuid')
const sql = require('../db/database')
const { autenticar, apenasVisitantes } = require('../auth/middleware')

function mapVisitante(v) {
  return v ? { ...v } : null
}

// GET /visitante/buscar?q=termo — busca por nome ou celular (admin/lider/acesso_visitantes)
router.get('/buscar', autenticar, apenasVisitantes, (req, res) => {
  const q = (req.query.q || '').trim()
  if (q.length < 2) return res.json([])
  const termo = `%${q}%`
  const rows = sql.all(
    `SELECT v.*, u.nome AS cadastrado_por_nome
     FROM visitantes v
     LEFT JOIN usuarios u ON u.id = v.cadastrado_por
     WHERE v.nome LIKE ? OR v.celular LIKE ?
     ORDER BY v.nome ASC LIMIT 20`,
    termo, termo
  )
  res.json(rows)
})

// GET /visitante/listar — lista todos com contagem de visitas
router.get('/listar', autenticar, apenasVisitantes, (req, res) => {
  const rows = sql.all(
    `SELECT v.*,
       u.nome AS cadastrado_por_nome,
       COUNT(p.id) AS total_visitas,
       MAX(p.registrado_em) AS ultima_visita
     FROM visitantes v
     LEFT JOIN usuarios u ON u.id = v.cadastrado_por
     LEFT JOIN presencas p ON p.visitante_id = v.id
     GROUP BY v.id
     ORDER BY v.nome ASC`
  )
  res.json(rows)
})

// GET /visitante/contar-checkin — quantos visitantes do check-in ainda não foram importados
router.get('/contar-checkin', autenticar, apenasVisitantes, (req, res) => {
  const { total } = sql.get(
    `SELECT COUNT(DISTINCT LOWER(TRIM(nome))) AS total
     FROM presencas
     WHERE tipo IN ('visitante','visitante_convidado')
       AND TRIM(nome) != ''
       AND visitante_id IS NULL`
  ) || { total: 0 }
  res.json({ total: Number(total) })
})

// GET /visitante/:id — detalhe + histórico de cultos
router.get('/:id', autenticar, apenasVisitantes, (req, res) => {
  const v = sql.get(
    `SELECT v.*, u.nome AS cadastrado_por_nome
     FROM visitantes v
     LEFT JOIN usuarios u ON u.id = v.cadastrado_por
     WHERE v.id = ?`,
    req.params.id
  )
  if (!v) return res.status(404).json({ erro: 'Visitante não encontrado' })

  const historico = sql.all(
    `SELECT p.registrado_em, p.tipo, p.convidado_por,
       c.titulo, c.data AS culto_data, e.nome AS evento_nome
     FROM presencas p
     LEFT JOIN cultos c ON c.id = p.culto_id
     LEFT JOIN eventos e ON e.id = c.evento_id
     WHERE p.visitante_id = ?
     ORDER BY p.registrado_em DESC`,
    req.params.id
  )
  res.json({ ...mapVisitante(v), historico })
})

// POST /visitante/criar
router.post('/criar', autenticar, apenasVisitantes, (req, res) => {
  const { nome, celular, email, data_nascimento, bairro, cidade, igreja_origem, como_conheceu, observacoes } = req.body
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' })
  const agora = new Date().toISOString()
  const id = uuid()
  sql.run(
    `INSERT INTO visitantes (id,nome,celular,email,data_nascimento,bairro,cidade,igreja_origem,como_conheceu,observacoes,cadastrado_por,criado_em,atualizado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    nome.trim(),
    celular?.trim() || '',
    email?.trim() || '',
    data_nascimento?.trim() || '',
    bairro?.trim() || '',
    cidade?.trim() || '',
    igreja_origem?.trim() || '',
    como_conheceu?.trim() || '',
    observacoes?.trim() || '',
    req.usuario.id,
    agora, agora
  )
  res.status(201).json(mapVisitante(sql.get('SELECT * FROM visitantes WHERE id = ?', id)))
})

// PUT /visitante/:id
router.put('/:id', autenticar, apenasVisitantes, (req, res) => {
  const v = sql.get('SELECT id FROM visitantes WHERE id = ?', req.params.id)
  if (!v) return res.status(404).json({ erro: 'Visitante não encontrado' })
  const { nome, celular, email, data_nascimento, bairro, cidade, igreja_origem, como_conheceu, observacoes } = req.body
  if (nome !== undefined) sql.run('UPDATE visitantes SET nome=? WHERE id=?', nome.trim(), req.params.id)
  if (celular !== undefined) sql.run('UPDATE visitantes SET celular=? WHERE id=?', celular.trim(), req.params.id)
  if (email !== undefined) sql.run('UPDATE visitantes SET email=? WHERE id=?', email.trim(), req.params.id)
  if (data_nascimento !== undefined) sql.run('UPDATE visitantes SET data_nascimento=? WHERE id=?', data_nascimento.trim(), req.params.id)
  if (bairro !== undefined) sql.run('UPDATE visitantes SET bairro=? WHERE id=?', bairro.trim(), req.params.id)
  if (cidade !== undefined) sql.run('UPDATE visitantes SET cidade=? WHERE id=?', cidade.trim(), req.params.id)
  if (igreja_origem !== undefined) sql.run('UPDATE visitantes SET igreja_origem=? WHERE id=?', igreja_origem.trim(), req.params.id)
  if (como_conheceu !== undefined) sql.run('UPDATE visitantes SET como_conheceu=? WHERE id=?', como_conheceu.trim(), req.params.id)
  if (observacoes !== undefined) sql.run('UPDATE visitantes SET observacoes=? WHERE id=?', observacoes.trim(), req.params.id)
  sql.run('UPDATE visitantes SET atualizado_em=? WHERE id=?', new Date().toISOString(), req.params.id)
  res.json(mapVisitante(sql.get('SELECT * FROM visitantes WHERE id = ?', req.params.id)))
})

// POST /visitante/importar-checkin — importa visitantes únicos do histórico de check-ins
router.post('/importar-checkin', autenticar, apenasVisitantes, (req, res) => {
  // Busca presenças de visitantes que ainda não estão vinculadas a um visitante cadastrado
  const presencas = sql.all(
    `SELECT p.nome, p.celular, p.bairro, p.igreja,
       MAX(p.registrado_em) AS ultima,
       COUNT(*) AS total
     FROM presencas p
     WHERE p.tipo IN ('visitante','visitante_convidado')
       AND TRIM(p.nome) != ''
       AND p.visitante_id IS NULL
     GROUP BY LOWER(TRIM(p.nome))
     ORDER BY ultima DESC`
  )

  let importados = 0
  let vinculados = 0
  const agora = new Date().toISOString()
  const { v4: uuidv4 } = require('uuid')

  for (const p of presencas) {
    const nomeNorm = p.nome.trim()
    // Verifica se já existe visitante com mesmo nome (case-insensitive)
    const existente = sql.get(
      `SELECT id FROM visitantes WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?))`, nomeNorm
    )
    let visitanteId = existente?.id
    if (!visitanteId) {
      visitanteId = uuidv4()
      sql.run(
        `INSERT INTO visitantes (id,nome,celular,email,data_nascimento,bairro,cidade,igreja_origem,como_conheceu,observacoes,cadastrado_por,criado_em,atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        visitanteId, nomeNorm,
        p.celular || '', '', '', p.bairro || '', '', p.igreja || '', '', '',
        req.usuario.id, agora, agora
      )
      importados++
    }
    // Vincula todas as presenças com esse nome ao visitante
    sql.run(
      `UPDATE presencas SET visitante_id = ?
       WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?)) AND visitante_id IS NULL`,
      visitanteId, nomeNorm
    )
    vinculados++
  }
  res.json({ ok: true, importados, vinculados })
})

// DELETE /visitante/:id — admin only
router.delete('/:id', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem excluir visitantes' })
  if (!sql.get('SELECT id FROM visitantes WHERE id = ?', req.params.id))
    return res.status(404).json({ erro: 'Visitante não encontrado' })
  sql.run('UPDATE presencas SET visitante_id = NULL WHERE visitante_id = ?', req.params.id)
  sql.run('DELETE FROM visitantes WHERE id = ?', req.params.id)
  res.json({ ok: true })
})

module.exports = router
