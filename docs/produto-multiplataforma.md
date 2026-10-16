# Requisitos da versão própria

O objetivo é proteger a instalação física, com restauração ao reiniciar, manutenção, pastas permanentes, interface e escolha do disco de instalação. Os alvos são Windows 10/11 e Linux, começando por Ubuntu/Debian. Compatibilidade com todas as versões é um objetivo de cobertura, não uma propriedade comprovada.

## Estado da proteção

| Estado | Significado |
| --- | --- |
| Indisponível | Componente inexistente/não verificável; ativação bloqueada |
| Descongelado | Manutenção e gravações permanentes confirmadas pelo componente |
| Congelamento pendente | Operação preparada, mas ativação ainda sem confirmação |
| Congelado | Base, volumes e regras confirmados pelo componente efetivo |
| Manutenção pendente | Desativação solicitada e ainda sem confirmação |
| Desconhecido | Consulta falhou; não assumir que o último estado continua válido |

O aplicativo atual retorna Indisponível. Os demais estados são contratos de integração, não funções já disponíveis. Salvar um perfil não confirma congelamento.

A primeira ativação exige uma base consistente. Se instalação/sincronização exigir reinicialização, a interface deverá indicar essa pendência. A captura atômica com o sistema em uso ainda não foi projetada/validada; não há promessa de congelamento instantâneo.

As mudanças da sessão deverão existir temporariamente para o sistema funcionar e ser descartadas no próximo boot. A manutenção deverá permitir atualizações e reinicializações necessárias, verificar a saúde do sistema e consolidar uma nova base antes de reativar. Bloquear permanentemente Windows Update não faz parte da arquitetura.

## Pastas permanentes

A seleção de pastas funciona na configuração. Uma lista de caminhos não preserva dados em um rollback sem um mecanismo efetivo.

No Windows, um filtro apenas de blocos não entende caminhos. Fixar uma lista de setores dos arquivos como exclusão é insuficiente: novos arquivos e metadados NTFS mudam a relação entre nomes e blocos. São necessários armazenamento permanente coerente e integração apropriada com o filesystem/virtualização. Junctions, symlinks, hardlinks, fluxos alternativos, permissões e arquivos abertos exigem testes próprios. O aplicativo inicial recusa links, dispositivos/rede, árvores essenciais e exclusões sobrepostas.

No Linux, uma arquitetura possível é uma raiz efêmera com OverlayFS e diretórios permanentes montados antes do uso normal. Isso exige armazenamento independente, ordenação de boot e política para permissões, links, subvolumes e initramfs. A interface não aplica mounts, OverlayFS, GRUB ou initramfs.

## Sistemas e instalação

Home/Pro exigem uma solução própria: UWF não é um recurso universal nessas edições. Um adaptador UWF poderá ser considerado futuramente para edições que o suportem. O driver próprio não foi implementado.

A prioridade Windows confirmada é **Home/Pro**. O desenvolvimento segue pelo mecanismo próprio, começando pelo [journal redundante e recuperação offline em imagens](formato-overlay-v2.md). O usuário dispõe de PC de laboratório reinstalável; ele ainda não foi acessado nem usado nos testes. Windows 10/11 x64 são os alvos iniciais, sem promessa de compatibilidade independente de todas as builds. A interface existente não habilita congelamento com este avanço.

Ubuntu/Debian exigem validação de kernels, initramfs, criptografia, filesystem e carregador. A presença de OverlayFS não conclui a proteção da raiz. Outras distribuições precisam de adaptadores/testes próprios.

O local da interface é independente dos volumes protegidos e do armazenamento da proteção. O instalador Windows permite escolher a pasta/unidade; componentes de boot/driver precisarão dos locais exigidos pelo sistema. O pacote portátil Linux pode ser extraído no local escolhido; o `.deb` usa o destino de sistema. A escolha do local não prova que um futuro overlay estará acessível no boot.

## Matriz atual

| Alvo | Interface | Congelamento / boot |
| --- | --- | --- |
| Debian 13 x64, contêiner atual | Compilada e executada, testes Electron passando | Não implementado; o contêiner não testa boot do host |
| Ubuntu/Debian em máquina completa | Alvos iniciais; pacote ainda precisa de execução validada | Não implementado |
| Windows 10 | Empacotamento preparado; execução Windows não validada | Driver não implementado |
| Windows 11, incluindo 25H2 | Empacotamento preparado; execução Windows não validada | Driver não implementado |
| Outras builds/arquiteturas/distribuições | Sem validação | Sem implementação/validação |

Antes de congelamento real faltam recuperação durável, componentes privilegiados, instalação/desinstalação transacionais, assinatura aceita no Windows e testes de boot. O núcleo C também precisa de recuperação automática de journal incompleto e índice apropriado à escala de um disco real. O ambiente atual não substitui um laboratório Windows ou o boot de uma máquina Linux completa.
