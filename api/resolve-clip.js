// /api/resolve-clip.js
// Recebe o link da página de um clipe da Kick e devolve a URL direta do
// vídeo + metadados, consultando o endpoint que o próprio site da Kick usa
// para exibir a página do clipe (público, sem exigir login do usuário).
//
// Atenção: esse endpoint não é uma API oficialmente documentada pela Kick
// para uso de terceiros. É o mesmo caminho que o navegador de qualquer
// visitante usa ao abrir uma página de clipe público — não envolve login,
// senha, token pago nem contorno de proteção/DRM. Ainda assim, por não ser
// documentado, o formato da resposta pode mudar sem aviso; se isso
// acontecer, os nomes de campo abaixo (video_url, clip_url etc.) podem
// precisar de ajuste.

function extractSlug(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const clipParam = u.searchParams.get("clip");
    if (clipParam) return clipParam;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "clips");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    // fallback: último segmento do caminho, se parecer um id de clipe
    const last = parts[parts.length - 1];
    if (last && /^clip_/i.test(last)) return last;
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({ error: "Parâmetro 'url' é obrigatório." });
  }
  if (!/kick\.com/i.test(rawUrl)) {
    return res.status(400).json({ error: "Isso não parece um link da Kick." });
  }

  const slug = extractSlug(rawUrl);
  if (!slug) {
    return res.status(400).json({ error: "Não consegui identificar o ID do clipe nesse link." });
  }

  try {
    const upstream = await fetch(`https://api.kick.com/private/v1/clips/${slug}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; KickClipEditor/1.0)",
      },
    });

    if (!upstream.ok) {
      const bodyText = await upstream.text().catch(() => "");
      return res.status(502).json({
        error: `A Kick respondeu com status ${upstream.status} ao consultar o clipe.`,
        status: upstream.status,
        body: bodyText.slice(0, 800),
      });
    }

    const data = await upstream.json();
    const clip = data.clip || data.data || data;

    const videoUrl =
      clip.video_url || clip.clip_url || clip.source || clip.src ||
      (clip.video && clip.video.url) || null;

    if (!videoUrl) {
      return res.status(502).json({
        error: "A resposta da Kick não trouxe uma URL de vídeo reconhecível.",
        raw: clip,
      });
    }

    return res.status(200).json({
      videoUrl,
      title: clip.title || null,
      duration: clip.duration || null,
      width: clip.width || null,
      height: clip.height || null,
      thumbnail: clip.thumbnail_url || clip.thumbnail || null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao consultar a Kick.", detail: String(e && e.message) });
  }
}
