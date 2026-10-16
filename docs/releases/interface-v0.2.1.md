# RestoreWin 0.2.1 — diagnóstico do armazenamento de usuários

Esta atualização preserva as contas e melhora o diagnóstico quando o programa abre diretamente em **Controle de acesso**, com a mensagem **Não foi possível ler os usuários**. Essa mensagem significa que a abertura do arquivo falhou antes da validação do usuário/senha; não estabelece sozinha a causa no computador afetado.

A tela agora exibe o código nativo devolvido pelo sistema, o caminho e a operação que falhou, com opção de copiar somente esses dados. Não inclui senhas, hashes ou o conteúdo do cadastro. A mesma informação passa a existir nas falhas de gravação. Falhas de leitura também revogam a sessão anterior.

O aplicativo continua bloqueando o acesso quando não consegue validar as contas. Não apaga ou substitui um cadastro ilegível para recriar o administrador. Atualizar não concede novas permissões aos arquivos nem resolve automaticamente bloqueios externos do Windows. Ao relatar o erro, envie o código e caminho apresentados por **Copiar diagnóstico**, sem enviar `accounts.json`.

Os testes cobrem falha ao abrir um caminho de contas inadequado, preservação do administrador e recuperação após restaurar a leitura. A publicação inclui um teste do executável Windows empacotado usando o diretório padrão de dados de um runner descartável, além dos testes do código-fonte. Isso não reproduz as permissões ou políticas do computador do usuário.

**Esta versão ainda não congela nem restaura o sistema ao reiniciar.** Permanecem disponíveis as funções de bandeja e contas da 0.2.0. Os pacotes não possuem assinatura de produção configurada.
