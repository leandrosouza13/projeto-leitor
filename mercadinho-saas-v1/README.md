# MercadoFlow — Recebimento inteligente para mercadinhos

Protótipo local para receber compras, manter um catálogo único e acompanhar a evolução do custo por produto e fornecedor. O fluxo principal é importar uma nota fiscal, revisar as correspondências e só então registrar a compra.

## O que funciona nesta versão

- Dashboard inicial com indicadores resumidos, até cinco prioridades de estoque e acesso rápido às ações operacionais
- Detalhes de estoque por unidade e compras recentes recolhidos para manter o resumo principal compacto
- Cadastro e troca de lojas com catálogo compartilhado e estoque, custo e preço separados por local
- Dashboard individual ou consolidado, com saldos identificados por loja e estoque central
- Recebimento de compras direcionado a uma loja ou ao estoque central
- Transferência do estoque central para as lojas, com validação de saldo e histórico
- Análise e atualização do planograma em **Receber compra**, com prévia e seleção de campos
- Navegação para visão geral, recebimento de compras, produtos, abastecimento, estoque central, lojas e precificação
- Importação de NF-e por XML e tentativa de leitura de PDF/foto
- Extração de chave, fornecedor/CNPJ, número, série, data, total e itens no XML
- Classificação dos matches: confirmado, provável, possível duplicidade, novo ou dados insuficientes
- Correspondência por EAN/SKU, código relacionado ao CNPJ do fornecedor e descrição normalizada com tamanho/volume
- Comparação do custo de cada NF com o produto relacionado e prévia do impacto no preço recomendado
- Conferência editável; exige resolução de todos os itens antes de registrar
- Bloqueio de nota repetida pela chave de acesso válida
- Registro de compras e cópia do documento original em IndexedDB
- Atualização do custo e entrada no estoque sem alterar automaticamente o preço de venda
- Histórico de compra, variação do custo e comparativo por fornecedor
- Indicadores de custo atual, anterior, menor, maior e médio ponderado no catálogo
- Registro de alterações de custo e preço de venda
- Link por produto para consultar gráficos de evolução de preço e estoque, além das movimentações detalhadas
- Busca e paginação nas listas extensas de produtos, precificação, abastecimento e estoque central; históricos detalhados de produto também são paginados
- Importação de produtos por CSV
- Importação de planograma em Excel/CSV, com prévia, seleção dos campos e correspondência por ID, SKU/EAN ou nome exato
- Cópia local com `localStorage` e sincronização do workspace pelo Supabase
- Módulos de preço e estoque mantidos como recursos secundários

## Lojas e estoque central

1. Abra **Lojas** para cadastrar uma unidade. O catálogo de produtos é compartilhado; cada unidade passa a ter seus próprios saldos, custos e preços.
2. Use o seletor **Unidade** no cabeçalho para mudar o contexto de operação. Recebimentos, cadastro/edição, abastecimento e históricos ficam associados ao local selecionado.
3. No dashboard, escolha **Esta unidade** ou **Consolidado**. A visão consolidada soma os indicadores, mas mostra os saldos de cada loja e do estoque central separadamente.
4. Em **Receber compra**, escolha se a nota deve abastecer uma loja ou o **Estoque central**.
5. Em **Estoque central**, escolha produto, quantidade e loja de destino. A transferência reduz o central e aumenta somente o saldo da loja escolhida; não altera os custos nem os preços locais.

Lojas adicionais podem ser excluídas em **Lojas**; isso remove os registros e o estoque daquele local, mas preserva o catálogo compartilhado. A loja principal e o estoque central são fixos. O registro de vendas e as rotinas de caixa ficam fora do escopo porque já são atendidos pelo sistema de gestão/POS do mercadinho.

## Organização das telas

**Visão geral** prioriza indicadores e alertas; os dados por unidade e compras recentes ficam recolhidos. O acesso à análise de planograma leva à tela **Receber compra**. Nas telas com catálogos ou listas extensas, use a busca e a paginação para localizar os registros sem exibir toda a lista de uma vez. Históricos e opções avançadas ficam recolhidos até serem necessários.

Na barra lateral, clique no ícone **MF** para voltar à Visão geral. No cartão da unidade na parte inferior, clique para trocar rapidamente entre lojas quando houver mais de uma cadastrada.

## Receber uma compra

1. Selecione XML, PDF ou imagem da nota.
2. Revise os campos extraídos e a classificação de cada produto.
3. Confirme o match, escolha outro produto, crie um produto quando não houver candidato ou ignore uma linha.
4. Confirme a nota para registrar a compra, adicionar a quantidade ao estoque, atualizar o custo e guardar o documento original.

Uma correspondência incerta não atualiza o catálogo automaticamente. Produtos com nomes parecidos e volume/peso incompatível não são tratados como o mesmo item.

### Extração e correspondência

- XML é a fonte mais confiável. PDF com texto selecionável tenta extrair o conteúdo; fotos e páginas digitalizadas usam OCR local.
- PDF/foto dependem da qualidade e do leiaute. A chave válida é obrigatória; se o OCR não a encontrar, pode ser inserida manualmente.
- EAN/SKU e código previamente associado ao CNPJ do fornecedor têm prioridade. Nomes normalizados e volumes ajudam a sugerir candidatos, mas matches prováveis e duplicidades precisam de ação humana.
- Se o código da linha da nota coincidir com o SKU/ID do planograma, o sistema apresenta a correspondência como provável e pede confirmação. Após confirmar uma compra, o código do fornecedor é relacionado ao CNPJ e poderá identificar diretamente o produto nas próximas notas.
- Antes de registrar, a conferência mostra o custo cadastrado, o novo custo da nota, a variação e o preço recomendado. A compra confirmada aparece em **Precificação > Compras que impactam a precificação** e recalcula a recomendação para o mesmo produto; o preço de venda não é alterado sem decisão do operador.
- Percentuais de confiança de nomes são pontuações heurísticas de similaridade textual, não probabilidades estatisticamente calibradas.
- O custo é estimado pelo total do item mais frete/seguro/outras despesas identificadas, menos desconto, dividido pela quantidade. Confira especialmente notas cujo frete foi informado somente no total.
- Importar a mesma chave novamente é bloqueado. A confirmação não altera automaticamente o preço de venda.

### Precificação

Na primeira utilização de **Precificação** (ou ao analisar o planograma), configure a margem desejada e os percentuais de impostos, taxas e perdas para a unidade ativa. Depois de configuradas, as regras deixam de aparecer nos fluxos de precificação e planograma; para alterá-las, abra **Configurações** no menu. Os parâmetros ficam separados por unidade no workspace da empresa. Impostos e taxas incidem sobre o preço de venda; perdas são calculadas sobre o custo de compra.

`preço sugerido = custo de compra × (1 + perdas) ÷ (1 − margem − impostos − taxas)`

Se a soma da margem, dos impostos e das taxas for igual ou superior a 100%, a configuração é rejeitada porque não há preço matematicamente viável. As recomendações não alteram preços automaticamente.

## Como executar

Não precisa instalar dependências. Para usar a versão conectada, o projeto deve estar publicado em HTTPS ou servido por um servidor web local; abrir `index.html` diretamente como arquivo não funciona com autenticação.

1. Execute [`supabase/cloud-schema.sql`](./supabase/cloud-schema.sql) no SQL Editor e configure as URLs de autenticação conforme o [guia do Supabase](./supabase/README.md).
2. Em desenvolvimento, abra a pasta no VS Code e inicie um servidor local pela extensão **Live Server**; depois acesse o endereço HTTP gerado e entre ou crie uma conta.
3. Para publicar, habilite GitHub Actions em **Settings → Pages** e envie as alterações para `master`; o workflow publica o app e informa o endereço em **Actions**.
4. Para OCR de PDF/foto e outros recursos carregados sob demanda, é necessária conexão à internet.


## Importação CSV

O arquivo deve usar estas colunas:

```text
nome,sku,categoria,fornecedor,custo,preco,estoque,minimo,desejado,venda_dia
```

## Importação do planograma

No dashboard ou na tela **Receber compra**, selecione o arquivo Excel (`.xlsx`/`.xls`) ou CSV/TSV e analise a prévia antes de aplicar. Uma planilha do Google Sheets pode ser exportada para Excel ou CSV; PDF deve ser convertido em tabela primeiro. O leitor de Excel é carregado sob demanda pela internet. No dashboard, os campos de estoque e preço são aplicados à unidade selecionada no seletor superior.

Com as regras de preço configuradas, a prévia compara cada produto relacionado, o preço no arquivo e o preço recomendado a partir do custo daquela unidade. As diferenças ficam selecionadas inicialmente; revise a seleção antes de **Atualizar catálogo** ou **Baixar planograma**. A exportação mantém as demais colunas e abas da planilha Excel e acrescenta a coluna de preço caso não exista. A exportação CSV/TSV preserva o delimitador. Recomendações sem custo ou sem correspondência única não são exportadas.

O importador reconhece os cabeçalhos do planograma recebido, incluindo ID do produto, código, descrição, categoria, preço, código de barras, capacidade de mola, mínimo crítico, nível de par, quantidade atual e tipo. O ID externo é guardado para facilitar as próximas atualizações. A correspondência também considera SKU/EAN e, como último recurso, nome exato único; linhas ambíguas ou com identificadores repetidos ficam de fora da aplicação.

Os campos podem ser selecionados individualmente na prévia. A quantidade atual vem desmarcada por padrão, o custo de compra nunca é importado e produtos ausentes no arquivo não são excluídos nem desativados. Alterações no preço de venda e no estoque selecionado são registradas no histórico/auditoria do workspace.

## Histórico de preços e estoque

Na tela **Produtos**, abra **Ver evolução de preço e estoque** no produto desejado para consultar gráficos e tabelas de movimentações sem aumentar a lista principal. Os gráficos mostram os últimos 40 pontos; as tabelas detalhadas ficam recolhidas e podem ser abertas na mesma janela. Novas entradas de preço identificam valor anterior/novo, custo, margem estimada, origem e operador local. Alterações manuais, recomendações, importações e preço inicial são registradas.

O histórico de estoque registra edições, compras, importações e transferências no workspace. Movimentações antigas de venda, criadas antes da remoção desse módulo, podem permanecer nos dados históricos para preservar registros existentes. Alterações passadas que não deixaram uma trilha de auditoria não podem ser reconstruídas; nesses casos, os gráficos começam no primeiro registro disponível.

## Limitações desta versão

O app usa autenticação Supabase e sincroniza o estado da empresa na nuvem. O `localStorage` continua servindo de cópia local/migração, e documentos antigos guardados no IndexedDB não são copiados automaticamente ao Storage. As operações são protegidas por RLS e controle de revisão, mas mudanças concorrentes no mesmo workspace exigem recarregar a sessão.

## Banco de dados remoto (Supabase)

O app está integrado ao Supabase para autenticação, sincronização do estado do workspace com controle de revisão e armazenamento privado de novos documentos. A configuração pública está em [`supabase-config.js`](./supabase-config.js); a chave `anon`/publishable pode ser pública, desde que RLS esteja ativa. Nunca exponha `service_role`.

Antes de usar, execute [`supabase/cloud-schema.sql`](./supabase/cloud-schema.sql) no SQL Editor e configure as URLs de autenticação. O arquivo [`supabase/schema.sql`](./supabase/schema.sql) é um esquema legado de referência e não deve ser executado para esta integração. Veja o [guia de configuração](./supabase/README.md).

O estado é salvo como JSON por workspace, limitado a 10 MB; esse desenho permite sincronizar o protótipo, mas não é um modelo relacional otimizado para escala ou colaboração simultânea intensa. Conflitos de revisão são rejeitados para evitar sobrescrita silenciosa. O app pode ser publicado pelo [workflow GitHub Pages](../.github/workflows/deploy-mercadoflow.yml); habilite GitHub Actions como fonte em Settings → Pages.

Ainda não há:

- Interface para convidar e administrar membros da equipe
- Integração direta com TouchPay
- Validação de XML contra schemas oficiais
- OCR robusto para todos os layouts e fotos
- Preços da concorrência, elasticidade ou despesas operacionais na recomendação

## Próxima evolução recomendada

1. Executar o esquema cloud no projeto Supabase e validar autenticação, RLS, importação local, sincronização e Storage com contas de teste.
2. Habilitar GitHub Pages como fonte **GitHub Actions**, configurar Site URL/Redirect URLs e conferir o primeiro deploy.
3. Testar com XML e DANFEs reais de fornecedores diferentes e validar a extração/cálculos.
4. Ajustar o motor de correspondência usando o catálogo real, EAN e códigos de cada fornecedor.
5. Configurar backups, recuperação, domínio e monitoramento antes de receber dados comerciais reais.
6. Avaliar OCR gerenciado somente se a qualidade local não atender à operação.
