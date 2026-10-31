# Bard Player — Plano Final (Prisma, Planejador Sênior)

Plugin Obsidian `bard-player` (autor `is-cout`, `isDesktopOnly: true`). Player do YouTube Music via `<webview>` com partição persistente, view completa + mini (dock/popout/flutuante always-on-top), botões na barra de tarefas do Windows e Media Session (SMTC/teclas de mídia).

Níveis: **Júnior**, **Mid**, **Bigorna** (o mais alto).

---

## 1. Decisões de arquitetura (não negociáveis sem nova escalada)

1. **Uma webview, nunca movida no DOM.** Mover um `<webview>` (reparent ou trocar de janela) destrói e recria o guest, então o áudio reinicia. Por isso:
   - O `PlayerService` cria **uma** webview e a anexa uma única vez a um host fixo em `document.body` da **janela principal** (`position: fixed`).
   - A **view completa** não contém a webview. Ela só reserva um retângulo, e o host é *posicionado por cima* dele com `ResizeObserver` + `getBoundingClientRect` (overlay).
   - Com a view completa oculta ou fechada, o host fica fora da tela (`left:-10000px`, tamanho preservado). **Não usar `display:none`**, que quebra a renderização e às vezes a reprodução.
   - **Mini (dock/popout/flutuante) = controle remoto.** Usa uma UI própria (capa, título, artista, progresso, prev/play/next, volume) que lê o estado e envia comandos ao mesmo `PlayerService`. Nunca contém a webview.
   - Se a view completa for aberta numa janela popout, ela mostra a UI de controle remoto e um botão "abrir na janela principal". A webview não muda de janela.
2. **Não haverá arquivo preload.** O Obsidian só distribui `main.js`, `manifest.json` e `styles.css`. A ponte com o YTM é feita assim:
   - **Injeção:** `webview.executeJavaScript(INJECT_SRC)` em `dom-ready` (idempotente, guard `window.__bard`). A navegação do YTM é SPA e o script persiste; reinjetar em `did-navigate`.
   - **Estado (guest para host):** `console.debug("__BARD__" + JSON)`, capturado no evento `console-message` da webview. O envio tem *throttle* (≤ 4/s, mais o envio imediato em mudança de faixa ou estado).
   - **Comandos (host para guest):** `executeJavaScript("window.__bard.cmd(...)")`. Usa a API do `#movie_player` (`playVideo/pauseVideo/nextVideo/previousVideo/seekTo/setVolume/getPlayerState`), com clique nos botões de `ytmusic-player-bar` como fallback.
   - **Fonte do estado:** `navigator.mediaSession.metadata` (título/artista/álbum/artwork), eventos do `<video>` (play/pause/timeupdate/volumechange) e um seletor de "like" opcional.
3. **Acesso ao Electron:** `require("electron").remote`, o mesmo que o surfing-obsidian usa em produção (`remote.webContents.fromId`, `remote.session.fromPartition`). Isolar tudo em `src/electron/remote.ts`, com detecção de capacidade e sem exceções vazando.
4. **Webview:** `partition="persist:bard-player"`, `src="https://music.youtube.com"`, `webpreferences="backgroundThrottling=no"`, `allowpopups` controlado. O user-agent deve ser um Chrome limpo, sem `Electron/` e `obsidian/` (padrão `A0()` do surfing), aplicado em `session.fromPartition(...).setUserAgent`, senão o login do Google bloqueia ("navegador não seguro").
5. **Integração com o SO, em camadas e degradável:**
   - **Thumbar** (só Windows, `Platform.isWin` e capacidade detectada): `BrowserWindow.setThumbarButtons` na janela principal, com 3 botões (prev / play⇄pause / next). Os ícones são PNG gerados em runtime (canvas → `toDataURL` → `nativeImage.createFromDataURL`), brancos, 32px.
   - **Media Session:** preferir a sessão nativa do próprio YTM dentro do guest, porque o Chromium já leva ao SMTC e às teclas de mídia. Fallback (B-c): espelhar no renderer host (`navigator.mediaSession` + `<audio>` silencioso em loop para "possuir" a sessão), com action handlers que chamam o `PlayerService`.
   - Fora do Windows não há thumbar. A Media Session continua (MPRIS/macOS Now Playing) se funcionar.

### Diagrama
```
Plugin(main.ts)
 ├─ PlayerService (singleton, EventEmitter<PlayerState>)
 │    ├─ WebviewHost ── <webview persist:bard-player> (body da janela principal, overlay)
 │    └─ Bridge (inject.ts ⇄ console-message / executeJavaScript)
 ├─ ThumbarController ── remote.BrowserWindow (main)  ← state / → commands
 ├─ MediaSessionController (fallback espelho)
 ├─ FullPlayerView (reserva rect → WebviewHost.attachTo(rect))
 ├─ MiniPlayerView (dock/popout) ── MiniControls (UI remota)
 └─ FloatingWindow (popout leaf + setAlwaysOnTop)
```

---

## 2. Estrutura de arquivos
```
Bard Player/
  manifest.json  versions.json  package.json  tsconfig.json
  esbuild.config.mjs  eslint.config.mjs  styles.css  LICENSE  README.md  CONTRIBUTING.md
  scripts/copy-to-vault.mjs            (igual ao Trimly)
  .github/workflows/release.yml        (igual ao Trimly)
  docs/ ARCHITECTURE.md DEVELOPMENT.md CHANGELOG.md FAQ.md DEPENDENCIES.md PLAN.md
  spike/spike.ts                       (F0; entry esbuild separado: `npm run spike`)
  src/
    main.ts                 lifecycle, views, comandos, settings
    constants.ts            VIEW_TYPE_*, PARTITION, YTM_URL, MSG_PREFIX
    settings.ts             BardSettings + SettingTab
    electron/remote.ts      getRemote(), getMainBrowserWindow(), getBrowserWindowFor(win), caps
    player/protocol.ts      PlayerState, Command, parseMessage()
    player/inject.ts        export const INJECT_SRC (string)
    player/WebviewHost.ts   cria/posiciona webview, UA, eventos
    player/PlayerService.ts estado, comandos, assinaturas
    os/icons.ts             glyph → dataURL → nativeImage (cache)
    os/ThumbarController.ts
    os/MediaSessionController.ts
    views/FullPlayerView.ts
    views/MiniPlayerView.ts
    views/MiniControls.ts   componente compartilhado (mini + fallback popout)
    windows/FloatingWindow.ts
  test/ protocol.test.ts  state.test.ts  (node --test, como Trimly)
```

---

## 3. Fases e tarefas

Legenda: **[Nível]**, `arquivos`, ✅ critério de aceite. ‖ = pode rodar em paralelo.

### F0 — Spike de viabilidade (GO/NO-GO), bloqueia F3/F5. **Bigorna** (o risco é alto e o resultado decide a arquitetura)
Arquivo único `spike/spike.ts`, plugin mínimo carregado no vault de teste. Deve gerar um relatório em `docs/SPIKE.md` com a versão do Obsidian/Electron e o resultado de cada item.
- **F0.1** Expor `remote`: testar `require("electron").remote`, `remote.getCurrentWindow()`, `remote.BrowserWindow.getAllWindows()`, `window.electronWindow` (se existir) e o mapeamento de uma janela **popout** do Obsidian para o seu BrowserWindow (`BrowserWindow.fromWebContents` / match por foco logo após abrir). ✅ obter o BrowserWindow da janela principal e de um popout.
- **F0.2** Thumbar: `setThumbarButtons` com 3 botões (ícones de canvas), um clique que troca o ícone play⇄pause e recebe callback. Reaplicar em `show/restore/focus`. `setThumbarButtons([])` no unload. ✅ botões visíveis no hover da taskbar e cliques registrados. ✅ após minimizar/restaurar, eles continuam. ✅ após recarregar o plugin 3× não aparece "Attempting to call a function in a renderer window that has been closed" nem callbacks duplicados.
- **F0.3** SMTC/teclas: webview `persist:` com YTM tocando. Verificar (i) o flyout de mídia do Windows mostra título/artista/capa, (ii) as teclas Play/Next físicas funcionam, (iii) com a webview fora da tela continua funcionando. Se falhar, testar o fallback espelho no host. ✅ registrar qual camada funciona.
- **F0.4** Login: login Google na partição persistente com UA limpo. Reiniciar o Obsidian e confirmar que continua logado. ✅ login persiste.
- **F0.5** Overlay: mover o host fixo sobre o rect de um leaf e redimensionar o split sem recarregar o áudio. Testar fora da tela por 5 min (sem throttle). ✅ o áudio não interrompe.
- **F0.6** Always-on-top: `setAlwaysOnTop(true)` no BrowserWindow de um popout leaf. ✅ funciona.

**Gate:** F0.1 + F0.2 OK = GO. Se falhar, ir ao Plano B (§5) e **avisar o usuário antes de seguir**, porque a thumbar é eliminatória.

### F1 — Scaffold ‖ F0. **Júnior**
- **F1.1** Copiar o padrão do Trimly: `package.json` (scripts dev/build/test/lint/spike), `tsconfig.json`, `esbuild.config.mjs` (external `electron`, `obsidian`, `@codemirror/*`), `eslint.config.mjs` (eslint-plugin-obsidianmd), `scripts/copy-to-vault.mjs`. ✅ `npm run build` e `npm run lint` passam com o `main.ts` vazio.
- **F1.2** `manifest.json` (`id: bard-player`, `isDesktopOnly: true`, `minAppVersion` igual ao Trimly) e `versions.json`. ✅ o plugin carrega e descarrega sem erro.
- **F1.3** `.github/workflows/release.yml` e docs base (README, CONTRIBUTING, docs/*). README com aviso de "não afiliado ao YouTube" e de desktop-only. ✅ tag dispara o release com os 3 arquivos.

### F2 — Core do player (depois de F1, ‖ fim de F0). **Mid**, revisão Bigorna
- **F2.1 [Júnior]** `protocol.ts`: tipos `PlayerState {status, title, artist, album, artworkUrl, position, duration, volume, liked?, ts}`, `Command` e `parseMessage()` com validação. Testes. ✅ `npm test` verde, mensagens inválidas ignoradas.
- **F2.2 [Mid]** `inject.ts`: observer idempotente com throttle e emissão `__BARD__`. `window.__bard.cmd()` com API do `#movie_player` + fallback de clique. ✅ no console do guest, `__bard.cmd('next')` funciona e o estado é emitido ao trocar de faixa.
- **F2.3 [Mid]** `WebviewHost.ts`: cria a webview uma vez no body principal, UA na sessão, `attachTo(el)` / `detach()` via overlay (ResizeObserver, scroll, resize, mudança de layout `workspace.on('layout-change')`), fora da tela quando solto. ✅ abrir/fechar/mover a view não recarrega o guest (verificar pelo `webContentsId` e pelo áudio contínuo).
- **F2.4 [Mid]** `PlayerService.ts`: singleton com `state`, `subscribe()`, `send(cmd)`, fila de comandos antes do `dom-ready`, reinjeção em navegação e `destroy()` no unload (remove a webview e os listeners). ✅ o estado chega ao host em ≤ 300 ms. ✅ unload não deixa áudio tocando nem listeners.
- **F2.5 [Júnior]** `electron/remote.ts` a partir do resultado de F0.1 (try/catch, `caps = {remote, thumbar, alwaysOnTop}`). ✅ fora do Windows, `caps.thumbar === false` sem exceção.

### F3 — Integração SO (depois de F0 GO + F2). **Mid**, F3.2 com revisão Bigorna
- **F3.1 [Júnior]** `os/icons.ts`: glyphs prev/play/pause/next em canvas → dataURL → nativeImage, com cache. ✅ ícones nítidos em 100% e 150% DPI.
- **F3.2 [Mid]** `ThumbarController`: assina o estado, troca play⇄pause e desabilita prev/next sem faixa. Reaplica em `show/restore/focus` e no `layout-change` da janela principal. Limpa no unload. Só roda com `caps.thumbar`. ✅ critérios do F0.2 em produção. ✅ os 3 botões funcionam com a view completa fechada (só mini) e com o Obsidian minimizado.
- **F3.3 [Mid]** `MediaSessionController`: modo "nativo" (não faz nada além de garantir guest ativo) ou "espelho" (conforme F0.3), escolhido em settings `auto | native | mirror`. ✅ o flyout do Windows mostra título/artista/capa corretos e as teclas de mídia funcionam com o Obsidian sem foco.

### F4 — View completa ‖ F5 (depois de F2). **Mid**
- **F4.1** `FullPlayerView` (ItemView): reserva o rect e chama `attachTo`/`detach` em `onOpen`, `onClose`, `onResize` e visibilidade da aba. Se estiver num popout, renderiza `MiniControls` + botão "mover para janela principal". ✅ alternar abas, splits e redimensionar não interrompe o áudio. ✅ a webview nunca aparece "vazando" sobre outra view (z-index e clipping ao rect do leaf).
- **F4.2 [Júnior]** Comandos de paleta: abrir player, play/pause, next, prev, abrir mini, alternar flutuante. Ícone no ribbon. ✅ comandos funcionam e aceitam hotkeys.

### F5 — Mini / popout / flutuante ‖ F4 (depois de F2; flutuante depois de F0.6). **Mid**, F5.3 **Bigorna**
- **F5.1 [Mid]** `MiniControls`: UI remota (capa, título, artista, barra de progresso clicável com seek, prev/play/next, volume, like opcional). Interpolação local do progresso entre mensagens. ✅ ação na mini reflete na view completa em ≤ 300 ms e vice-versa.
- **F5.2 [Júnior]** `MiniPlayerView` (ItemView) dockável em sidebar ou em qualquer leaf. ✅ funciona em sidebar esquerda/direita e em popout.
- **F5.3 [Bigorna]** `FloatingWindow`: abre a mini em popout leaf (`workspace.openPopoutLeaf({size})`), resolve o BrowserWindow (F0.1), `setAlwaysOnTop(true,'floating')` e tamanho compacto. Lembra posição/tamanho. Fecha limpo e lida com várias janelas (só um flutuante). ✅ fica por cima de outros apps. ✅ fechar o flutuante não para o áudio. ✅ fechar a janela principal encerra tudo sem erro.

### F6 — Settings, polish, docs (depois de F3–F5). **Júnior**, revisão Mid
- **F6.1** Settings: thumbar on/off, modo Media Session, abrir view no startup, retomar última posição/volume, always-on-top padrão, botão "limpar sessão (logout)" (`session.clearStorageData`). ✅ cada opção tem efeito imediato.
- **F6.2** Estados de erro: offline, não logado, YTM mudou o DOM (estado vazio por mais de 10 s mostra um aviso). ✅ nenhuma exceção não tratada no console.
- **F6.3** Docs: ARCHITECTURE (decisões do §1), FAQ (login, Windows-only thumbar), CHANGELOG e DEPENDENCIES. ✅ docs revisadas.
- **F6.4 [Mid]** Checklist manual de QA (§4) executada no Windows 11. ✅ tudo verde.

### Ordem / paralelismo
```
F0 (Bigorna) ─────────────┐ gate GO
F1 (Júnior) → F2 (Mid) ───┴→ F3 (Mid)
                    └→ F4 (Mid) ‖ F5 (Mid/Bigorna) → F6 (Júnior)
```
F2.1 e F2.5 (Júnior) rodam em paralelo com F2.2–F2.4. F3.1 pode começar logo após F1.

---

## 4. Critérios de aceite globais (QA final)
1. Login persiste após reiniciar o Obsidian.
2. O áudio nunca reinicia ao abrir/fechar/mover/redimensionar a view completa, abrir a mini, abrir/fechar o flutuante ou trocar de workspace layout.
3. Thumbar com prev/play⇄pause/next funcionando com o Obsidian minimizado, depois de restaurar e com só a mini aberta.
4. Flyout de mídia do Windows com título/artista/capa e teclas físicas funcionando com o Obsidian sem foco.
5. Disable/enable do plugin 3× sem botões órfãos, sem áudio fantasma, sem erros de remote e sem listeners duplicados.
6. No macOS/Linux, o plugin carrega e toca, sem thumbar e sem erro.
7. `npm run build`, `lint` e `test` verdes. O release contém só os 3 arquivos.

---

## 5. Riscos e Plano B

| Risco | Prob. | Mitigação / Plano B |
|---|---|---|
| **(a) `remote` indisponível** numa versão futura do Obsidian | Baixa hoje (o surfing usa) | B-a1: `window.electronWindow` / APIs internas do Obsidian. B-a2: **sem thumbar**, só Media Session (o flyout SMTC tem prev/play/next). Como isso **viola o requisito eliminatório**, exige `maestri notify` ao usuário e uma decisão GO/NO-GO. B-a3 (helper nativo/Electron separado) é **desaconselhado**: não passa na loja da comunidade, que distribui só 3 arquivos, e precisaria de instalador. Só vale para uso pessoal via BRAT. |
| **(b) Callbacks da thumbar** quebram após recarregar o plugin (remote callbacks) | Média | Limpar no `onunload`, um único handler estável que despacha via `PlayerService` e uma guarda por "geração" do plugin. |
| Thumbar some após minimizar ou reiniciar o Explorer | Média | Reaplicar em `show/restore/focus`. Reaplicar é idempotente. |
| **(c) SMTC não pega o áudio do guest** ou mostra "Obsidian" sem metadados | Média | Fallback espelho no host (`navigator.mediaSession` + `<audio>` silencioso). Último recurso: `remote.globalShortcut` para `MediaPlayPause/NextTrack/PreviousTrack`, que dá as teclas mas não o flyout. |
| Login Google bloqueado na webview | Média | UA de Chrome limpo. Fallback: janela `remote.BrowserWindow` de login com a mesma `partition`. |
| Reparent recarrega a webview | **Certa se fizer** | Proibido por design (§1.1), com overlay + mini remota. |
| Throttling com a webview fora da tela | Baixa | `backgroundThrottling=no`, fora da tela em vez de `display:none`. Validado em F0.5. |
| YTM muda o DOM ou a API do player | Média (ao longo do tempo) | Metadados via `mediaSession` (estável), API do `#movie_player`, fallback de clique, seletores centralizados em `inject.ts` e aviso em F6.2. |
| Conflito com outro plugin que também usa thumbar | Baixa | Setting para desligar. Documentar no FAQ. |
| ToS/loja da comunidade | Média | README com aviso de "não afiliado". Sem bloqueio de anúncios nem download. Se a loja recusar, distribuir via BRAT. |
