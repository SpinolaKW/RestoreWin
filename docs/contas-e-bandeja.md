# Contas e execução em segundo plano — 0.2.0

O primeiro acesso exige criar o administrador principal, sem senha padrão. O nome aceita de 3 a 32 caracteres ASCII (letras, números, ponto, hífen e sublinhado); a senha aceita de 12 a 128 caracteres. A tela exige confirmar a senha e reconhecer o aviso de não esquecê-la. Não há recuperação automática nem senha mestra.

Somente essa conta administra usuários. As demais são operadores: podem acessar as configurações, mas não cadastrar contas, trocar senhas, excluir contas, configurar a inicialização automática ou encerrar pelo aplicativo. Os nomes são imutáveis. O administrador principal não pode ser excluído; para trocar sua senha, precisa estar autenticado e confirmar a senha atual. A troca encerra a sessão e exige novo login. Ele pode redefinir a senha ou excluir operadores.

## Bandeja

Fechar pelo X ou Alt+F4 bloqueia a sessão e oculta a janela, preservando o processo. Clique no ícone da bandeja, use seu menu ou execute o atalho novamente para abrir a mesma instância. Se a criação da bandeja falhar, o fechamento bloqueia e minimiza a janela, preservando um caminho de reabertura. A exibição efetiva de ícones em Linux também depende do suporte do ambiente gráfico.

O menu da bandeja e a tela de usuários permitem encerrar depois de entrar como administrador. No Windows instalado, o administrador pode marcar **Iniciar com o Windows, na bandeja**. É uma inicialização no login do usuário Windows atual, não um serviço iniciado antes do login. O primeiro cadastro continua aparecendo mesmo se o processo tiver sido iniciado com `--background`.

A sessão também é bloqueada pelos eventos de bloqueio de tela e suspensão. Um temporizador verifica a inatividade do sistema a cada 15 segundos e bloqueia após 5 minutos; ações autenticadas deixam de ser aceitas depois de 15 minutos sem uso das operações do aplicativo. A sessão não é gravada em disco. Fechar durante um login em andamento impede que o resultado desse login desbloqueie a janela oculta.

## Armazenamento e alcance da proteção

As senhas são derivadas por scrypt (N=32768, r=8, p=1, salt aleatório de 16 bytes e chave de 64 bytes) e comparadas em tempo constante. Arquivos e respostas públicas não incluem senhas em texto puro; respostas públicas também não incluem hashes ou salts. As gravações usam arquivo temporário exclusivo e substituição por rename. Não são geradas cópias automáticas dos hashes antigos. Após cinco falhas, o login aguarda um minuto; esse limite é compartilhado entre nomes conhecidos/desconhecidos e persiste após reiniciar o aplicativo.

`accounts.json` e `accounts.initialized` ficam no diretório de dados do usuário da aplicação. Um cadastro inválido é preservado e bloqueia o acesso; a ausência do arquivo de contas depois da marca de inicialização também bloqueia o acesso. Atualizar a interface preserva o perfil existente e exige o primeiro cadastro se ainda não havia contas. A prévia no navegador não cadastra contas nem armazena senhas.

Estas verificações protegem os comandos e a interface. **Não são uma barreira contra alguém com permissão para modificar os arquivos da aplicação, substituir o executável ou encerrar processos pelo sistema operacional.** Alunos devem usar contas Windows padrão e separadas da conta de administração. Compartilhar a mesma conta Windows também compartilha permissões sobre os arquivos de dados. Permissões Unix solicitadas não equivalem a uma configuração de ACL no Windows. Uma autoridade de proteção comum a todos os usuários Windows exigirá serviço privilegiado, ACL e integração nativa ainda não implementados.

Permanecer em segundo plano não congela o disco. Os comandos de proteção continuam indisponíveis e nenhum driver ou componente de boot é instalado.

## Validação

Há testes de autorização, persistência, senhas, limites de tentativas, conta principal, expiração e concorrência com bloqueio. Os testes Electron usam IPC real para cadastro, login, operadores e bloqueio; fecham a janela e lançam uma segunda instância real para verificar reabertura do processo original. O seletor de pastas e a leitura do tempo de inatividade do sistema são substituídos somente no processo de teste. Bloqueio de tela e suspensão são simulados por eventos no teste; não se suspende o runner. A visibilidade do ícone e o registro de inicialização automática em uma estação Windows de laboratório ainda exigem validação manual.
