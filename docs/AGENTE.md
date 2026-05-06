# 🔥 Pastor da Mídia — Documentação do Agente IA

Agente baseado em **Claude Sonnet 4.6** para gestão da equipe de mídia da Peniel.

---

## Identidade

| Campo | Valor |
|-------|-------|
| Nome | Pastor da Mídia |
| Modelo | `claude-sonnet-4-6` |
| Arquivo | `src/agents/pastorDaMidia.js` |
| Rota | `POST /agente/perguntar` |
| Idioma | Português Brasileiro |
| Formato de data | DD/MM/AAAA |

---

## Especialistas disponíveis

Você pode escolher o especialista no body da rota `POST /agente/perguntar`:

```json
{
  "pergunta": "texto",
  "especialista": "gestao"
}
```

IDs suportados:

| ID | Nome | Foco |
|----|------|------|
| `pastor` | Pastor da Mídia | Coordenação geral |
| `gestao` | Especialista em Gestão | Prioridade, capacidade e execução |
| `fluxo_equipe` | Especialista em Fluxo de Equipe | Papéis, aprovação e handoff |
| `teste_fluxo` | Agente de Teste de Fluxo | QA funcional ponta a ponta com gate |
| `teste_regressao` | Agente de Teste de Regressão | Proteção contra quebra de fluxos antigos |

Também disponível em `GET /agente/especialistas`.

---

## Rota de validação de mudança (gate)

`POST /agente/validar-mudanca`

Body:

```json
{
  "mudanca": "Descreva o que foi alterado",
  "especialista": "teste_fluxo",
  "checklist": [
    "Membro solicita troca",
    "Lider aprova no modal",
    "Escala atualiza para todos"
  ]
}
```

Saída esperada:
- `STATUS: APROVADO|REPROVADO`
- `ASSERTIVIDADE: N%`
- Lista de testes com `PASSOU/FALHOU`
- Falhas críticas e ações bloqueantes (quando houver)

Critério de aprovação: somente com 100% e zero falhas críticas.

---

## Ferramentas (Tools)

| Tool | Descrição | Parâmetros obrigatórios |
|------|-----------|------------------------|
| `listar_departamentos` | Lista todos os departamentos | — |
| `listar_usuarios` | Lista voluntários (filtro opcional por depto) | — |
| `sugerir_voluntarios` | Verifica disponibilidade por data | `departamento_id`, `data` |
| `criar_escala` | Cria escala + emite evento no eventBus | `departamento_id`, `data` |
| `listar_escalas` | Lista escalas com filtros opcionais | — |
| `notificar_equipe` | Envia notificação via eventBus | `mensagem`, `tipo` |

---

## Prompt Caching

O system prompt é cacheado com `cache_control: { type: 'ephemeral' }`.  
Verificar cache hits em: `resposta.uso.cache_read_input_tokens`

---

## Eventos emitidos

| Evento | Quando | Payload |
|--------|--------|---------|
| `escala_criada` | Tool `criar_escala` executada | `{ id, data, data_br, departamento_id, voluntarios, observacao }` |
| `notificacao_equipe` | Tool `notificar_equipe` executada | `{ mensagem, tipo, destinatarios, timestamp }` |

---

## Exemplos de perguntas

```
"Crie uma escala de câmera para 11/05/2026"
"Quem está disponível no departamento de som no dia 18/05/2026?"
"Liste todas as escalas do mês de maio"
"Notifique a equipe que o culto de domingo foi antecipado para as 9h"
"Quais escalas estão sem voluntário?"
"Gere uma escala completa para o culto de domingo 25/05/2026"
```

---

## Tarefas pendentes do agente

- [ ] Tool `verificar_conflitos` — voluntário em dois lugares ao mesmo tempo
- [ ] Tool `gerar_escala_mensal` — todas as escalas do mês de uma vez
- [ ] Tool `relatorio_frequencia` — frequência de serviço por voluntário
- [ ] Tool `listar_escalas_abertas` — escalas com vagas em aberto
- [ ] Streaming SSE da resposta em tempo real
- [ ] Contexto multi-turn por sessão (histórico de conversa)
- [ ] Memória persistente (padrões e preferências da equipe)
