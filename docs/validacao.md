# Validação executada

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
- Protocolo de recuperação automática de registros interrompidos.
- Desempenho e uso de memória adequados a discos reais.
- Assinatura de produção, HVCI/HLK em execução, NTFS, BitLocker, boot, Windows Update e desinstalação.
- Hardware físico ou Windows 11 25H2 em VM.

O pacote-fonte e os instaladores da interface não devem ser apresentados como produto de congelamento pronto para uso. Nenhum pacote inclui driver de proteção ou modifica a inicialização para congelar o sistema.
