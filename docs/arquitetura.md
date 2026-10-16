# Instalação física: arquitetura necessária e estado real

## Objetivo confirmado

Restaurar ao reiniciar a instalação física. O escopo inicialmente Windows 11 25H2 Home/Pro foi ampliado pelo usuário para Windows 10, Windows 11 e Linux, começando a validação Linux por Ubuntu/Debian. O usuário aceita uma implementação própria. O Windows protegido já apresentou Reparo Automático com Reboot Restore Rx v3.3; a causa exata não foi confirmada. Consulte também [os requisitos multiplataforma](produto-multiplataforma.md).

Não há promessa de ausência absoluta de falhas. O critério para distribuir uma versão é evidência de instalação, recuperação e integridade dos dados em configurações explicitamente suportadas.

## Implementado e verificado localmente

- Núcleo C11 que separa uma fonte de blocos somente leitura e um overlay gravável.
- Leitura combinada, replay, checksums, limites e invalidação do contexto após erro de I/O.
- Testes de blocos de 512/4096 bytes, reabertura, sobrescrita de um bloco, base intacta, falta de capacidade, corrupção, escrita parcial e falha de flush.
- Abertura de um overlay novo com a imagem offline para demonstrar retorno à base.
- Verificador estático de propriedades PE relevantes para desenvolvimento de drivers HVCI.

Os testes usam memória com injeção de falhas e arquivos temporários no Linux. Não exercitam Windows, NTFS, drivers ou inicialização.

## Não implementado

1. **Recuperação durável de metadados.** O núcleo detecta registros incompletos, mas não os recupera automaticamente. Um protocolo de commit redundante, testes de crash em cada etapa e recuperação offline são pré-requisitos para o filtro de boot.
2. **Índice de produção.** O mapa simples por bloco e o flush síncrono por gravação não são adequados ao tamanho/desempenho de um disco de sistema. Precisam ser substituídos e medidos antes de integração.
3. **Driver de armazenamento.** É necessário um componente Windows, usando interfaces suportadas e memória NX, que preserve ordenação, barreiras, cancelamento, PnP, power management, paginação e erros. Nenhum driver ou INF é fornecido neste estado.
4. **Local do overlay.** Um arquivo comum no próprio volume protegido pode causar recursão de I/O e dependência circular durante o boot. É necessário projetar e validar armazenamento independente/acessível nessa fase, geometria, capacidade reservada e identidade da base. O protótipo não decide esses aspectos para o PC do usuário.
5. **Integração com o Windows.** Precisam ser verificados NTFS, BitLocker, Secure Boot/HVCI, NVMe/AHCI, TRIM, dump, hibernação/Inicialização Rápida, VSS, múltiplos volumes e partições de recuperação. Falhas nessas interações não são corrigidas por uma troca de versão no EXE.
6. **Instalador e desinstalador transacionais da proteção.** A instalação precisa preparar e conferir recuperação antes de ativar a proteção. A desinstalação precisa preservar uma visão coerente dos dados ou retornar explicitamente à base escolhida. Os pacotes da interface são separados dessa etapa e não incluem congelamento. Nenhum serviço, filtro de disco, alteração de BCD/EFI ou registro de boot é instalado pelo código atual.
7. **Controle e manutenção efetivos.** A interface desktop permite salvar configuração, escolher volumes, configurar pastas, consultar o sistema e ver o histórico. O controlador privilegiado, ativação, confirmação do estado real, atualização da base e manutenção efetiva continuam pendentes. A aplicação não simula proteção: as ações são recusadas enquanto o componente não existe. Bloquear atualizações permanentemente não faz parte do projeto.
8. **Assinatura e distribuição.** O driver final precisa de assinatura aceita pelo Windows para a política de produção correspondente. Um certificado de teste ou alterações nos drivers proprietários não atendem a esse requisito. A assinatura não substitui os testes.

## Decisões para uma integração futura

O [diagnóstico Windows somente de leitura](diagnostico-windows.md) identifica a edição/build e consulta o estado UWF global quando acessível. Ele orienta a escolha entre avaliar UWF nativo e desenvolver o driver próprio para Home/Pro. Nenhum resultado desse diagnóstico habilita proteção ou comprova compatibilidade de boot.

- Preservar o carregador Microsoft e evitar substituir arquivos EFI como estratégia de implementação. A assinatura e o carregamento do filtro de boot ainda precisam ser projetados e validados.
- Nunca ativar proteção usando geometria, estado do overlay ou identidade da base desconhecidos.
- Nunca retornar silenciosamente à base após falha de metadados e permitir novas gravações em cima de uma visão possivelmente errada.
- Alterar a base somente com a imagem/volumes offline e depois de um protocolo de manutenção coerente. Não oferecer reset do disco de sistema montado.
- Manter caminho de recuperação externo à camada protegida. A ausência de perda de dados no protótipo não garante a disponibilidade do boot.

## Ambiente externo necessário

O ambiente atual é Linux x64: não há WDK/SDK Windows preparado nem uma instância Windows 11 25H2. Não foi possível compilar ou executar um driver Windows ou realizar testes de boot aqui. Uma VM Windows de laboratório serviria para teste do produto físico, não para substituir o uso solicitado pelo usuário. Depois disso, ainda seriam necessários testes em hardware físico descartável e nas configurações de armazenamento declaradas como suportadas.

## Verificação antes de qualquer versão instalável

| Etapa | Evidência exigida | Estado |
| --- | --- | --- |
| Núcleo em imagens | Testes de leitura/escrita e falhas, sanitizers | Parcial: protótipo verificado; recuperação durável e escala pendentes |
| Compilação de driver | WDK/SDK fixados, análise estática e build reproduzível | Não executada; driver não implementado |
| Integridade do driver | HVCI, Driver Verifier/HLK e assinatura aceita | Não executada |
| Ciclo funcional | Instalar, criar base, gravar, reiniciar e comparar dados | Não executado |
| Recuperação | Perda de energia, overlay cheio/danificado, inicialização de recuperação | Não executada no Windows |
| Manutenção | Atualização cumulativa, atualização da base, retorno à proteção | Não executada |
| Remoção | Preservar estado selecionado e iniciar sem o filtro | Não executada |

Este repositório é o início verificável do desenvolvimento, não uma edição compatível pronta do Reboot Restore Rx. Nenhum executável recebido foi alterado, assinado novamente ou distribuído junto ao protótipo.
