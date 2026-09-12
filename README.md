# Kick Clip Editor

Editor de clipes da Kick para formato vertical 9:16, rodando no navegador
(React + Tailwind), com um backend leve (funções serverless na Vercel) que
resolve o link do clipe automaticamente.

## Rodando localmente

```bash
npm install
npm run dev
```

O backend (`/api`) só funciona quando publicado na Vercel (`vercel dev` se
quiser testar localmente com as funções ativas).

## Como o link é resolvido

1. `/api/resolve-clip` abre a página do clipe num Chrome headless
   (`puppeteer-core` + `@sparticuz/chromium`) e escuta as requisições de
   rede até achar o arquivo de vídeo (`.mp4` ou `.m3u8`) que o próprio
   player carrega — o mesmo que qualquer visitante recebe, sem login.
2. `/api/proxy-video` repassa os bytes do vídeo pelo nosso domínio,
   evitando bloqueio de CORS e permitindo avançar/voltar no vídeo.
3. `/api/proxy-manifest` faz o mesmo para streams HLS (`.m3u8`), reescrevendo
   o manifesto para que os pedaços (`.ts`) também passem pelo proxy.

## Limitações conhecidas

- **É pesado.** Abrir um Chrome inteiro numa função serverless tem custo de
  tempo, memória e tamanho de pacote. Ajustes em `vercel.json` (memória,
  `maxDuration`) podem ser necessários dependendo do plano da Vercel — o
  plano gratuito (Hobby) pode não suportar o suficiente para clipes mais
  longos ou em rede lenta.
- **Frágil por natureza.** Não existe uma API pública e estável da Kick para
  isso. Se a Kick mudar a estrutura da página ou do player, a detecção do
  arquivo de vídeo em `api/resolve-clip.js` pode parar de encontrar a URL —
  os comentários marcados com "AJUSTE" nesse arquivo indicam os pontos mais
  prováveis de precisar de ajuste.
- Se um clipe específico não carregar, o botão "Selecionar um arquivo de
  vídeo manualmente" na tela inicial continua disponível como alternativa.

## Build de produção

```bash
npm run build
npm run preview
```

## Observações

- A exportação grava o resultado no navegador (WebM). Um backend com
  FFmpeg seria o próximo passo para converter automaticamente para MP4
  (H.264/AAC).
- Nenhuma marca d'água é adicionada ao vídeo em nenhuma etapa.
