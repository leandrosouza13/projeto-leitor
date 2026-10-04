# Banco de dados Supabase

O esquema PostgreSQL para o MercadoFlow está em [`schema.sql`](./schema.sql). Ele prepara dados relacionais para várias lojas, com Row Level Security (RLS) e um bucket privado para documentos de compras.

## O que o esquema cria

- Lojas e associação de usuários por função
- Configurações por loja, incluindo margem, impostos, taxas e perdas para precificação
- Fornecedores com CNPJ
- Catálogo e identificadores EAN/SKU/código por fornecedor, ID do planograma, capacidade de mola e tipo de produto
- Compras, itens, chave da NF-e e metadados do documento
- Histórico de custos e preços de venda
- Vendas e log de alterações
- Bucket privado de documentos originais
- Funções transacionais para criar loja e confirmar compra

## Configuração

1. Crie um projeto no Supabase e guarde URL e chave pública (`anon`/publishable) apenas na configuração do cliente.
2. No painel **SQL Editor**, execute `schema.sql`.
3. Habilite cadastro/autenticação de usuários no painel Supabase.
4. Crie uma conta; chame `create_store('Nome da loja')` enquanto autenticado para criar a loja inicial e tornar essa conta proprietária.
5. Guarde o UUID da loja e associe os documentos no bucket `purchase-documents` usando o caminho `<store_uuid>/<purchase_uuid>/<nome-do-arquivo>`.

**Nunca coloque a chave `service_role` no navegador nem a envie ao chat.** A chave pública do cliente não é uma credencial de administrador; as políticas RLS e o usuário autenticado limitam o acesso à loja. Antes de usar com dados reais, revise usuários, backups, retenção de notas e políticas de acesso do projeto.

## Importante: ainda não conectado

Este SQL cria a estrutura quando executado em um projeto Supabase, mas não cria o projeto remoto nem conecta a aplicação por conta própria. O MercadoFlow continua usando o armazenamento local até receber configuração de projeto, autenticação e uma camada de dados Supabase. Nenhuma informação atual do navegador é enviada automaticamente.

A função `confirm_purchase(purchase_data, item_data)` registra uma compra de forma transacional: fornecedor, cabeçalho, itens, custo, estoque, histórico e auditoria são confirmados juntos ou revertidos juntos. A chave de acesso é única por loja; uma NF-e duplicada é rejeitada pelo banco mesmo que duas sessões tentem importá-la ao mesmo tempo.

`store_settings` guarda os componentes do cálculo de preço com validações de faixa e impede uma soma de margem, imposto e taxas que não permita preço matematicamente viável. O esquema remoto atual ainda associa os parâmetros e o saldo de produto ao tenant `stores`; ele não representa as unidades/estoque por local do modelo atual no navegador. Antes da integração comercial, é necessário modelar e testar filiais/de depósitos como entidades próprias e vincular estoque, preços, compras e permissões ao local correto.
