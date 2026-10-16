# Formato experimental de overlay, versão 1

Este formato serve ao protótipo de imagens. Não está aprovado para volumes reais nem é um formato estável de produto.

A geometria admite blocos completos de 512 ou 4096 bytes. Todos os inteiros são little endian. Há um bloco de cabeçalho e uma sequência append-only de pares cabeçalho/dados. Os bytes reservados são inicializados com zero e incluídos no CRC.

## Cabeçalho da imagem: um bloco

| Offset | Comprimento | Campo |
| --- | --- | --- |
| 0 | 8 | `RWINCOW1` |
| 8 | 4 | Versão: 1 |
| 12 | 4 | Tamanho de bloco |
| 16 | 8 | Número de blocos da base |
| 24 | 32 | Identidade da base fornecida pelo adaptador |
| 56 | 4 | CRC32 de todo o bloco, considerando este campo zero |
| 60 | restante | Reservado |

O núcleo compara a identidade com a esperada pelo chamador; ele não implementa SHA-256 nem verifica que essa identidade corresponde aos bytes da base. O adaptador de produção terá de verificar a identidade e manter a base imutável. Os testes usam uma identidade fixa de fixture.

## Registro: dois blocos

| Offset no cabeçalho | Comprimento | Campo |
| --- | --- | --- |
| 0 | 8 | `RWFRAME1` |
| 8 | 8 | Sequência, começando em 1 |
| 16 | 8 | Índice de bloco lógico na base |
| 24 | 4 | CRC32 do bloco de dados |
| 28 | 4 | CRC32 de todo o cabeçalho, considerando este campo zero |
| 32 | restante | Reservado |

O bloco seguinte contém os dados. O último registro válido de cada índice determina a leitura. A abertura verifica todos os registros, incluindo versões sobrescritas. A leitura de um bloco redirecionado confere novamente cabeçalho e dados antes de entregar o resultado ao chamador.

## Durabilidade e limites

O núcleo escreve cabeçalho e dados e solicita flush antes de publicar a alteração no mapa em memória. A corretude depende do adaptador e do dispositivo cumprirem o contrato de I/O/durabilidade. Os testes simulam resultados possíveis de uma falha; não reproduzem caches ou controladores físicos.

Se uma gravação ou flush falhar, o contexto fica indisponível até uma nova abertura explícita. Um registro completo não confirmado ao chamador pode ser encontrado após reabertura; um erro não implica que nada foi persistido. Um último registro parcialmente persistido é rejeitado, sem truncamento automático. Ainda falta um protocolo de commit/recuperação de metadados apropriado ao boot, com redundância e garantia de preservação das gravações confirmadas. Checksums detectam danos acidentais, não autenticam dados nem protegem contra adulteração maliciosa.

O mapa em RAM ocupa oito bytes por bloco lógico. Para 1 TiB com blocos de 512 bytes seriam 16 GiB só para o mapa. Esse desenho não serve como implementação final de um filtro físico: precisa de índice esparso, cache limitado e medições de custo. O protótipo também faz um flush por bloco e não tem compactação, batch de gravações ou recuperação de espaço.

As chamadas são síncronas e serializadas externamente. Buffers de requisição não podem sobrepor o scratch ou o mapa. Há apenas I/O de blocos inteiros. Concurrency, cancelamento, flush/FUA, TRIM, hibernação, dump e transações entre volumes dependem do driver/adaptador e não foram implementados.
