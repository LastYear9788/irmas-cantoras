# 🎤 Irmãs Cantoras

Duelo de karaokê online. Feito por um idiota para idiotas.

## Como jogar (3 passos)

1. **Uma pessoa** abre o site, coloca o nome e clica em **Criar sala** → clica em **Copiar convite** e manda o link pra amiga.
2. **A amiga** abre o link, coloca o nome e clica em **Entrar**.
3. A dona da sala **cola um link do YouTube**, as duas clicam em **Estou pronta!** e a dona clica em **Começar!**

Pronto. O app acha a letra sozinho, divide quem canta o quê e dá a nota no final.

### Dicas
- Use **Chrome** ou **Edge**.
- Use **fone de ouvido** (senão o microfone escuta a música e bagunça a nota).
- Quando o navegador perguntar, **permita o microfone**.
- Se a letra estiver adiantada ou atrasada, use os botões **− / +** embaixo da tela.
- Se não achar a letra, tenta outro link da mesma música (clipe oficial ou "áudio oficial" costumam funcionar melhor).

### Modos
- **Revezamento**: cada uma canta um pedaço; refrão é de todas.
- **Juntas**: todas cantam tudo ao mesmo tempo.

### Como é a nota (0 a 10.000)
- **Presença (40%)**: cantou na hora que era pra cantar.
- **Afinação (40%)**: voz afinada e firme.
- **Ritmo (20%)**: entrou na hora certa.

> A nota não compara com a voz do cantor original (não existe fonte grátis da melodia). Ela mede se você cantou na hora certa, afinada e firme.

## Por dentro (pra quem for mexer)
Site estático, sem build: HTML + CSS + JavaScript puro.
- `js/net.js`: salas via PeerJS (conexão direta entre os PCs; a dona da sala repassa as mensagens). Já suporta mais de 2 jogadoras.
- `js/youtube.js`: player do YouTube.
- `js/lyrics.js`: letra sincronizada. Tenta em ordem: [LRCLIB](https://lrclib.net), Deezer (bom pra música brasileira) e NetEase (bom pra internacional). Deezer e NetEase passam pelo intermediário público `cors.eu.org`. Sempre confere se o nome da música bate com o título do vídeo.
- `js/parts.js`: quem canta cada linha.
- `js/mic.js` / `js/score.js`: microfone, afinação e nota.
- `js/app.js`: telas e fluxo.

Rodar no PC: `python -m http.server 8000` nesta pasta e abrir `http://localhost:8000`.
Hospedagem: GitHub Pages (grátis).
