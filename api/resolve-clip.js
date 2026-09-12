// /api/resolve-clip.js
//
// Recebe o link da PÁGINA de um clipe da Kick, abre essa página num Chrome
// headless (sem interface) rodando no servidor, espera o player carregar,
// e "escuta" as requisições de rede até encontrar o arquivo de vídeo
// (.mp4 ou .m3u8) que o próprio player carrega normalmente para qualquer
// visitante. Não envolve login, senha nem contorno de DRM/proteção — é
// exatamente o que o navegador de qualquer pessoa faz ao assistir o clipe.
//
// Isso é necessário porque a Kick não publica uma API simples que devolva
// essa URL direto em JSON (confirmado: até ferramentas de terceiros
// especializadas nisso precisam fazer o mesmo, abrindo um navegador de
// verdade por trás). É também a parte mais pesada do projeto: abrir um
// Chrome inteiro dentro de uma função serverless tem limite de tempo,
// memória e tamanho — se der timeout ou erro de memória na Vercel, os
// ajustes ficam nos comentários marcados com "AJUSTE" abaixo.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

function looksLikeMedia(url) {
  return /\.(m3u8|mp4)(\?|$)/i.test(url);
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

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );

    // Bloqueia imagens/fontes/css para a página carregar mais rápido —
    // só nos interessa a requisição do arquivo de vídeo.
    await page.setRequestInterception(true);
    const found = { url: null };
    page.on("request", (request) => {
      const type = request.resourceType();
      if (!found.url && looksLikeMedia(request.url())) found.url = request.url();
      if (["image", "font", "stylesheet", "media"].includes(type) && !looksLikeMedia(request.url())) {
        request.abort();
      } else {
        request.continue();
      }
    });
    page.on("response", (response) => {
      if (!found.url && looksLikeMedia(response.url())) found.url = response.url();
    });

    await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Dá um tempo extra pro player iniciar e disparar a requisição do
    // vídeo, caso não tenha aparecido só com o carregamento da página.
    // AJUSTE: se estiver dando timeout sem achar o vídeo, aumente esse
    // valor (ex. 8000) — pode ser que o player demore mais pra iniciar.
    const start = Date.now();
    while (!found.url && Date.now() - start < 12000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const title = await page.title().catch(() => null);
    await browser.close();
    browser = null;

    if (!found.url) {
      return res.status(504).json({
        error: "A página do clipe carregou, mas não encontrei a requisição do arquivo de vídeo a tempo.",
      });
    }

    return res.status(200).json({
      videoUrl: found.url,
      title,
      isHls: /\.m3u8(\?|$)/i.test(found.url),
    });
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    return res.status(500).json({
      error: "Falha ao processar a página do clipe com o navegador headless.",
      detail: String(e && e.message),
    });
  }
}
