# 💚 Pensão Check

> Controle seguro e inteligente da sua pensão alimentícia.

Aplicativo web single-page (SPA) para registro, acompanhamento e comprovação de pagamentos de pensão alimentícia. Roda 100% no navegador — sem servidor, sem banco de dados externo.

---

## ✨ Funcionalidades

- **Dashboard** — visão geral de pagamentos e status
- **Adicionar Pagamento** — registro com extração automática de Pix
- **Histórico** — linha do tempo de todos os pagamentos
- **Cofre Digital** — armazenamento seguro de documentos (JPG, PNG, PDF)
- **Relatórios** — exportação em PDF
- **Suporte WhatsApp** — chatbot 24h + assessoria jurídica
- **Plano Free / Pro** — controle por beneficiários e funcionalidades

---

## 🚀 Como usar (GitHub Pages)

1. Faça um **fork** deste repositório
2. Vá em **Settings → Pages**
3. Em *Source*, selecione `Deploy from a branch`
4. Selecione a branch `main` e pasta `/ (root)`
5. Clique em **Save**
6. Aguarde ~1 minuto e acesse `https://<seu-usuario>.github.io/<nome-do-repo>`

---

## 🛠️ Tecnologias

- HTML5 + CSS3 + JavaScript puro (sem frameworks)
- `localStorage` para persistência de dados no navegador
- [jsPDF](https://github.com/parallax/jsPDF) para geração de relatórios
- Layout responsivo (mobile-first)

---

## ⚙️ Configuração dos links WhatsApp

No arquivo `index.html`, localize as constantes no início do bloco `<script>` e substitua pelos números reais:

```js
const SUPORTE_WHATS = 'https://wa.me/55XXXXXXXXXXX'; // Chatbot de suporte
const ADVOGADO_WHATS = 'https://wa.me/55XXXXXXXXXXX'; // Advogado
```

---

## 📄 Licença

Uso privado. Todos os direitos reservados © Pensão Check.
