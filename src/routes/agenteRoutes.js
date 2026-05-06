const express = require('express')
const router = express.Router()
const { pastorDaMidia } = require('../agents/pastorDaMidia')

router.post('/perguntar', async (req, res) => {
  const { pergunta } = req.body
  if (!pergunta) return res.status(400).json({ erro: 'Campo "pergunta" é obrigatório' })

  try {
    const resultado = await pastorDaMidia(pergunta)
    res.json(resultado)
  } catch (err) {
    console.error('[agente]', err)
    const status = err?.status || err?.statusCode
    const msg = String(err?.message || '')
    let erro = 'Não foi possível obter resposta do Pastor da Mídia. Tente novamente em instantes.'
    if (status === 401 || msg.includes('401') || /api[_ ]?key/i.test(msg)) {
      erro =
        'Chave da API de IA ausente ou inválida. Configure ANTHROPIC_API_KEY no arquivo .env.'
    } else if (status === 429 || msg.includes('rate')) {
      erro = 'Limite de uso do serviço de IA atingido. Aguarde um pouco e tente de novo.'
    }
    res.status(500).json({ erro })
  }
})

module.exports = router
