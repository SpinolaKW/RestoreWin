# Validação executada

## Núcleo v2: prioridade Windows Home/Pro

`make test` passou com 27 grupos C (14 v1 preservados, 13 v2 novos), AddressSanitizer/UndefinedBehaviorSanitizer e nove testes Python. A compilação freestanding com `-fno-builtin` passou e `nm -u` não listou símbolos externos. O [formato v2](formato-overlay-v2.md) documenta o modelo de falhas e os milhares de cortes de gravação exercitados. Não foram executados testes de boot ou hardware físico.

O [workflow do núcleo](https://github.com/SpinolaKW/RestoreWin/actions/workflows/core.yml) exige esses testes no Linux e compilação MSVC com AddressSanitizer, 25 grupos em memória e análise estática no Windows. Os dois testes de arquivo POSIX ficam explicitamente excluídos do alvo Windows. Consulte a execução correspondente para confirmar o resultado remoto; um teste C em modo usuário no Windows Server não valida WDK, driver, Windows Home/Pro ou congelamento físico.

## Versão 0.2.1: diagnóstico de armazenamento

O conjunto atual tem 14 casos C, 9 Python, 28 Node e 9 Electron (60 distintos). Os novos casos reproduzem erro de leitura antes do cadastro, verificam código/caminho no IPC e na tela, preservação do administrador e revogação da sessão após falha de leitura. Uma causa específica no computador do usuário não foi confirmada só pela captura de tela.

Além de cinco fluxos Electron em Windows, o workflow exige um teste do executável Windows empacotado em um runner descartável, sem `RESTOREWIN_STATE_DIR`, para verificar o primeiro cadastro no diretório padrão de dados e o bloqueio ao fechar. O teste não altera o registro de inicialização automática nem reproduz políticas/permissões da estação afetada. Os conjuntos das versões anteriores abaixo são históricos.

## Versão 0.2.0: contas e bandeja

O conjunto atual tem 14 casos C, 9 Python, 26 Node e 8 Electron (57 distintos). Os testes de contas verificam primeira inicialização única, persistência sem sessão persistida, hashes/salts, privilégios do administrador, proteção da conta principal, alteração de senha, exclusão de operadores, limite persistente de tentativas e bloqueio concorrente com login. Os testes da interface verificam autorização via IPC, cadastro/login, gerenciamento de usuários, troca da senha principal e novo login.

O fluxo de segundo plano fecha uma janela Electron real, verifica que ela ficou oculta e que o processo permanece vivo, lança uma segunda instância pelo executável e verifica a reabertura do mesmo processo com login exigido. A inatividade do host é substituída no processo de teste porque os runners podem ficar sem entrada do sistema operacional; os eventos de bloqueio de tela e suspensão são emitidos em teste. Não há suspensão real, verificação manual da bandeja Windows ou execução de registro de inicialização automática nesta validação local.

O workflow da versão 0.2.0 exige os 26 testes Node em Windows e Linux, oito fluxos Electron em Linux e quatro fluxos de autenticação/segundo plano em Windows antes de publicar. Consulte o resultado da execução da tag para verificar a validação remota. Os resultados abaixo relativos à versão 0.1.0 são históricos. Nenhum desses conjuntos valida boot ou congelamento físico.

Ambiente: Linux x64, GCC 14.2.0 e Python 3.12.14. Não há Windows/WDK nem testes de boot neste resultado.

## Núcleo em imagens

Comando: `make test`.

- 14 testes do núcleo passaram, compilados com `-Wall -Wextra -Werror -Wconversion -Wshadow -pedantic` e AddressSanitizer/UndefinedBehaviorSanitizer.
- Nenhum diagnóstico dos sanitizers foi emitido nessa execução.
- 9 testes do verificador PE passaram.
- Não há testes ignorados nesse conjunto. O teste de arquivos cria, sincroniza, fecha e reabre um overlay temporário no Linux.
- As simulações cobrem resultados específicos de falha e persistência; não reproduzem todas as possibilidades de um dispositivo físico.

Comando adicional:

```sh
cc -std=c11 -ffreestanding -fno-builtin -Wall -Wextra -Werror \
  -c core/restorewin.c -o artifacts/restorewin_core.o
nm -u artifacts/restorewin_core.o
```

A compilação passou e `nm -u` não listou símbolos externos indefinidos. Isso verifica a ausência de dependências externas nesse objeto Linux; não comprova ABI, compatibilidade com WDK ou funcionamento em modo kernel no Windows.

## Reprodutibilidade do achado nos drivers antigos

O verificador deste repositório foi executado nos sete `.sys` de `Drivers/win10/x64` do pacote recebido, armazenado fora do checkout. Retornou 1, resultado esperado para achados bloqueantes, e identificou `writable_executable_section` nos sete arquivos. Todos os resultados mantêm `windows_compatibility: unverified`.

Os binários originais não são fixtures distribuídas. O arquivo de resultados está em `/workspace/analysis/reboot-restore-rx/reproducible-driver-check.json` na instância atual.

## Interface desktop adicionada

A interface Electron/React/TypeScript foi compilada e executada no Debian 13 x64 desta máquina. `make test-all` passou: 14 testes C, 9 Python e 16 Node. `npm run build` passou, incluindo verificação de tipos. `npm run test:ui` passou com quatro testes Electron. Total: 43 testes, sem falhas ou skips nos conjuntos finais.

Os fluxos Electron usam IPC real e verificam unidades consultadas no ambiente, persistência de nome e pasta após fechar/reabrir, seleção de pasta temporária por substituição do diálogo no processo de teste, descarte de rascunhos, remoção de seleção desconectada e recusa explícita de congelamento. A imagem da janela fica em `artifacts/restorewin-desktop.png`.

O runner Playwright executa sua instância Electron com `--no-sandbox`; essa opção não foi incluída no aplicativo ou no comando de produção. Os testes usaram Xvfb. Não houve instalação em uma sessão gráfica completa de Ubuntu/Debian. A consulta nativa de volumes Windows foi implementada, mas não executada num Windows.

Os pacotes gerados são da interface e não fornecem proteção. O `.deb` foi inspecionado como arquivo, sem instalação no sistema. O pacote portátil Linux foi examinado para conferir a presença do runtime e `app.asar`, iniciado pelo runner Electron e verificado por IPC: versão 0.1.0, proteção indisponível e recusa de congelamento. O resultado está em `artifacts/smoke-pacote-linux.json`; a mesma limitação de sandbox do runner se aplica.

O ZIP Windows foi conferido como arquivo, incluindo integridade ZIP, runtime AMD64 e ausência de drivers `.sys`. O executável principal não tem certificado Authenticode embutido. Não foi executado no Windows. A geração do instalador NSIS não foi concluída porque o helper Wine não inicializou neste contêiner; a saída incompleta foi separada dos pacotes utilizáveis. O estado final, tamanhos e hashes SHA256 estão em `artifacts/pacotes-interface.json`.

## Não validado e não fornecido como proteção

- Driver Windows, INF, instalador ou serviço de proteção.
- Recuperação automática de registros interrompidos integrada ao boot. A v2 oferece somente recuperação explícita de imagens offline para um novo destino, sob o modelo de falhas documentado.
- Desempenho e uso de memória adequados a discos reais.
- Assinatura de produção, HVCI/HLK em execução, NTFS, BitLocker, boot, Windows Update e desinstalação.
- Hardware físico ou Windows 11 25H2 em VM.

O pacote-fonte e os instaladores da interface não devem ser apresentados como produto de congelamento pronto para uso. Nenhum pacote inclui driver de proteção ou modifica a inicialização para congelar o sistema.
