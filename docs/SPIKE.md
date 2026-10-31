# Bard Player — F0 Spike (GO/NO-GO)

**Resultado: GO.** O gate (F0.1 + F0.2) passou no Obsidian desktop real. F0.3, F0.5 e F0.6 também passaram. F0.4 está OK no mecanismo (partição persistente, UA limpo, página de login do Google aceita o navegador), mas o login com uma conta Google real ainda precisa do usuário (veja F0.4).

Data: 2026-10-31. Executado por Bigorna.

## Ambiente

| Item | Valor |
|---|---|
| SO | Windows 11 Pro 10.0.26200 |
| Obsidian | 1.14.5 (app package `obsidian-1.14.5.asar`; instalador 1.6.3) |
| Electron / Chrome / Node | 28.3.3 / 120.0.6099.291 / 18.18.2 |
| `require("electron").remote` | disponível (`@electron/remote`: `getCurrentWindow`, `BrowserWindow`, `session`, `nativeImage`, `webContents`...) |

**Isolamento:** o teste rodou numa instância separada do Obsidian (`--user-data-dir` próprio + `--remote-debugging-port`), com um vault de teste descartável que só tinha o plugin `bard-player-spike`. O Obsidian e o vault do usuário não foram tocados.

**Como foi dirigido:** `spike/spike.ts` vira um plugin descartável (`spike/manifest.json`, id `bard-player-spike`) e expõe `window.bardSpike`. Um harness externo chamou essas funções via Chrome DevTools Protocol. As ações do SO foram feitas com o mesmo caminho que o usuário dispara:
- **clique na thumbar:** `PostMessage(hwnd, WM_COMMAND, MAKEWPARAM(40001+i, THBN_CLICKED))`. É a mensagem que o shell envia ao clicar. Atenção: no Electron 28 os ids dos botões começam em **40001** (`kButtonIdBase`), não em 0.
- **teclas de mídia:** `keybd_event(VK_MEDIA_PLAY_PAUSE / NEXT / PREV)`, injetadas na fila de input do SO, como uma tecla física.
- **flyout SMTC:** API WinRT `GlobalSystemMediaTransportControlsSessionManager` (leitura dos metadados e `TryPlay/TrySkipNext`, os mesmos botões do flyout).
- **topmost:** `GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST`.

Para rodar à mão: build com `esbuild spike/spike.ts --bundle --format=cjs --external:obsidian --external:electron --outfile=<vault>/.obsidian/plugins/bard-player-spike/main.js`, copie `spike/manifest.json` e use os comandos "Bard Player Spike: ...". O comando "Run F0.1/F0.2 self-test" grava `bard-spike-report.json` no vault.

---

## Resultados por item

### F0.1 — `remote` e BrowserWindow (principal + popout): ✅ OK
- `require("electron").remote` existe. `remote.getCurrentWindow()` devolve a janela principal (id 1, HWND válido, título confere).
- O código do plugin roda **só no renderer principal**. Num popout, `getCurrentWindow()` continua devolvendo a principal. Para chegar ao BrowserWindow do popout, três estratégias foram testadas e todas concordaram (id 3):
  1. **`popoutDoc.defaultView.electronWindow`**: o Obsidian expõe em cada janela (principal e popouts) um proxy remoto do seu BrowserWindow (`window.electronWindow.id === 1`, `popout.electronWindow.id === 3`). É o caminho mais direto, mas é API interna e sem documentação.
  2. **Token de título:** gravar um título único em `doc.title` e procurar em `BrowserWindow.getAllWindows()` por `getTitle()`. Usa só a API pública do Electron. Obs.: a principal e o popout têm **o mesmo título** por padrão, então casar pelo título original seria ambíguo. O token é obrigatório.
  3. `BrowserWindow.getFocusedWindow()` logo após `openPopoutLeaf`, ou o id novo em `getAllWindows()` (frágil, depende do foco).
- **Recomendação para `electron/remote.ts` (F2.5):** usar `win.electronWindow` com o token de título como fallback e validar que `typeof bw.setAlwaysOnTop === "function"`.

### F0.2 — Thumbar: ✅ OK
- `setThumbarButtons` com 3 botões (prev / play⇄pause / next, ícones brancos 32px desenhados em canvas → `toDataURL` → `nativeImage.createFromDataURL`) retorna `true`.
- **Cliques:** prev, toggle e next chegam como callbacks no renderer. O toggle troca o ícone play⇄pause (reaplica com `reason: "state"`) e manda o comando ao player. Com música tocando, a thumbar segue o estado real do guest (`isPlaying` acompanha `paused`).
- **Minimizar/restaurar:** a janela minimizou e restaurou, a reaplicação disparou (3 reaplicações via `restore`/`show`/`focus`) e um clique depois disso foi registrado normalmente.
- **Reload do plugin 3×** (disable/enable): a contagem de listeners do BrowserWindow ficou estável. Base do Obsidian sem o plugin: `show/restore/focus = 1/1/3`. Com o plugin: `2/2/4`. Depois de 3 ciclos: `2/2/4`, sem vazamento. Após os reloads, 4 cliques geraram **exatamente 4 callbacks**, todos da geração atual (gen 4), com **0 stale** e **0** mensagens "Attempting to call a function in a renderer window that has been closed" no stderr do processo main.
- **Achado importante (Ctrl+R / "Reload app"):** num reload do renderer o Obsidian **não chama `onunload`**. Sem proteção, os botões da thumbar continuam no SO com callbacks mortos, e cada clique gera no processo main:
  `Attempting to call a function in a renderer window that has been closed or released. Function provided here: _ThumbarSpike.apply (plugin:bard-player-spike:152:16)` (reproduzido).
  **Mitigação validada:** um listener `window.addEventListener("beforeunload", () => win.setThumbarButtons([]))`. Com ele, o mesmo cenário gerou 0 avisos. **O F3.2 deve incluir isso** (e removê-lo no `onunload`).
- ⚠️ **Visibilidade no hover:** não deu para capturar por screenshot, porque o preview de miniatura não abre com hover sintético. A evidência é programática: `setThumbarButtons` retornou `true` e os cliques entram pelo mesmo `WM_COMMAND/THBN_CLICKED` do shell. **Confirmação visual pendente com o usuário (10 s):** passar o mouse no ícone do Obsidian na taskbar.

### F0.3 — SMTC / teclas de mídia com webview fora da tela: ✅ OK (camada **nativa** do guest)
Condições: webview `persist:bard-player` em host `position:fixed; left:-10000px` (sem `display:none`), YTM sem login.
- **(i) Flyout:** o Windows lista uma sessão `md.obsidian` como **current**, com `Title="Never Gonna Give You Up"`, `Artist="Rick Astley"`, thumbnail presente, `PlaybackStatus=Playing` e Next/Prev/Pause habilitados. Os metadados vêm direto da `navigator.mediaSession` do YTM.
- **(ii) Teclas:** Play/Pause pausou, Next trocou para "Take Me to Your Heart", Prev voltou para "Never Gonna Give You Up". Tudo com a webview fora da tela e o Obsidian sem foco.
- **Flyout como controle:** `TryPlayAsync` retomou e `TrySkipNextAsync` avançou a faixa.
- **(iii) Fora da tela:** todos os testes acima rodaram com o host fora da tela.
- ⚠️ **Comportamento do Windows a documentar no FAQ:** quando o Bard **pausa**, o Windows pode passar a "sessão atual" para outro app que tenha uma sessão de mídia (no teste, um vídeo pausado em outro app). A próxima tecla Play/Pause vai para esse app e não retoma o Bard. O flyout e a thumbar retomam normalmente. Isso é política do SMTC, não falha do plugin. O fallback espelho (B-c) **não** resolve isso e não foi necessário.
- O fallback espelho (`MirrorSessionSpike`: `<audio>` silencioso + `navigator.mediaSession` no host) ficou implementado no spike (comando "Toggle mirror Media Session") mas **não foi necessário**. Recomendação para o F3.3: o modo `auto` deve resolver para `native`.

### F0.4 — Login persistente: 🟡 mecanismo OK, falta o login real do usuário
- A partição `persist:bard-player` é criada em disco (`<userData>/Partitions/bard-player/` com Cookies, Local Storage, IndexedDB...).
- O UA da sessão fica limpo: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36` (sem `Electron/` e sem `obsidian/`).
- `accounts.google.com/v3/signin/identifier` carrega na partição **sem** a mensagem "este navegador ou app pode não ser seguro".
- PERSIST_PLACEHOLDER
- ⚠️ **Riscos que ficam para o login real:** (a) `navigator.userAgentData.brands = ["Not_A Brand", "Chromium"]`. Os client hints não dizem "Google Chrome" e `setUserAgent` não muda isso. (b) Chrome 120 é antigo e o Google pode vir a recusá-lo. Se o login falhar, o Plano B do §5 continua valendo: uma janela `remote.BrowserWindow` de login na mesma partição, que permite definir `userAgentMetadata` via `webContents.setUserAgent`/CDP `Emulation.setUserAgentOverride`.
- **Pendente (usuário, ~2 min):** entrar com a conta Google na view, reiniciar o Obsidian e confirmar que continua logado. Não fiz login por você (credenciais).

### F0.5 — Overlay sem recarregar / sem throttle: ✅ OK
OVERLAY_PLACEHOLDER

### F0.6 — Always-on-top em popout: ✅ OK
- `workspace.openPopoutLeaf({size:{380×240}})` → BrowserWindow resolvido (id 3) → `setAlwaysOnTop(true, "floating")`. `isAlwaysOnTop() === true` e o HWND nativo tem `WS_EX_TOPMOST = True`. A janela principal tem `False`.
- Ao fechar o popout, o áudio continuou (posição 170,8 s → 173,7 s, `paused=false`) e só a janela 1 sobrou.

---

## Gate

| Item | Status |
|---|---|
| F0.1 remote + BrowserWindow principal/popout | ✅ |
| F0.2 thumbar + cliques + reload 3× | ✅ (+ mitigação obrigatória para Ctrl+R) |
| F0.3 SMTC/teclas com webview fora da tela | ✅ nativo |
| F0.4 login persiste | 🟡 mecanismo OK; login real pendente do usuário |
| F0.5 overlay sem recarregar / sem throttle | ✅ |
| F0.6 alwaysOnTop em popout | ✅ |

**GO.** Não é preciso Plano B para thumbar nem para Media Session.

## Recomendações para as próximas fases
1. **F2.5 `electron/remote.ts`:** `getBrowserWindowFor(win)` = `win.electronWindow` → fallback token de título. `getMainBrowserWindow()` = `remote.getCurrentWindow()`.
2. **F3.2 Thumbar:** um dispatcher estável + guarda de geração (funcionou). Reaplicar em `show/restore/focus` (funcionou). **Adicionar `beforeunload` → `setThumbarButtons([])`** (o Ctrl+R não chama `onunload`). Ids nativos 40001+ servem para testes automatizados.
3. **F3.3 Media Session:** `auto` = `native`. Documentar no FAQ a troca de "sessão atual" do Windows ao pausar.
4. **F4.1 Overlay:** só `ResizeObserver` não basta. Quando a janela principal está ocluída ou minimizada (`document.visibilityState = "hidden"`), o Chromium não entrega callbacks de RO/rAF. E aba inativa = `display:none` no leaf (rect 0). Reposicionar **de forma síncrona** em `active-leaf-change` e `layout-change` (via `getBoundingClientRect`, que funciona mesmo oculto), além do RO. Também não usar `getLeaf("tab")` para criar a view do player esperando uma aba nova: ele **reaproveita** uma aba vazia ativa.
5. **F2.4:** `webview.capturePage()` trava com o host fora da tela (sem frames). Não depender dele.
6. **F0.3/F2.2:** sem login, o YTM toca anúncios antes da faixa (eles aparecem na `mediaSession` como "título | anunciante"). O estado do plugin deve tolerar isso.
