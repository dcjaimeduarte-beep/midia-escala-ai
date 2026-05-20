const express = require('express')
const router = express.Router()
const path = require('path')
const { v4: uuid } = require('uuid')
const sql = require('../db/database')

// Busca visitante pelo celular para auto-preenchimento (sem auth) — deve vir ANTES de /:id
router.get('/visitante', (req, res) => {
  const digitos = (req.query.celular || '').replace(/\D/g, '')
  if (digitos.length < 8) return res.json({ encontrado: false })
  const sufixo = `%${digitos.slice(-8)}`

  // Busca primeiro na tabela de visitantes cadastrados
  const cadastrado = sql.get(
    `SELECT id, nome, celular, bairro, cidade, igreja_origem AS igreja, '' AS convidado_por
     FROM visitantes WHERE REPLACE(REPLACE(REPLACE(celular,'-',''),'(',''),')','') LIKE ?
     ORDER BY atualizado_em DESC LIMIT 1`,
    sufixo
  )
  if (cadastrado) {
    const { total } = sql.get(
      `SELECT COUNT(*) AS total FROM presencas WHERE visitante_id = ?`, cadastrado.id
    ) || { total: 0 }
    return res.json({ encontrado: true, dados: { ...cadastrado, tipo: 'visitante' }, totalVisitas: Number(total), visitante_id: cadastrado.id })
  }

  // Fallback: busca no histórico de check-ins
  const ultimo = sql.get(
    `SELECT nome, celular, bairro, igreja, convidado_por, tipo
     FROM presencas WHERE celular LIKE ? AND celular != ''
     ORDER BY registrado_em DESC LIMIT 1`,
    sufixo
  )
  if (!ultimo) return res.json({ encontrado: false })

  const { total } = sql.get(
    `SELECT COUNT(*) AS total FROM presencas WHERE celular LIKE ? AND celular != ''`,
    sufixo
  ) || { total: 0 }

  res.json({ encontrado: true, dados: ultimo, totalVisitas: Number(total) })
})

// Busca visitante por nome (case-insensitive) — deve vir ANTES de /:id
router.get('/buscar-nome', (req, res) => {
  const termo = (req.query.nome || '').trim()
  if (termo.length < 2) return res.json([])
  const like = `%${termo}%`

  // Busca na tabela de visitantes cadastrados primeiro
  const cadastrados = sql.all(
    `SELECT v.id AS visitante_id, v.nome, v.celular, v.bairro, v.cidade AS bairro2,
       v.igreja_origem AS igreja, 'visitante' AS tipo,
       COUNT(p.id) AS total_visitas
     FROM visitantes v
     LEFT JOIN presencas p ON p.visitante_id = v.id
     WHERE LOWER(v.nome) LIKE LOWER(?)
     GROUP BY v.id
     ORDER BY v.nome ASC LIMIT 8`,
    like
  )
  if (cadastrados.length) return res.json(cadastrados)

  // Fallback: busca no histórico de check-ins
  const resultados = sql.all(
    `SELECT p.nome, p.celular, p.bairro, p.igreja, p.tipo,
       (SELECT COUNT(*) FROM presencas px
        WHERE LOWER(TRIM(px.nome)) = LOWER(TRIM(p.nome))) AS total_visitas
     FROM presencas p
     WHERE LOWER(TRIM(p.nome)) LIKE '%' || LOWER(TRIM(?)) || '%'
       AND p.id = (
         SELECT p2.id FROM presencas p2
         WHERE LOWER(TRIM(p2.nome)) = LOWER(TRIM(p.nome))
         ORDER BY
           CASE WHEN p2.celular != '' THEN 0 ELSE 1 END,
           CASE WHEN p2.bairro  != '' THEN 0 ELSE 1 END,
           CASE WHEN p2.igreja  != '' THEN 0 ELSE 1 END,
           p2.registrado_em DESC
         LIMIT 1
       )
     ORDER BY p.registrado_em DESC
     LIMIT 8`,
    termo
  )
  res.json(resultados)
})

// Serve a página de check-in para qualquer /:id
router.get('/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/checkin.html'))
})

// Info do culto para a página de check-in (sem auth)
router.get('/:id/info', (req, res) => {
  const culto = sql.get(`
    SELECT c.id, c.titulo, c.data, c.descricao, c.encerrado, e.nome AS evento_nome
    FROM cultos c
    LEFT JOIN eventos e ON c.evento_id = e.id
    WHERE c.id = ?
  `, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })
  res.json({ ...culto, encerrado: !!culto.encerrado })
})

// Lista de membros para autocomplete (sem auth)
router.get('/:id/membros', (req, res) => {
  const membros = sql.all(`SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome`)
  res.json(membros)
})

// Registrar presença (sem auth)
router.post('/:id', (req, res) => {
  const culto = sql.get(`SELECT id, encerrado FROM cultos WHERE id = ?`, req.params.id)
  if (!culto) return res.status(404).json({ erro: 'Culto não encontrado' })
  if (culto.encerrado) return res.status(400).json({ erro: 'Este culto já foi encerrado' })

  const { nome, tipo, convidado_por, usuario_id, celular, bairro, igreja, visitante_id } = req.body
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' })
  if (!['membro', 'visitante', 'visitante_convidado'].includes(tipo))
    return res.status(400).json({ erro: 'Tipo inválido' })

  const id    = uuid()
  const agora = new Date().toISOString()
  sql.run(
    `INSERT INTO presencas (id, culto_id, tipo, nome, convidado_por, usuario_id, celular, bairro, igreja, visitante_id, registrado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    culto.id,
    tipo,
    nome.trim(),
    convidado_por?.trim() || '',
    usuario_id || null,
    celular?.trim() || '',
    bairro?.trim()  || '',
    igreja?.trim()  || '',
    visitante_id || null,
    agora
  )
  res.status(201).json({ ok: true, id })
})

module.exports = router
