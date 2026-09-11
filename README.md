# Kick Clip Editor

Editor de clipes da Kick para formato vertical 9:16, rodando 100% no navegador
(React + Tailwind). Permite posicionar câmera e gameplay manualmente, aplicar
layouts (tela cheia / empilhado / livre), cortar o vídeo e exportar.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente `http://localhost:5173`).

## Build de produção

```bash
npm run build
npm run preview
```

## Observações

- Esta versão é um protótipo de frontend: como não há um backend por trás,
  o carregamento automático de um clipe pelo link da Kick nem sempre
  funciona (a página do clipe é HTML, não o arquivo de vídeo em si). Há uma
  opção manual de selecionar um arquivo de vídeo local para testar o editor.
- A exportação grava o resultado no navegador (WebM). Um backend com
  Node.js + FFmpeg seria o próximo passo para converter automaticamente
  para MP4 
