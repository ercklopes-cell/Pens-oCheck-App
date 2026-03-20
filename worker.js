/**
 * Pensão Check — Cloudflare Worker API
 * Banco: D1 (pensao-check-db)
 * Arquivos: R2 (pensao-check-files)
 *
 * Endpoints:
 *  POST /api/upload          — faz upload de arquivo para R2, retorna URL pública
 *  GET  /api/pagamentos      — lista pagamentos do usuário
 *  POST /api/pagamentos      — insere pagamento
 *  DELETE /api/pagamentos/:id— deleta pagamento
 *  GET  /api/cofre           — lista cofre do usuário
 *  POST /api/cofre           — insere item no cofre
 *  DELETE /api/cofre/:id     — deleta item do cofre
 *  GET  /api/user            — busca dados do usuário
 *  POST /api/user            — cria ou atualiza usuário (upsert)
 */

// ── CORS helper ──────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",           // troque pelo domínio do app em produção
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// ── Auth simples: X-User-Id no header ───────────────────────
// Em produção, valide um JWT do Google/Supabase aqui
function getUserId(request) {
  return request.headers.get("X-User-Id") || null;
}

// ── Roteador ─────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // Preflight CORS
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // ── UPLOAD R2 ──────────────────────────────────────────
      if (path === "/api/upload" && method === "POST") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);

        const formData = await request.formData();
        const file     = formData.get("file");
        if (!file) return err("Nenhum arquivo enviado");

        const ext      = file.name.split(".").pop() || "bin";
        const key      = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const bytes    = await file.arrayBuffer();

        await env.FILES.put(key, bytes, {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
          customMetadata: { originalName: file.name, userId: uid },
        });

        // URL pública via Worker (requer domínio público configurado no R2)
        // Formato: https://pensao-check-api.<subdomain>.workers.dev/files/<key>
        const fileUrl = `${url.origin}/files/${key}`;
        return json({ url: fileUrl, key });
      }

      // ── SERVIR ARQUIVO DO R2 ───────────────────────────────
      if (path.startsWith("/files/") && method === "GET") {
        const key    = path.replace("/files/", "");
        const object = await env.FILES.get(key);
        if (!object) return new Response("Arquivo não encontrado", { status: 404 });
        const headers = new Headers(CORS);
        object.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=31536000");
        return new Response(object.body, { headers });
      }

      // ── USUÁRIO ────────────────────────────────────────────
      if (path === "/api/user") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);

        if (method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM users WHERE id = ?"
          ).bind(uid).all();
          if (!results.length) return json(null);
          const u = results[0];
          u.beneficiarios = JSON.parse(u.beneficiarios || "[]");
          return json(u);
        }

        if (method === "POST") {
          const body = await request.json();
          await env.DB.prepare(`
            INSERT INTO users (id, nome, email, plano, plano_valido, data_inicio_pensao,
              beneficiarios, lembretes, uploads_mes, ultimo_mes_upload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              nome               = excluded.nome,
              email              = excluded.email,
              plano              = excluded.plano,
              plano_valido       = excluded.plano_valido,
              data_inicio_pensao = excluded.data_inicio_pensao,
              beneficiarios      = excluded.beneficiarios,
              lembretes          = excluded.lembretes,
              uploads_mes        = excluded.uploads_mes,
              ultimo_mes_upload  = excluded.ultimo_mes_upload
          `).bind(
            uid,
            body.nome || "",
            body.email || "",
            body.plano || "free",
            body.planoValido || null,
            body.dataInicioPensao || null,
            JSON.stringify(body.beneficiarios || []),
            body.lembretes ? 1 : 0,
            body.uploadsMes || 0,
            body.ultimoMesUpload || ""
          ).run();
          return json({ ok: true });
        }
      }

      // ── PAGAMENTOS ─────────────────────────────────────────
      if (path === "/api/pagamentos") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);

        if (method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM pagamentos WHERE user_id = ? ORDER BY ano_referencia DESC, mes_referencia DESC"
          ).bind(uid).all();
          const mapped = results.map(r => ({
            id:              r.id,
            valor:           r.valor,
            dataPagamento:   r.data_pagamento,
            mesReferencia:   r.mes_referencia,
            anoReferencia:   r.ano_referencia,
            formaPagamento:  r.forma_pagamento,
            observacao:      r.observacao,
            status:          r.status,
            comprovante:     r.comprovante_url,
            comprovanteNome: r.comprovante_nome,
            chavePix:        r.chave_pix,
            beneficiarios:   JSON.parse(r.beneficiarios || "[]"),
            isExtra:         !!r.is_extra,
            createdAt:       r.created_at,
          }));
          return json(mapped);
        }

        if (method === "POST") {
          const p = await request.json();
          await env.DB.prepare(`
            INSERT INTO pagamentos
              (id, user_id, valor, data_pagamento, mes_referencia, ano_referencia,
               forma_pagamento, observacao, status, comprovante_url, comprovante_nome,
               chave_pix, beneficiarios, is_extra, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            p.id, uid, p.valor, p.dataPagamento, p.mesReferencia, p.anoReferencia,
            p.formaPagamento, p.observacao || "", p.status,
            p.comprovante || null, p.comprovanteNome || "",
            p.chavePix || "", JSON.stringify(p.beneficiarios || []),
            p.isExtra ? 1 : 0, p.createdAt || new Date().toISOString()
          ).run();
          return json({ ok: true });
        }
      }

      if (path.startsWith("/api/pagamentos/") && method === "DELETE") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);
        const id = path.split("/").pop();

        // Remove arquivo do R2 se existir
        const { results } = await env.DB.prepare(
          "SELECT comprovante_url FROM pagamentos WHERE id = ? AND user_id = ?"
        ).bind(id, uid).all();
        if (results[0]?.comprovante_url?.includes("/files/")) {
          const key = results[0].comprovante_url.split("/files/")[1];
          await env.FILES.delete(key).catch(() => {});
        }

        await env.DB.prepare(
          "DELETE FROM pagamentos WHERE id = ? AND user_id = ?"
        ).bind(id, uid).run();
        return json({ ok: true });
      }

      // ── COFRE ──────────────────────────────────────────────
      if (path === "/api/cofre") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);

        if (method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM cofre WHERE user_id = ? ORDER BY criado_em DESC"
          ).bind(uid).all();
          const mapped = results.map(r => ({
            id:          r.id,
            categoria:   r.categoria,
            descricao:   r.descricao,
            arquivo:     r.arquivo_url,
            nomeArquivo: r.nome_arquivo,
            tipo:        r.tipo,
            criadoEm:    r.criado_em,
          }));
          return json(mapped);
        }

        if (method === "POST") {
          const c = await request.json();
          await env.DB.prepare(`
            INSERT INTO cofre (id, user_id, categoria, descricao, arquivo_url, nome_arquivo, tipo, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            c.id, uid, c.categoria, c.descricao,
            c.arquivo || null, c.nomeArquivo || "",
            c.tipo || "imagem", c.criadoEm || new Date().toISOString()
          ).run();
          return json({ ok: true });
        }
      }

      if (path.startsWith("/api/cofre/") && method === "DELETE") {
        const uid = getUserId(request);
        if (!uid) return err("Usuário não autenticado", 401);
        const id = path.split("/").pop();

        // Remove arquivo do R2 se existir
        const { results } = await env.DB.prepare(
          "SELECT arquivo_url FROM cofre WHERE id = ? AND user_id = ?"
        ).bind(id, uid).all();
        if (results[0]?.arquivo_url?.includes("/files/")) {
          const key = results[0].arquivo_url.split("/files/")[1];
          await env.FILES.delete(key).catch(() => {});
        }

        await env.DB.prepare(
          "DELETE FROM cofre WHERE id = ? AND user_id = ?"
        ).bind(id, uid).run();
        return json({ ok: true });
      }

      return err("Rota não encontrada", 404);

    } catch (e) {
      console.error(e);
      return err("Erro interno: " + e.message, 500);
    }
  },
};
