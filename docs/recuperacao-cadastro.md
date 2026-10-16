# Cadastro ausente depois da inicializacao

Se `accounts.json` sumiu e somente `accounts.initialized` vazio permanece, o aplicativo bloqueia o acesso. O marcador nao contem usuarios ou senhas. Permissoes corretas no marcador nao comprovam a causa do desaparecimento do cadastro. Antes de reiniciar, procure copias do cadastro e confira o historico de protecao do Windows ou do antivirus. Nao publique o conteudo de arquivos de contas.

O procedimento abaixo e excepcional: permite cadastrar um **novo** administrador principal e recomecar as configuracoes. Requer autorizacao do responsavel pelo computador e uma conta administradora do Windows. Nao e troca de senha, nao recupera as credenciais anteriores e nao resolve a causa de um arquivo que desaparece. Nenhum mecanismo de boot ou congelamento e alterado.

1. Encerre todos os processos **RestoreWin** no Gerenciador de Tarefas. Fechar pelo X apenas oculta a janela.
2. Baixe e revise [Reset-RestoreWinEnrollment.ps1](../tools/Reset-RestoreWinEnrollment.ps1). Abra PowerShell como administrador.
3. Confira o caminho exato exibido no diagnostico do aplicativo. Nao use a pasta do instalador. Nao use automaticamente o APPDATA da conta elevada, que pode pertencer a outro usuario.
4. Execute primeiro a verificacao (ajuste o local do script e o usuario Windows):

   ```powershell
   & "$env:USERPROFILE\Downloads\Reset-RestoreWinEnrollment.ps1" -DataDirectory 'C:\Users\kevinas\AppData\Roaming\restorewin-desktop'
   ```

5. Se os caminhos estiverem corretos, execute o mesmo comando adicionando `-Apply`. `-Apply -WhatIf` somente simula. O script exige `accounts.json` ausente, marcador vazio, nenhum outro arquivo `accounts*`, nenhum processo RestoreWin e nenhum link/junction nos ancestrais. Falhas de acesso interrompem o procedimento.
6. A pasta inteira e renomeada no mesmo diretorio para `restorewin-desktop-backup-<data>-<identificador>`. Nada e excluido, as permissoes nao sao alteradas e destinos existentes nao sao sobrescritos. Reabra normalmente o aplicativo pelo atalho, crie o novo administrador e guarde sua senha. Preserve o backup.

Se a politica de execucao impedir o script, nao desative protecoes nem altere politicas da organizacao. Solicite a revisao ao administrador responsavel. Se o cadastro voltar a desaparecer, pare as novas tentativas e investigue o historico de protecao, ferramentas de limpeza e processos com acesso a essa pasta.

O script e uma ferramenta manual separada; o aplicativo continua recusando automaticamente o recadastro quando o marcador existe. Contas Windows padrao separadas continuam necessarias para os alunos. Uma senha do aplicativo nao impede um administrador do Windows de alterar seus arquivos.
