# Overlay experimental v2: redundancia e recuperacao offline

Esta e uma etapa do mecanismo proprio para Windows Home/Pro. E C11 para **imagens de teste**, sem driver, acesso a disco fisico ou integracao com boot. Nao implementa congelamento do Windows. As APIs `rw2_*` sao separadas das APIs v1; imagens v1 nao sao reinterpretadas nem migradas automaticamente.

## Layout e publicacao

Blocos completos de 512 ou 4096 bytes, inteiros little endian e campos reservados zerados/incluidos no CRC. O formato usa dois blocos de cabecalho, seguidos de registros de quatro blocos:

```text
Cabecalho A | Cabecalho B | Registro 1: [metadados A | dados A | metadados B | dados B] | ...
```

Os cabecalhos sao copias identicas: magic `RWINCOW2`, versao 2, tamanho de bloco, quantidade de blocos, identidade da base e CRC32. Seus campos ficam nos mesmos offsets 0/8/12/16/24/56 do [cabecalho v1](formato-overlay.md). Cada par metadados/dados usa magic `RWFRAME2` e os offsets 8/16/24/28 do registro v1: sequencia, bloco logico, CRC dos dados e CRC dos metadados. Duas copias validas devem ser identicas byte a byte.

Uma escrita grava metadados A e dados A, faz flush, grava metadados B e dados B e faz outro flush. Somente entao publica o indice em memoria e retorna sucesso. A base tem apenas callbacks de leitura. Qualquer erro de I/O desativa o contexto; nenhuma nova leitura/gravação e aceita antes de reabrir. Leituras redirecionadas validam as duas copias antes de devolver dados.

O minimo de capacidade e seis blocos (dois de cabecalho e quatro para um registro). Scratch requer quatro blocos. O custo do journal dobra em relacao a v1; sao dois flushes por registro. A interface e seus pacotes nao usam este motor.

## Recuperacao explicita

`rw2_mount` e estrito: cabecalho ou registro incompleto/danificado bloqueia a montagem, mesmo quando a outra copia esta boa. Nao ha recuperacao silenciosa ou retorno automatico a base.

`rw2_recover` exige imagem offline, acesso exclusivo, base imutavel e um **destino diferente e vazio**. Primeiro valida toda a origem sem modificar o destino. Depois copia o historico para o destino, validando-o novamente. A origem nunca e modificada; uma falha de recuperacao exige preservar/quarentenar o destino parcial.

Regras:

- Uma copia de cabecalho/registro valida permite reconstruir a outra. As sequencias precisam permanecer contiguas, os blocos dentro da geometria e ambos os CRCs corretos.
- Copias validas que discordam, ou um par completo sem nenhuma copia valida, impedem a recuperacao. Nenhuma versao antiga e usada para esconder esse dano.
- Somente o ultimo par fisicamente incompleto e sem copia valida pode ser descartado. Pelo contrato de tamanho duravel abaixo, ele nao pode representar uma escrita confirmada. O relatorio informa exatamente quantos bytes foram descartados.
- Uma copia valida de uma escrita que retornou erro pode ser recuperada: erro de I/O nao significa ausencia de persistencia.
- Um registro antigo sobrescrito tambem precisa passar pela validacao. Dano em ambas as copias nao e ignorado so porque uma versao mais nova daquele bloco existe.

O destino comeca com cabecalhos `RWINPART`, recusados pela montagem. Os registros sao copiados e sincronizados antes de substituir os cabecalhos por `RWINCOW2`, cada um com flush. Uma escrita final que retorna erro pode ter persistido; qualquer imagem final montavel precisa conter todos os registros recuperados, nunca somente um prefixo. Um retorno de erro continua exigindo quarentena/revisao, mesmo nesse caso.

O relatorio de sucesso contem quantidade de registros, copias de cabecalho/registro reconstruidas, bytes de cauda descartados, tamanho da origem e tamanho do destino. Em caso de erro, os campos permanecem zero; isso nao significa que o destino esteja vazio. Nao ha troca automatica dos arquivos, escolha do overlay no boot ou atualizacao transacional de configuracao de um driver.

## Modelo de falhas e limites

O adaptador/dispositivo deve cumprir flush ordenado, persistir os bytes e o tamanho confirmados e manter esse prefixo apos queda de energia. Antes de um flush bem-sucedido, parte ou toda uma escrita pode persistir. Depois dele, novas escritas append-only nao podem danificar dados confirmados anteriormente. Os testes exploram cortes por byte sob esse modelo, nao simulam controladores reais.

Truncamento arbitrario de dados ja confirmados, dano nas duas copias, gravacoes concorrentes ou adulteracao maliciosa estao fora da garantia. Um arquivo encurtado por outro processo pode parecer uma cauda nao confirmada: o nucleo sozinho nao distingue essas causas. CRC32 nao autentica dados e pode ter colisoes. Copias adjacentes nao fornecem isolamento contra perda de setores fisicos/controladores. A identidade da base continua sendo responsabilidade do adaptador; nao foi adicionada verificacao SHA-256 ao nucleo.

O mapa denso, a ausencia de compactacao, a duplicacao dos registros e o replay completo impedem tratar esse desenho como formato final para discos reais. Continuam pendentes indice de producao, journal/boot do driver, contrato Windows de flush/FUA, PnP/energia, NTFS, BitLocker, TRIM, Secure Boot/HVCI, assinatura aceita, instalacao, manutencao e recuperacao externa. Esse protocolo de imagens nao resolve esses itens.

## Testes

`make test` executa 27 grupos C, incluindo os 14 casos v1 preservados, e nove testes PE. A v2 inclui todos os 2.049 cortes de um registro de 512 bytes, cada um com dois resultados de persistencia; 32 cenarios de bordas de 4096 bytes; 1.025 cortes de formatacao; e 4.097 cortes de exportacao/publicacao. Tambem inclui danos em cada copia, conflitos de copias validas, falhas de flush, preservacao da base/origem e recuperacao em arquivo temporario com fsync e reabertura.

O workflow separado compila o mesmo nucleo com MSVC e executa no Windows os 25 grupos de memoria. Os dois testes de arquivo POSIX sao excluidos explicitamente desse alvo. A analise estatica e o AddressSanitizer nao certificam modo kernel nem compatibilidade de boot; **nao sao testes de WDK/driver ou congelamento fisico**.
