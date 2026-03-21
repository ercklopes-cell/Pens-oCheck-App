const PAGES_URL = "https://pens-ocheck-app.pages.dev";

const CORS = {
  "Access-Control-Allow-Origin":  PAGES_URL,
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-User-Id"
};

const json = (d,s=200) => new Response(JSON.stringify(d),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const err  = (m,s=400) => json({error:m},s);
const uid  = (req)     => req.headers.get("X-User-Id");

// Prompt do advogado especialista
const SYSTEM_PROMPT = `Você é o Dr. Legal, um advogado especialista em direito de família e pensão alimentícia no Brasil.

Suas responsabilidades:
- Orientar sobre direitos e obrigações relacionados à pensão alimentícia
- Explicar como calcular e revisar valores de pensão
- Informar sobre consequências do não pagamento (prisão, multas, protesto)
- Orientar sobre acordos, homologações e processos judiciais
- Explicar prazos, recursos e procedimentos legais

Regras:
- Sempre responda em português brasileiro
- Seja objetivo e claro, sem jargões excessivos
- Mencione que suas respostas são informativas e não substituem consulta jurídica formal quando pertinente
- Seja empático com usuários que enfrentam dificuldades
- Mantenha respostas entre 3 e 6 parágrafos no máximo
- Use emojis com moderação para deixar o texto mais acessível`;

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method==="OPTIONS") return new Response(null,{status:204,headers:CORS});

    try {

      // ── CHAT — GPT-4.1 via GitHub Models ──────────────────
      if (path==="/api/chat" && method==="POST") {
        const { messages } = await request.json();
        if (!messages?.length) return err("Mensagem vazia");

        // GITHUB_TOKEN deve ser configurado como secret no Worker
        // wrangler secret put GITHUB_TOKEN
        const token = env.GITHUB_TOKEN;
        if (!token) return err("Token não configurado",500);

        const ghRes = await fetch("https://models.inference.ai.azure.com/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify({
            model:       "gpt-4.1",
            max_tokens:  600,
            temperature: 0.7,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...messages.slice(-10) // máximo 10 mensagens de histórico
            ]
          })
        });

        if (!ghRes.ok) {
          const e = await ghRes.text();
          console.error("GitHub Models error:", e);
          return err("Erro ao contatar IA: " + ghRes.status, 502);
        }

        const data  = await ghRes.json();
        const reply = data.choices?.[0]?.message?.content || "Não obtive resposta.";
        return json({ reply });
      }

      // ── UPLOAD R2 ──────────────────────────────────────────
      if (path==="/api/upload" && method==="POST") {
        if (!uid(request)) return err("Nao autenticado",401);
        const fd=await request.formData(), file=fd.get("file");
        if (!file) return err("Sem arquivo");
        const ext=file.name.split(".").pop()||"bin";
        const key=`${uid(request)}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        await env.FILES.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
        return json({url:`${url.origin}/files/${key}`,key});
      }

      // ── SERVIR ARQUIVO R2 ──────────────────────────────────
      if (path.startsWith("/files/") && method==="GET") {
        const key=path.replace("/files/","");
        const obj=await env.FILES.get(key);
        if (!obj) return new Response("Nao encontrado",{status:404});
        const h=new Headers(CORS);
        obj.writeHttpMetadata(h);
        h.set("Cache-Control","public,max-age=31536000");
        return new Response(obj.body,{headers:h});
      }

      // ── USUÁRIO ────────────────────────────────────────────
      if (path==="/api/user") {
        if (!uid(request)) return err("Nao autenticado",401);
        if (method==="GET") {
          const {results}=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(uid(request)).all();
          if (!results.length) return json(null);
          const u=results[0]; u.beneficiarios=JSON.parse(u.beneficiarios||"[]"); return json(u);
        }
        if (method==="POST") {
          const b=await request.json();
          await env.DB.prepare("INSERT INTO users(id,nome,email,plano,plano_valido,data_inicio_pensao,beneficiarios,lembretes,uploads_mes,ultimo_mes_upload) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,email=excluded.email,plano=excluded.plano,plano_valido=excluded.plano_valido,data_inicio_pensao=excluded.data_inicio_pensao,beneficiarios=excluded.beneficiarios,lembretes=excluded.lembretes,uploads_mes=excluded.uploads_mes,ultimo_mes_upload=excluded.ultimo_mes_upload").bind(uid(request),b.nome||"",b.email||"",b.plano||"free",b.planoValido||null,b.dataInicioPensao||null,JSON.stringify(b.beneficiarios||[]),b.lembretes?1:0,b.uploadsMes||0,b.ultimoMesUpload||"").run();
          return json({ok:true});
        }
      }

      // ── PAGAMENTOS ─────────────────────────────────────────
      if (path==="/api/pagamentos") {
        if (!uid(request)) return err("Nao autenticado",401);
        if (method==="GET") {
          const {results}=await env.DB.prepare("SELECT * FROM pagamentos WHERE user_id=? ORDER BY ano_referencia DESC,mes_referencia DESC").bind(uid(request)).all();
          return json(results.map(r=>({id:r.id,valor:r.valor,dataPagamento:r.data_pagamento,mesReferencia:r.mes_referencia,anoReferencia:r.ano_referencia,formaPagamento:r.forma_pagamento,observacao:r.observacao,status:r.status,comprovante:r.comprovante_url,comprovanteNome:r.comprovante_nome,chavePix:r.chave_pix,beneficiarios:JSON.parse(r.beneficiarios||"[]"),isExtra:!!r.is_extra,createdAt:r.created_at})));
        }
        if (method==="POST") {
          const p=await request.json();
          await env.DB.prepare("INSERT INTO pagamentos(id,user_id,valor,data_pagamento,mes_referencia,ano_referencia,forma_pagamento,observacao,status,comprovante_url,comprovante_nome,chave_pix,beneficiarios,is_extra,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(p.id,uid(request),p.valor,p.dataPagamento,p.mesReferencia,p.anoReferencia,p.formaPagamento,p.observacao||"",p.status,p.comprovante||null,p.comprovanteNome||"",p.chavePix||"",JSON.stringify(p.beneficiarios||[]),p.isExtra?1:0,p.createdAt||new Date().toISOString()).run();
          return json({ok:true});
        }
      }

      if (path.startsWith("/api/pagamentos/") && method==="DELETE") {
        if (!uid(request)) return err("Nao autenticado",401);
        const id=path.split("/").pop();
        const {results}=await env.DB.prepare("SELECT comprovante_url FROM pagamentos WHERE id=? AND user_id=?").bind(id,uid(request)).all();
        if (results[0]?.comprovante_url?.includes("/files/")) await env.FILES.delete(results[0].comprovante_url.split("/files/")[1]).catch(()=>{});
        await env.DB.prepare("DELETE FROM pagamentos WHERE id=? AND user_id=?").bind(id,uid(request)).run();
        return json({ok:true});
      }

      // ── COFRE ──────────────────────────────────────────────
      if (path==="/api/cofre") {
        if (!uid(request)) return err("Nao autenticado",401);
        if (method==="GET") {
          const {results}=await env.DB.prepare("SELECT * FROM cofre WHERE user_id=? ORDER BY criado_em DESC").bind(uid(request)).all();
          return json(results.map(r=>({id:r.id,categoria:r.categoria,descricao:r.descricao,arquivo:r.arquivo_url,nomeArquivo:r.nome_arquivo,tipo:r.tipo,criadoEm:r.criado_em})));
        }
        if (method==="POST") {
          const c=await request.json();
          await env.DB.prepare("INSERT INTO cofre(id,user_id,categoria,descricao,arquivo_url,nome_arquivo,tipo,criado_em) VALUES(?,?,?,?,?,?,?,?)").bind(c.id,uid(request),c.categoria,c.descricao,c.arquivo||null,c.nomeArquivo||"",c.tipo||"imagem",c.criadoEm||new Date().toISOString()).run();
          return json({ok:true});
        }
      }

      if (path.startsWith("/api/cofre/") && method==="DELETE") {
        if (!uid(request)) return err("Nao autenticado",401);
        const id=path.split("/").pop();
        const {results}=await env.DB.prepare("SELECT arquivo_url FROM cofre WHERE id=? AND user_id=?").bind(id,uid(request)).all();
        if (results[0]?.arquivo_url?.includes("/files/")) await env.FILES.delete(results[0].arquivo_url.split("/files/")[1]).catch(()=>{});
        await env.DB.prepare("DELETE FROM cofre WHERE id=? AND user_id=?").bind(id,uid(request)).run();
        return json({ok:true});
      }

      return err("Rota nao encontrada",404);
    } catch(e) { return err("Erro interno: "+e.message,500); }
  }
};
