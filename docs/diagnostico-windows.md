# Antes do congelamento fisico

O RestoreWin ainda nao congela a instalacao fisica. A etapa disponivel e um diagnostico somente de leitura, separado da interface e executavel sem acessar o cadastro bloqueado. Nao e necessario recuperar as contas para coleta-lo. Ele nao instala drivers ou recursos, nao executa metodos UWF, nao habilita servicos e nao modifica o boot.

## Execucao

Revise [Get-RestoreWinReadiness.ps1](../tools/Get-RestoreWinReadiness.ps1), salve o arquivo e execute com PowerShell 5.1 ou 7 no Windows, respeitando as politicas da organizacao:

```powershell
& .\Get-RestoreWinReadiness.ps1
```

Nao requer elevacao. Consultas indisponiveis ou negadas resultam em campos `null` e avisos; nao sao convertidas em suporte confirmado. O resultado JSON contem edicao, versao, build, tipo de instalacao, associacao a dominio (somente booleano) e estado UWF global atual/proximo, quando consultavel. Nao inclui usuario, nome do dominio, numero de serie, hashes de contas ou chaves BitLocker. `corporatePolicyAssessment: not-assessed` significa que **nao** foram avaliados GPO, Intune, EDR ou autorizacao de uso. Nao estar em dominio nao implica ausencia de gerenciamento corporativo.

O diagnostico nao ignora politicas de execucao. Em um computador administrado pela empresa, o TI precisa analisar qualquer bloqueio; esse script nao cria excecoes.

## Interpretacao

| Candidato | Proxima etapa de engenharia |
| --- | --- |
| `review-native-uwf` | Avaliar adaptador para o UWF Microsoft em edicoes Enterprise/Education/IoT Enterprise reconhecidas. Exige confirmar recurso, arquitetura, configuracao, volumes e funcionamento na maquina de laboratorio. |
| `own-driver-required` | Home/Pro reconhecido. Para manter essa edicao e proteger a instalacao fisica, o projeto precisa de driver proprio, assinatura aceita pelo Windows, armazenamento temporario e recuperacao validada. |
| `undetermined` | Dados insuficientes, edicao nao reconhecida, Windows antigo ou sistema nao cliente (por exemplo Windows Server). Nao escolher automaticamente um backend. |

As listas de edicoes sao conservadoras e o resultado e apenas um encaminhamento. Build nao e uma lista de compatibilidade. A classificacao `windows-11-or-later` evita declarar uma versao futura como testada. A presenca de UWF global nao prova que o volume do sistema esteja protegido, nem que exclusoes ou manutencao estejam prontas. `restoreWinActivationAvailable` permanece falso e `bootValidation` permanece `not-performed` em todos os resultados.

Referencia do recurso nativo: [Unified Write Filter, Microsoft](https://learn.microsoft.com/en-us/windows/iot/iot-enterprise/customize/unified-write-filter). Home/Pro nao oferece esse recurso como base universal para o produto.

## Limite para a proxima entrega

Nao existe implementacao pronta independente de todas as versoes do Windows. O objetivo inicial permanece Windows 10/11 x64, incluindo 25H2; cada configuracao precisa de validacao. Secure Boot, HVCI, BitLocker, NVMe/AHCI, atualizacoes, recuperacao e overlay cheio precisam ser ensaiados antes da distribuicao. O diagnostico atual nao mede essas propriedades.

Primeiro validar em VM de laboratorio com reinicializacao e discos de teste; depois, em PC de laboratorio reinstalavel. A VM e um instrumento de teste para a protecao da instalacao fisica, nao uma mudanca do requisito do usuario. O ambiente Linux da nuvem e os testes de script em Windows Server nao validam congelamento ou boot no Windows 10/11. Consulte [a arquitetura e os criterios de liberacao](arquitetura.md).
