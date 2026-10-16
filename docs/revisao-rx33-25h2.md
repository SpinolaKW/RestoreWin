# Reavaliação estática do Reboot Restore Rx 3.3

O pedido de adaptar o congelamento foi reavaliado nos sete arquivos `.sys` x64 de `Drivers/win10/x64` do ZIP fornecido. Nenhum binário do fabricante foi incorporado ao projeto. O verificador foi executado novamente sem carregar ou executar os drivers; os sete mantêm o achado `writable_executable_section` na seção `INIT` (Characteristics `0xE2000020`).

O pacote original tem SHA256 `6407890a1e3435c1dc6a7b460da76baa5a166bb2d69d76fe351cb696e33f21ca`. Os arquivos avaliados são `Shdump.sys`, `shdbus.sys`, `shdfmini.sys`, `shield-async.sys`, `shield.sys`, `shieldf.sys` e `shieldm.sys`.

A análise de desassemblagem anterior também identificou chamadas a `ExAllocatePoolWithTag` com primeiro argumento zero (`NonPagedPool`, sem NX). Exemplos no endereço preferido da imagem: `shdbus.sys` 0x118C6, `shieldm.sys` 0x11466 e `shield.sys` 0x11A4B. Isso requer revisão dos usos reais da memória; trocar o valor de uma alocação sem entender o que executa nessa memória pode introduzir outra falha.

São obstáculos concretos a requisitos de Integridade da Memória/HVCI, não uma identificação comprovada da causa do Reparo Automático relatado. As estruturas de assinatura incluem publicadores New Horizon e assinaturas Microsoft aninhadas; isso não confirma aceitação na build atual. Modificar bytes assinados exige nova assinatura válida dos componentes e catálogos correspondentes. Há componente de boot e componentes EFI, cujo comportamento não foi reproduzido neste ambiente Linux.

Não existe um patch validado para o Windows 11 25H2 neste projeto. Uma alteração que somente permita carregar o driver não comprova correção do redirecionamento de gravações, compatibilidade com NTFS/BitLocker, tolerância a perda de energia ou recuperação do boot. A nova autenticação e o processo na bandeja não resolvem esses pontos.

Para integrar congelamento ainda faltam uma implementação de armazenamento e recuperação adequada, instalação/assinatura aceitas pelo Windows, testes com Driver Verifier/HVCI e ciclos de boot, escrita, manutenção, atualização e desinstalação em Windows 11 25H2 descartável, seguidos de laboratório físico. O protótipo C trabalha somente com imagens e ainda não tem o protocolo de recuperação e a escala de índices exigidos para essa integração. A interface permanece sem driver e com a ativação indisponível.

Referências: [Memory integrity compatible code](https://learn.microsoft.com/en-us/windows-hardware/drivers/driversecurity/implement-hvci-compatible-code) e [Code integrity checking](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/code-integrity-checking), Microsoft. O verificador reproduzível está em `tools/check_driver_images.py`; o relatório integral da instância atual fica em `artifacts/revisao-rx33-25h2.json` e não distribui os binários recebidos.
