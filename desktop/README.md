# Interface RestoreWin

Electron + React + TypeScript, com interface em português. A configuração funciona; a proteção física ainda não está implementada em nenhuma plataforma. Os pacotes são identificados como `RestoreWin-Interface`.

Na versão 0.2.0, o primeiro acesso exige cadastro de administrador. A janela é bloqueada ao fechar e o processo permanece na bandeja. Consulte [contas e bandeja](../docs/contas-e-bandeja.md) para permissões, senhas, inicialização no login Windows e limites de segurança. Não existe usuário/senha padrão.

## Desenvolvimento

```sh
npm ci
npm run install:runtime
npm run build
npm start
```

As versões estão fixadas no lockfile. A validação usou Node.js 24.19.0. O comando oficial `node node_modules/electron/install.js` instala o runtime e verifica os checksums distribuídos no pacote npm. Não desativar checksum, assinatura ou TLS.

Na máquina de nuvem foram utilizados os seguintes caminhos graváveis:

```sh
export npm_config_cache=/workspace/.cache/npm
export electron_config_cache=/workspace/.cache/electron
export ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder
export XDG_CACHE_HOME=/workspace/.cache
export NODE_USE_ENV_PROXY=1
```

`NODE_USE_ENV_PROXY` permite que o downloader oficial respeite o proxy com Node.js 24, mantendo TLS. `RESTOREWIN_STATE_DIR`, quando definido com caminho absoluto, separa a configuração dos testes. No uso normal, o diretório de dados padrão do Electron é utilizado.

## Testes

```sh
npm test
npm run build
npm run test:ui
```

Os 26 testes Node verificam caminhos Windows/Linux, unidades, persistência, revisões concorrentes, arquivos inválidos, recusa de ativação e dez cenários de autenticação e autorização.

Os oito testes Electron iniciam a aplicação compilada e usam IPC real. O seletor nativo é substituído no processo de teste por uma pasta temporária. O tempo de inatividade do host é fixado somente no teste, e os eventos de bloqueio/suspensão são simulados sem suspender o runner. Os testes verificam os fluxos do perfil, criação do administrador, operadores, troca de senhas e acesso bloqueado. O fechamento oculta uma janela real, preserva seu processo e uma segunda instância real reabre a janela original.

No contêiner, os testes usaram Xvfb com `DISPLAY=:93`. O runner Electron do Playwright adiciona `--no-sandbox` à sua instância de teste. Essa opção não foi adicionada ao aplicativo nem ao comando de produção. A janela de produção mantém sandbox, isolamento de contexto, Node desativado no renderer e CSP. A execução empacotada com sandbox precisa ser validada em cada distribuição. Não desativar a sandbox do produto para contornar requisitos de instalação.

Screenshot: `../artifacts/restorewin-desktop.png`. Resultados e traces: `test-results/`. Esses testes não reiniciam ou modificam volumes do sistema.

## Pacotes

```sh
npm run package:linux
npm run package:windows
```

Para reutilizar no Linux o runtime já verificado e reduzir o custo de compressão de um pacote de desenvolvimento:

```sh
ELECTRON_BUILDER_COMPRESSION_LEVEL=1 npx electron-builder --linux deb tar.gz \
  --x64 --publish never --config.electronDist=node_modules/electron/dist \
  --config.deb.compression=gz
```

`--publish never` impede publicação. Resultados ficam em `release/`. O NSIS é um instalador assistido com escolha da pasta/unidade. O pacote portátil Linux permite escolher o local de extração; o `.deb` usa o destino definido pelo pacote. Nenhum pacote instala congelamento. Um build Windows não equivale a execução testada no Windows e não recebe assinatura de produção sem uma configuração legítima de assinatura.

O workflow GitHub Actions gera o ZIP e o instalador NSIS em um runner Windows, e os pacotes Linux em Ubuntu. No ZIP, extraia **todos** os arquivos na pasta/unidade escolhida e execute `RestoreWin.exe`. Não mova somente o EXE, pois ele depende dos demais arquivos. No contêiner Linux de desenvolvimento, uma tentativa anterior de cross-build NSIS não concluiu porque o helper Wine não inicializou; a publicação usa Windows nativo para essa etapa.

O empacotamento portátil foi executado com o comando abaixo, preservando o download e a verificação normais do Electron:

```sh
npx electron-builder --win zip --x64 --publish never \
  --config.electronDownload.cache=/workspace/.cache/electron \
  --config.win.artifactName=RestoreWin-Interface-0.2.0-win-x64.zip
```

A consulta de acesso a volumes no Windows mantém estado desconhecido quando não consegue confirmar leitura/gravação. O aplicativo não declara esses volumes graváveis por padrão e impede selecioná-los enquanto o diagnóstico permanecer desconhecido. A execução nativa dessa consulta ainda requer validação em Windows.

## Limites da ponte desktop

- O renderer não possui Node.js nem acesso a comandos do sistema.
- A ponte expõe autenticação, usuários, bandeja/inicialização, diagnóstico, salvar perfil, escolher pasta e uma ação de proteção tipada. As operações são autorizadas no processo principal antes de acessar os serviços.
- O processo principal valida os dados antes de persistir.
- `freeze` e `thaw` retornam `BACKEND_UNAVAILABLE`; não há alteração visual fictícia para Congelado.
- A configuração não possui campo que possa declarar a máquina congelada.
- O estado real e as transições pendentes deverão vir de um futuro componente privilegiado verificado.

No navegador, há um aviso de prévia, discos de exemplo e configuração no `localStorage`. Esse modo também mantém os controles de proteção indisponíveis.
