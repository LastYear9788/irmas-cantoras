# 🎤 Irmãs Cantoras

Duelo de karaokê online. Feito por um idiota para idiotas.

## Como jogar (3 passos)

1. **Uma pessoa** abre o site, coloca o nome e clica em **Criar sala** → clica em **Copiar código** e manda as 4 letras pra amiga.
2. **A amiga** abre o site, coloca o nome, clica em **Entrar na sala de uma amiga** e cola o código.
3. A dona da sala **cola um link do YouTube** e clica em **Adicionar**. A amiga também pode colar e clicar em **Sugerir**: a dona da sala aprova ou recusa. As aprovadas vão pra **Playlist**. As duas clicam em **Estou pronta!** e a dona da sala clica em **Começar!**

Pronto. O app acha a letra sozinho, divide quem canta o quê e dá a nota no final.

### Dicas
- Use **Chrome** ou **Edge**.
- Use **fone de ouvido** (senão o microfone escuta a música e bagunça a nota).
- Quando o navegador perguntar, **permita o microfone**.
- Se a letra estiver adiantada ou atrasada, use os botões **− / +** embaixo da tela.
- A letra é escolhida automaticamente. No lobby, a dona da sala pode abrir **Escolher versão da letra** para buscar alternativas, conferir as primeiras linhas ou importar um arquivo `.lrc`. A versão escolhida vale para toda a sala e fica salva neste navegador para aquele vídeo. Para voltar à busca do app, selecione **Automático** e confirme.

### Extras
- **Câmera (opcional):** ligue no lobby e o app tira umas fotos de você cantando pra mostrar no final. Nada fica salvo; cada uma pode apagar as próprias fotos.
- **🎧 Me ouvir:** durante a música, clique em "Me ouvir" pra escutar sua própria voz no fone (só com fone de ouvido, senão dá microfonia).
- **Sua gravação:** no final da rodada, clique em "Ouvir minha gravação" pra escutar sua voz junto com a música do começo ao fim. Dá pra guardar no PC também. Só você escuta.
- **Reações:** 👏😂🔥😍😱 durante a música.
- **Placar da noite:** conta as vitórias enquanto a sala estiver aberta.

### Modos
- **Revezamento**: cada uma canta um pedaço; refrão é de todas.
- **Juntas**: todas cantam tudo ao mesmo tempo.

### Como é a nota (0 a 10.000)
Cada linha da sua vez vale uma parte da nota:
- **💨 Fôlego**: quanto da linha você cantou. Respirar entre as sílabas e no fim da frase não tira ponto. Ele multiplica o resto: cantar metade da linha, mesmo perfeito, vale metade.
- **🎯 Afinação (43%)**: as notas certinhas, dentro do tom da música, e a melodia se mexendo. Vibrato não conta como erro, e música gravada fora do "lá 440" não prejudica quem canta junto.
- **🎙️ Timbre (27%)**: voz limpa e firme (vibrato pode; tremedeira não).
- **⏱️ Ritmo (30%)**: entrar na hora certa e cantar as sílabas da letra (só "aaaa" numa nota não vale). Fone bluetooth ganha uma tolerância a mais, porque ele atrasa o som.

Durante a música, cada linha que termina ganha uma avaliação (✨ Perfeito, 🔥 Ótimo, 👍 Bom…) com os pontos, e embaixo da letra aparece se a nota está contando ou o que está atrapalhando (microfone mudo, voz baixa, vídeo carregando…).

> A nota não compara com a voz do cantor original (não existe fonte grátis da melodia). Ela mede se você cantou a letra na hora certa, afinada e firme.

## Por dentro (pra quem for mexer)
Site estático, sem build: HTML + CSS + JavaScript puro.
- `js/net.js` + `js/peerjs.min.js` (PeerJS 1.5.4, MIT): salas via WebRTC (conexão direta entre os PCs; a dona da sala repassa as mensagens). Já suporta mais de 2 jogadoras.
- `js/youtube.js`: player do YouTube.
- `js/lyrics.js`: letra sincronizada. Tenta em ordem: [LRCLIB](https://lrclib.net), Deezer (bom pra música brasileira) e NetEase (bom pra internacional). Deezer e NetEase passam pelo nosso intermediário na Cloudflare (`proxy/worker.js`, plano grátis), com `cors.eu.org` e `allorigins` de reserva. Pra republicar o intermediário: `cd proxy && npx wrangler deploy`. Sempre confere se o nome da música bate com o título do vídeo.
- `js/parts.js`: quem canta cada linha.
- `js/mic.js` / `js/pitch.js` / `js/score.js`: microfone, detector de afinação e nota.
- `js/calibrate.js`: calibração e diagnóstico do microfone (ruído, cortes, conflito de apps).
- `js/cam.js`: câmera opcional e fotos da rodada.
- `js/theme.js` / `js/bubbles.js` / `js/liquid.js`: visual Novo (bolhas + vidro líquido), Clássico e Modo leve automático.
- `js/a11y.js`: foco e navegação por teclado nos modais.
- `tests/run.mjs`: testes automáticos da nota, detector, letras, partes e intermediário (`node tests/run.mjs`).
- `js/avatar.js` + `js/three.min.js` (three.js r128, MIT): bonequinha 3D de cada jogadora, montada com formas simples e sombreado de desenho. Provador no lobby ("🎀 Montar minha bonequinha"); canta junto seguindo volume, nota e vogal da letra. Fica mais simples no modo leve e desliga sozinha na música se o PC engasgar.
- `js/singlog.js`: relatório técnico da cantoria (salvo no IndexedDB; botão "📋 Baixar relatório" no resultado e na calibração).
  Pra ler um relatório: `node tools/analisar-relatorio.mjs arquivo.json`.
- `js/app.js`: telas e fluxo.

Rodar no PC: `python -m http.server 8000` nesta pasta e abrir `http://localhost:8000`.
Hospedagem: GitHub Pages (grátis).
