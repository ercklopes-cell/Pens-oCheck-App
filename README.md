# ⚖️ Pensão Check

App web PWA para controle de pagamentos de pensão alimentícia.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JS vanilla (PWA) |
| Hospedagem | Cloudflare Pages |
| API | Cloudflare Workers |
| Banco de dados | Cloudflare D1 (SQLite) |
| Arquivos | Cloudflare R2 (S3-compatible) |
| Auth | Google Identity Services (One Tap) |

## Estrutura do repositório

```
/
├── index.html        ← App principal (Cloudflare Pages serve este arquivo)
├── worker/
│   ├── worker.js     ← API Cloudflare Worker (D1 + R2)
│   └── wrangler.toml ← Configuração do Worker
└── README.md
```

## Deploy

### Frontend (Cloudflare Pages)
Conecte este repositório no Cloudflare Pages:
- **Framework**: None
- **Build command**: *(vazio)*
- **Output directory**: `/` *(raiz)*

### Backend (Cloudflare Worker)
```bash
cd worker
wrangler deploy
```

## Configuração obrigatória

Antes de usar, edite o `index.html` e preencha:

```js
// Linha ~740
const GOOGLE_CLIENT_ID = "SEU_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
```

**Como obter o Google Client ID:**
1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → Create OAuth 2.0 Client ID
3. Tipo: Web application
4. Authorized JavaScript origins: `https://pensao-check.pages.dev`
5. Copie o Client ID gerado

## Recursos

- ✅ Login com Google (sem senha)
- ✅ Upload de comprovantes para Cloudflare R2
- ✅ Banco de dados na nuvem (D1)
- ✅ Funciona offline (Service Worker)
- ✅ Instalável como app (PWA)
- ✅ Modo Demo (sem login)
- ✅ Geração de PDF
- ✅ Cofre de documentos
- ✅ Alerta de pendências

## Worker API Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | /api/upload | Upload arquivo → R2 |
| GET | /files/:key | Serve arquivo do R2 |
| GET/POST | /api/user | Dados do usuário |
| GET/POST | /api/pagamentos | Pagamentos |
| DELETE | /api/pagamentos/:id | Remove pagamento |
| GET/POST | /api/cofre | Documentos do cofre |
| DELETE | /api/cofre/:id | Remove documento |
