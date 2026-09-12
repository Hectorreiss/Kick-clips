// /api/proxy-manifest.js
//
// Alguns clipes vêm em formato de streaming (HLS, arquivo .m3u8) em vez de
// um .mp4 único. Um .m3u8 é só um texto listando vários pedacinhos (.ts) do
// vídeo. Aqui a gente busca esse texto e reescreve cada linha pra passar
// pelo nosso próprio proxy também — senão o navegador tentaria buscar os
// pedaços direto no CDN da Kick e esbarraria em CORS de novo.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).send("Parâmetro 'url' é obrigatório.");
  }

  try {
    const upstream = await fetch(rawUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).send("Não foi possível buscar o manifesto original.");
    }
    const text = await upstream.text();
    const base = new URL(rawUrl);

    const rewritten = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        let abs;
        try {
          abs = new URL(trimmed, base).href;
        } catch {
          return line;
        }
        const target = /\.m3u8(\?|$)/i.test(abs) ? "proxy-manifest" : "proxy-video";
        return `/api/${target}?url=${encodeURIComponent(abs)}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(rewritten);
  } catch (e) {
    res.status(500).send("Erro ao buscar o manifesto.");
  }
}
