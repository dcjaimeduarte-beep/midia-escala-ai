# 🔌 Rotas da API — Midia Escala AI

Base URL: `http://localhost:3000`

> Rotas marcadas com 🔒 exigem `Authorization: Bearer <token>`  
> Rotas marcadas com 👑 exigem role `admin`

---

## 🔑 Autenticação — `/auth`

### POST `/auth/cadastro`
Cadastro **público** só como **voluntário** (`role: membro`). Líderes e administradores continuam a ser criados por **convite** (`POST /auth/convidar`).

```json
{
  "nome": "João Silva",
  "email": "joao@exemplo.com",
  "senha": "mínimo 6 caracteres",
  "celular": "",
  "departamento_id": "uuid-opcional"
}
```

Se `departamento_id` for enviado e o departamento estiver ativo, o utilizador é já vinculado como **membro** nessa equipe. Resposta: `usuario`, `token` e `departamentos` (como no login).

> Várias contas podem usar o **mesmo e-mail**. **Senhas devem ser diferentes** por conta quando partilham o mesmo e-mail; caso contrário o login pode devolver `409` (escolher conta).

---

### POST `/auth/login`
```json
{ "email": "joao@peniel.com", "senha": "123456" }
```
**Resposta:** `usuario` + `token` JWT + `departamentos` do usuário

Se existir **uma única** conta ativa com aquele e-mail e a senha estiver correta, o login segue normalmente. Com **várias** contas no mesmo e-mail, apenas uma pode partilhar aquela senha; caso contrário devolve `409` com mensagem explicativa.

---

### GET `/auth/me` 🔒
Retorna perfil e departamentos do usuário logado.

---

### POST `/auth/convidar` 🔒
Cria utilizador com senha provisória, vínculo ao departamento e envio opcional de e-mail. **Administrador** ou **líder** do departamento escolhido.

**`perfil_convite`** (recomendado) define de uma vez o perfil global e o papel no departamento:

| Valor | `usuarios.role` | `role_depto` no departamento do convite |
|--------|-----------------|----------------------------------------|
| `voluntario` | `membro` | `membro` |
| `lider` | `lider` | `lider` |
| `admin` | `admin` | `membro` *(só quem convida é admin)* |

Se `perfil_convite` for omitido, usa-se o legado `role_depto`: `lider` → perfil líder; caso contrário voluntário.

```json
{
  "nome": "Maria",
  "email": "maria@exemplo.com",
  "celular": "",
  "departamento_id": "uuid",
  "perfil_convite": "voluntario",
  "enviar_email": true,
  "mensagem_convite": "Opcional — texto extra no e-mail e no convite copiado para WhatsApp."
}
```

---

## 📢 Avisos no app — `/aviso`

### GET `/aviso/listar` 🔒
- **Qualquer utilizador autenticado** recebe a mesma lista dos últimos 120 avisos (o campo departamento no comunicado é **informativo** — todos veem no app; e-mails/WhatsApp seguem a segmentação na criação).
- Por defeito só entram avisos **dentro do período** definido em `data_inicio` / `hora_inicio` / `data_fim` / `hora_fim` (se estiverem vazios, o aviso não tem limite nesse extremo). Fora do período o registo continua na base de dados mas **não** aparece no painel nem nesta lista.
- **`?incluir_encerrados=1`** — devolve também avisos já expirados ou ainda não iniciados (útil para histórico na UI).

### POST `/aviso/criar` 🔒
- **Admin:** corpo obrigatório; `titulo` opcional; `departamento_id` opcional (`null` = aviso para toda a gente com login).
- **Líder:** `departamento_id` obrigatório e tem de ser departamento em que é líder.
- **Período (opcional):** `data_inicio`, `hora_inicio`, `data_fim`, `hora_fim` — datas `YYYY-MM-DD`, horas `HH:mm` ou vazio. A data/hora final deve ser posterior à inicial quando ambos os lados estão definidos.
- **`notificar_email`** (opcional, omissão = `true`): se `true`, após gravar o comunicado o servidor envia **e-mail** (Nodemailer / `SMTP_*` no `.env`) aos membros abrangidos — aviso **geral**: todos os utilizadores ativos com e-mail (exceto o autor); aviso **por departamento**: membros desse departamento + administradores. Se SMTP não estiver configurado, regista aviso no log e não envia. Use `false` para publicar só no app.
- **`notificar_whatsapp`** (opcional, omissão = `false`): se `true`, tenta enviar **WhatsApp** aos mesmos destinatários que tenham **celular** válido no cadastro. Requer `WHATSAPP_PROVIDER` e credenciais no `.env` (**Z-API** ou **Twilio**). Sem integração configurada, não envia (registo no log do servidor).

```json
{
  "titulo": "Reunião",
  "corpo": "Terça 19h30 no templo.",
  "departamento_id": null,
  "data_inicio": "2026-05-10",
  "hora_inicio": "08:00",
  "data_fim": "2026-05-12",
  "hora_fim": "23:00",
  "notificar_email": true,
  "notificar_whatsapp": false
}
```

---

## 🏛️ Departamentos — `/departamento`

### GET `/departamento/cadastro-publico`
Sem autenticação. Lista mínima (`id`, `nome`, `icone`) dos departamentos **ativos**, para o formulário de auto-cadastro de voluntário.

### POST `/departamento/criar` 🔒 👑
```json
{ "nome": "Projeção", "descricao": "Letras e slides", "icone": "📽️", "cor": "#6C3483" }
```

### GET `/departamento/listar` 🔒
- Admin: vê todos com total de membros e líder
- Membro: vê apenas os que tem permissão

Query opcional (apenas admin): **`?todos=1`** — inclui departamentos **inativos** (para tela de Cadastros / reativação).

### GET `/departamento/:id` 🔒
Detalhes, lista de membros e últimas escalas do departamento.

### PUT `/departamento/:id` 🔒
Administrador ou líder do departamento. Edita nome, descrição, ícone, cor, **`mensagem_pastoral`** (texto exibido no painel dos membros daquele departamento) ou ativa/desativa.

### DELETE `/departamento/:id` 🔒 👑
Desativa o departamento (não apaga do banco).

---

## 👤 Usuários — `/usuario`

### GET `/usuario/listar` 🔒
- Admin: todos os usuários com seus departamentos
- Líder: apenas membros do seu departamento

### GET `/usuario/:id` 🔒
Perfil completo com departamentos vinculados.

### PUT `/usuario/:id` 🔒
Edita nome, email, senha, avatar. Admin pode ativar/desativar e definir **`role`** global (`admin` \| `lider` \| `membro`). Não é permitido rebaixar o único administrador restante.

### POST `/usuario/vincular` 🔒
Vincula usuário a um departamento com papel e permissões.

```json
{
  "usuario_id": "uuid",
  "departamento_id": "uuid",
  "role_depto": "lider",
  "acesso_departamentos": ["uuid-outro-dep"]
}
```

| `role_depto` | O que pode fazer |
|---|---|
| `lider` | Gerencia membros do depto, cria escalas |
| `membro` | Acessa apenas o próprio departamento |

`acesso_departamentos` — lista de IDs de outros departamentos que o usuário pode visualizar. Vazio = só vê o próprio.

### PUT `/usuario/:id/acesso` 🔒 👑
Atualiza quais departamentos o usuário pode acessar.
```json
{ "departamento_id": "uuid-depto-principal", "acesso_departamentos": ["uuid-dep2", "uuid-dep3"] }
```

### DELETE `/usuario/:id/desvincular` 🔒 👑
Remove o usuário de um departamento.
```json
{ "departamento_id": "uuid" }
```

---

## 📅 Escalas — `/escala`

### POST `/escala/criar` 🔒
```json
{
  "data": "11/05/2026",
  "departamento_id": "uuid",
  "evento_id": "uuid-opcional",
  "voluntarios": [{ "usuario_id": "uuid", "funcao": "" }]
}
```

Resposta inclui `voluntarios` e `trocas` (histórico de substituições, pode vir vazio).

### PUT `/escala/:escalaId` 🔒
Admin ou **líder** do departamento da escala. Atualiza metadados (pelo menos um campo):

```json
{
  "data": "11/05/2026",
  "evento_id": "uuid-opcional-ou-null",
  "observacao": "texto opcional"
}
```

### POST `/escala/:escalaId/trocar-voluntario` 🔒
Admin ou **líder** do departamento da escala. Registra que **antes** era o integrante `usuario_sai` e **passou a ser** `usuario_entra` (ambos do mesmo departamento). Mantém a função (`funcao`) do vínculo na escala.

```json
{
  "usuario_sai": "uuid",
  "usuario_entra": "uuid",
  "observacao": "opcional — ex.: combinado no grupo"
}
```

### GET `/escala/minhas/:usuario_id` 🔒
Escalas do usuário nos seus departamentos **ou** em que está designado como voluntário.

### GET `/escala/departamento/:departamento_id` 🔒
Todas as escalas de um departamento (requer acesso ao depto).

### GET `/escala/listar` 🔒 👑
Todas as escalas do sistema.

---

## 🤖 Agente IA — `/agente`

### POST `/agente/perguntar` 🔒
```json
{ "pergunta": "Crie uma escala para câmera no dia 11/05/2026" }
```

---

## 🏛️ Departamentos padrão (já cadastrados no boot)

| # | Nome | Ícone | Cor |
|---|------|-------|-----|
| 1 | Projeção | 📽️ | `#6C3483` |
| 2 | Ao Vivo | 🔴 | `#C0392B` |
| 3 | Stories | 📱 | `#E67E22` |
| 4 | Iluminação | 💡 | `#D4AC0D` |
| 5 | Fotos | 📷 | `#2980B9` |
| 6 | Engajamento | 💬 | `#27AE60` |

---

## 🧪 Fluxo completo de exemplo

```bash
# 1. Cadastrar admin
curl -X POST http://localhost:3000/auth/cadastro \
  -H "Content-Type: application/json" \
  -d '{"nome":"Pastor Admin","email":"admin@peniel.com","senha":"123456","role":"admin"}'

# 2. Login (guarda o token)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@peniel.com","senha":"123456"}' | jq -r '.token')

# 3. Ver departamentos
curl http://localhost:3000/departamento/listar \
  -H "Authorization: Bearer $TOKEN"

# 4. Cadastrar um voluntário
curl -X POST http://localhost:3000/auth/cadastro \
  -H "Content-Type: application/json" \
  -d '{"nome":"Maria Câmera","email":"maria@peniel.com","senha":"123456"}'

# 5. Vincular como líder do departamento Ao Vivo
curl -X POST http://localhost:3000/usuario/vincular \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":"ID_MARIA","departamento_id":"ID_AO_VIVO","role_depto":"lider"}'

# 6. Perguntar ao Pastor da Mídia
curl -X POST http://localhost:3000/agente/perguntar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pergunta":"Quem está disponível para câmera no dia 18/05/2026?"}'
```
