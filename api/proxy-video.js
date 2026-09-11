// /api/proxy-video.js
// Serve os bytes do vídeo da Kick através do nosso próprio domínio.
// Necessário por dois motivos: (1) evita o bloqueio de CORS que o
// navegador aplicaria se o <video> apontasse direto para o CDN da Kick,
// o que impediria o canvas de desenhar o vídeo para o preview/exportação;
// (2) permite repassar cabeçalhos de "Range" para que o usuário consiga
// avançar/voltar o vídeo (scrubbing) sem baixar o arquivo inteiro de novo.

import { Readable } from "node:stream";

export const config = {
  api: { responseLimit: false },
};

export default async function handler(req, res) {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).send("Parâmetro 'url' é obrigatório.");
  }

  try {
    const range = req.headers.range;
    const upstream = await fetch(rawUrl, {
      headers: range ? { Range: range } : {},
    });

    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    const cl = upstream.headers.get("content-length");
    const cr = upstream.headers.get("content-range");
    if (ct) res.setHeader("Content-Type", ct);
    if (cl) res.setHeader("Content-Length", cl);
    if (cr) res.setHeader("Content-Range", cr);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(500).send("Erro ao buscar o vídeo original.");
  }
}
