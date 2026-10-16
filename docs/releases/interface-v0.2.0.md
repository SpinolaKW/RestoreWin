# RestoreWin 0.2.0 — bandeja, usuários e senhas

**Esta versão ainda NÃO congela nem restaura o Windows ou Linux ao reiniciar.** Nenhum driver do Reboot Restore Rx foi adaptado ou instalado. A revisão dos binários está em `docs/revisao-rx33-25h2.md`.

## Alterações

- Fechar a janela bloqueia o acesso e mantém o aplicativo em segundo plano na bandeja. Abra pelo ícone ou pelo atalho novamente. Se não houver bandeja, a janela é bloqueada e minimizada.
- Primeiro acesso com criação obrigatória do administrador principal e aviso de não esquecer a senha.
- Login, bloqueio da sessão, cadastro de operadores, alteração de senhas e exclusão de operadores pelo administrador.
- Administrador principal protegido contra exclusão e renomeação. Sua senha exige a senha atual e novo login após a troca.
- Opção de iniciar na bandeja ao entrar no Windows, no aplicativo instalado.
- Senhas com scrypt e salt, limite persistente de tentativas e autorização no processo principal.

As contas são locais ao usuário Windows que executa a aplicação. Elas controlam o aplicativo; não impedem alteração dos arquivos ou encerramento do processo por alguém com permissões no sistema. Use contas padrão separadas para os alunos. Consulte `docs/contas-e-bandeja.md`.

## Downloads

Windows x64: instalador `.exe` com escolha de pasta/unidade e ZIP portátil (extraia todos os arquivos). Não há assinatura de produção configurada. Linux x64: `.deb` e `.tar.gz`. Fonte, capturas da interface e SHA256 estão incluídos nos arquivos da pré-versão.

A publicação exige os testes definidos no workflow. Testes Electron de autenticação e segundo plano são executados em runners Windows e Linux, mas não comprovam compatibilidade universal, visibilidade da bandeja em todas as configurações, inicialização automática na estação do usuário ou funcionamento de boot. Nenhum teste de congelamento físico é realizado.
