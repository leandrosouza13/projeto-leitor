# Supabase do MercadoFlow

## Antes de começar

Para a versão atual do app, execute [`cloud-schema.sql`](./cloud-schema.sql), **não** `schema.sql`. O arquivo `schema.sql` é uma estrutura relacional antiga de referência e não é usado pela aplicação atual.

O esquema cloud cria um espaço de trabalho por empresa, membership, um estado JSON versionado com controle de concorrência, políticas RLS e o bucket privado `mercadoflow-documents`. As lojas, produtos, regras, compras e históricos do app ficam dentro do estado daquele workspace; documentos novos são gravados separadamente no Storage.

## Instalação no projeto Supabase

1. No Dashboard, abra o projeto e vá para **SQL Editor → New query**.
2. Abra `cloud-schema.sql` neste repositório, copie todo o conteúdo, cole no SQL Editor e clique **Run**. O script cria as tabelas, funções, políticas e bucket usados pela versão cloud.
3. Em **Authentication → Providers**, mantenha habilitado **Email**.
4. Em **Authentication → URL Configuration**, configure a URL publicada do MercadoFlow como **Site URL** e inclua-a na lista de **Redirect URLs**. Para desenvolvimento local, inclua também a URL local que o servidor de desenvolvimento usa.
5. Decida se a confirmação de e-mail ficará habilitada. Se ficar, o usuário precisará confirmar o endereço antes de entrar.
6. Depois do primeiro deploy, abra o endereço publicado, crie a conta, confirme o e-mail se solicitado e crie o workspace. É possível escolher migrar os dados salvos neste navegador.

O cliente do app usa a URL e a chave `anon`/publishable em [`../supabase-config.js`](../supabase-config.js). A chave pública é esperada no frontend: RLS e as funções do banco continuam obrigatórias para proteger os dados. **Nunca coloque `service_role`, chaves secretas, senha do banco ou tokens em arquivos do frontend.**

## Publicação no GitHub Pages

O workflow [`../../.github/workflows/deploy-mercadoflow.yml`](../../.github/workflows/deploy-mercadoflow.yml) publica somente a pasta do MercadoFlow. No repositório GitHub, abra **Settings → Pages** e selecione **GitHub Actions** como fonte. Depois de um push para `master` (ou execução manual do workflow), consulte **Actions → Deploy MercadoFlow** para obter a URL publicada.

Cadastre essa URL em **Authentication → URL Configuration** antes de criar contas. O app precisa ser aberto por HTTPS/servidor web; abrir `index.html` diretamente como arquivo local não é uma implantação adequada para autenticação e links de confirmação.

## Comportamento e limites

- A sessão é gerida pelo Supabase Auth. Usuários sem workspace podem criar um; membros conseguem selecionar um workspace autorizado.
- RLS limita a leitura ao workspace de que a conta é membro; gravações passam pela função `mercadoflow_save_workspace_state`, que verifica a permissão e a revisão esperada.
- Se outro navegador gravar primeiro, o app bloqueia novas gravações nessa sessão e pede para recarregar, evitando sobrescrever silenciosamente a versão mais recente.
- O estado completo do app é salvo como um documento JSON por workspace, com limite de 10 MB. Isso permite colocar o protótipo na nuvem, mas não substitui um modelo relacional normalizado para escala ou colaboração simultânea intensa.
- Os arquivos de notas importados depois da ativação cloud vão ao bucket privado. Documentos antigos guardados somente no IndexedDB deste navegador não são migrados automaticamente e não estarão disponíveis em outros dispositivos.
- Criar o banco não migra dados locais sozinho. No primeiro cadastro, use a opção de importação para copiar o estado do navegador para o workspace cloud.

Antes de usar dados reais, teste isolamento entre contas, backups/restauração, recuperação de conta e os fluxos de nota fiscal e documentos.
