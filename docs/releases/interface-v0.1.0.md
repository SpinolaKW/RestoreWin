# RestoreWin 0.1.0 — interface experimental

**Esta versão NÃO congela nem restaura o sistema físico.** É uma pré-versão da interface e da configuração persistente. Ativação, descongelamento, proteção no boot e exclusões efetivas permanecem indisponíveis.

## Arquivos

- Windows x64: ZIP portátil e instalador assistido `.exe`, gerados em runner Windows. Extraia todos os arquivos do ZIP antes de abrir `RestoreWin.exe`. O instalador permite escolher a pasta/unidade da interface. Não há assinatura de produção configurada.
- Linux x64: pacote `.deb` e portátil `.tar.gz`. O portátil permite escolher o local de extração; o `.deb` utiliza o destino do pacote. Nenhum deles instala proteção.
- `RestoreWin-0.1.0-fonte.zip`: código-fonte, lockfile, testes e documentação.
- `restorewin-interface-linux.png`: captura da interface executada no Debian 13 no ambiente de desenvolvimento.
- `SHA256SUMS.txt`: hashes dos arquivos desta publicação. Os pacotes reconstruídos pelo Actions podem diferir dos gerados anteriormente na nuvem; use os hashes da publicação que baixou.

## O que funciona

Interface em português, diagnóstico de unidades, seleção de discos, cadastro de pastas, nome da futura base, salvamento local com revisão e histórico. As pastas cadastradas são apenas configuração; não há preservação sob congelamento nesta versão.

## Validação e limites

O ambiente de desenvolvimento aprovou 43 testes: 14 C, 9 Python, 16 Node e 4 fluxos Electron em Linux. A publicação só ocorre depois dos testes e empacotamentos definidos no workflow. Compilar um pacote Windows não comprova execução no Windows, compatibilidade com todas as builds ou funcionamento no boot. Não há driver de proteção Windows, integração de boot Linux ou testes de reinicialização física.

O pacote proprietário antigo não faz parte deste projeto. Instalar esta interface não corrige uma instalação do Windows que já esteja presa no Reparo Automático.
