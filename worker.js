const PAGES_URL = "https://pens-ocheck-app.pages.dev";
const CORS = {"Access-Control-Allow-Origin":PAGES_URL,"Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-User-Id"};
const json = (d,s=200) => new Response(JSON.stringify(d),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const err  = (m,s=400) => json({error:m},s);
const uid  = (req)     => req.headers.get("X-User-Id");

const SYSTEM_PROMPT = `Você é o Dr. Legal, assistente jurídico do app Pensão Check, especializado em pensão alimentícia e direito de família no Brasil.

Personalidade: acolhedor, claro, empático, direto ao ponto, sem juridiquês.

Especialidades: cálculo e revisão de pensão, direitos do alimentante e alimentado, consequências do não pagamento (prisão civil, protesto, negativação), ação de alimentos, ação revisional, execução (art. 528 CPC), desconto em folha, alimentos gravídicos, pensão para filhos maiores.

Regras:
- Responda sempre em português brasileiro
- Máximo 180 palavras por resposta
- Cite artigos de lei quando relevante
- Oriente de forma prática e objetiva
- Lembre que é orientação informativa, não substitui advogado
- Se fugir do tema pensão/família, diga gentilmente que só atua nesses temas
- Se houver urgência (risco de prisão), priorize orientação prática imediata`;

export default {
  async fetch(request, env) {
    const url=new URL(request.url), path=url.pathname, method=request.method;
    if (method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
    try {

      if (path==="/api/chat" && method==="POST") {
        const body=await request.json().catch(()=>({}));
        const messages=body.messages;
        if (!Array.isArray(messages)||!messages.length) return err("Mensagem vazia");
        const token=env.GITHUB_TOKEN;
        if (!token) return err("IA não configurada",503);
        const ghRes=await fetch("https://models.inference.ai.azure.com/chat/completions",{
          method:"POST",
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
          body:JSON.stringify({model:"gpt-4.1",max_tokens:350,temperature:0.65,messages:[{role:"system",content:SYSTEM_PROMPT},...messages.slice(-12)]})
        });
        if (!ghRes.ok) { console.error("GitHub Models:",ghRes.status,await ghRes.text().catch(()=>"")); return err("Erro ao processar. Tente novamente.",502); }
        const data=await ghRes.json();
        const reply=data.choices?.[0]?.message?.content?.trim()||"Não obtive resposta agora.";
        return json({reply});
      }

      if (path==="/api/upload" && method==="POST") {
        if (!uid(request)) return err("Nao autenticado",401);
        const fd=await request.formData(),file=fd.get("file");
        if (!file) return err("Sem arquivo");
        const ext=file.name.split(".").pop()||"bin";
        const key=`${uid(request)}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        await env.FILES.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
        return json({url:`${url.origin}/files/${key}`,key});
      }

      if (path.startsWith("/files/") && method==="GET") {
        const key=path.replace("/files/","");
        const obj=await env.FILES.get(key);
        if (!obj) return new Response("Nao encontrado",{status:404});
        const h=new Headers(CORS); obj.writeHttpMetadata(h); h.set("Cache-Control","public,max-age=31536000");
        return new Response(obj.body,{headers:h});
      }

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
    } catch(e) { console.error(e); return err("Erro interno: "+e.message,500); }
  }
};
