# Deploy Locaweb (midia.jdafotografia.com.br)

Guia direto para subir o projeto online em servidor Locaweb com Node.js.

## 1) DNS do subdomínio

No painel de DNS da Locaweb, crie:

- Tipo: `A`
- Host: `midia`
- Valor: `IP do servidor`

Ou use `CNAME` para o host já existente no seu ambiente.

## 2) Preparar servidor

No servidor (SSH):

```bash
mkdir -p /var/www/midia-escala-ai
cd /var/www/midia-escala-ai
```

Suba os arquivos do projeto para esse diretório (git clone, rsync ou upload via painel).

## 3) Instalar runtime e dependências

```bash
cd /var/www/midia-escala-ai
npm install --omit=dev
```

## 4) Configurar ambiente (.env)

Crie o `.env` de produção com base em:

- `deploy/locaweb/.env.production.example`

Pontos críticos:

- `CORS_ORIGIN=https://midia.jdafotografia.com.br`
- `APP_PUBLIC_URL=https://midia.jdafotografia.com.br`
- `JWT_SECRET` forte
- `ANTHROPIC_API_KEY` válida

## 5) Subir app com PM2

```bash
npm i -g pm2
pm2 start deploy/locaweb/ecosystem.config.cjs
pm2 save
pm2 startup
```

## 6) Configurar Nginx

Use o arquivo:

- `deploy/locaweb/nginx-midia.jdafotografia.com.br.conf`

Copie para `sites-available`, habilite e recarregue:

```bash
sudo ln -s /etc/nginx/sites-available/nginx-midia.jdafotografia.com.br.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 7) SSL

Ative TLS/SSL para `midia.jdafotografia.com.br` (Let's Encrypt ou painel Locaweb).

## 8) Checklist final

- `https://midia.jdafotografia.com.br` abre
- login funciona
- criação de escala funciona
- solicitação/aprovação de troca funciona
- botão "Validar fluxo agora" no Pastor IA responde

## 9) Atualização de versão (deploy futuro)

```bash
cd /var/www/midia-escala-ai
git pull
npm install --omit=dev
pm2 restart midia-escala-ai
pm2 status
```
