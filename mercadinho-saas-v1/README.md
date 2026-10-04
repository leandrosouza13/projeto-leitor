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
- Registro local de alterações de custo e preço de venda
- Link por produto para consultar gráficos de evolução de preço e estoque, além das movimentações detalhadas
- Busca e paginação nas listas extensas de produtos, precificação, abastecimento e estoque central; históricos detalhados de produto também são paginados
- Importação de produtos por CSV
- Importação de planograma em Excel/CSV, com prévia, seleção dos campos e correspondência por ID, SKU/EAN ou nome exato
- Persistência local com `localStorage`
- Módulos de preço e estoque mantidos como recursos secundários

## Lojas e estoque central

1. Abra **Lojas** para cadastrar uma unidade. O catálogo de produtos é compartilhado; cada unidade passa a ter seus próprios saldos, custos e preços.
2. Use o seletor **Unidade** no cabeçalho para mudar o contexto de operação. Vendas, cadastro/edição, abastecimento e históricos ficam associados ao local selecionado.
3. No dashboard, escolha **Esta unidade** ou **Consolidado**. A visão consolidada soma os indicadores, mas mostra os saldos de cada loja e do estoque central separadamente.
4. Em **Receber compra**, escolha se a nota deve abastecer uma loja ou o **Estoque central**.
5. Em **Estoque central**, escolha produto, quantidade e loja de destino. A transferência reduz o central e aumenta somente o saldo da loja escolhida; não altera os custos nem os preços locais.

As lojas não são excluídas para preservar compras e transferências históricas. O estoque central é um local reservado para distribuição. O registro de vendas e as rotinas de caixa ficam fora do escopo porque já são atendidos pelo sistema de gestão/POS do mercadinho.

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

Na primeira utilização de **Precificação** (ou ao analisar o planograma), configure a margem desejada e os percentuais de impostos, taxas e perdas para a unidade ativa. Depois de configuradas, as regras deixam de aparecer nos fluxos de precificação e planograma; para alterá-las, abra **Configurações** no menu. Os parâmetros ficam separados por unidade neste navegador. Impostos e taxas incidem sobre o preço de venda; perdas são calculadas sobre o custo de compra.

`preço sugerido = custo de compra × (1 + perdas) ÷ (1 − margem − impostos − taxas)`

Se a soma da margem, dos impostos e das taxas for igual ou superior a 100%, a configuração é rejeitada porque não há preço matematicamente viável. As recomendações não alteram preços automaticamente.

## Como executar

Não precisa instalar nada.

1. Abra a pasta no VS Code.
2. Abra `index.html` no navegador. A aplicação inicia no dashboard; use o menu lateral para acessar os módulos.
3. Para OCR de PDF/foto, é necessária conexão à internet para carregar as bibliotecas do navegador.

Para uma experiência melhor no VS Code, use a extensão **Live Server**.

## Importação CSV

O arquivo deve usar estas colunas:

```text
nome,sku,categoria,fornecedor,custo,preco,estoque,minimo,desejado,venda_dia
```

## Importação do planograma

No dashboard ou na tela **Receber compra**, selecione o arquivo Excel (`.xlsx`/`.xls`) ou CSV/TSV e analise a prévia antes de aplicar. Uma planilha do Google Sheets pode ser exportada para Excel ou CSV; PDF deve ser convertido em tabela primeiro. O leitor de Excel é carregado sob demanda pela internet. No dashboard, os campos de estoque e preço são aplicados à unidade selecionada no seletor superior.

Com as regras de preço configuradas, a prévia compara cada produto relacionado, o preço no arquivo e o preço recomendado a partir do custo daquela unidade. As diferenças ficam selecionadas inicialmente; revise a seleção antes de **Atualizar catálogo** ou **Baixar planograma**. A exportação mantém as demais colunas e abas da planilha Excel e acrescenta a coluna de preço caso não exista. A exportação CSV/TSV preserva o delimitador. Recomendações sem custo ou sem correspondência única não são exportadas.

O importador reconhece os cabeçalhos do planograma recebido, incluindo ID do produto, código, descrição, categoria, preço, código de barras, capacidade de mola, mínimo crítico, nível de par, quantidade atual e tipo. O ID externo é guardado para facilitar as próximas atualizações. A correspondência também considera SKU/EAN e, como último recurso, nome exato único; linhas ambíguas ou com identificadores repetidos ficam de fora da aplicação.

Os campos podem ser selecionados individualmente na prévia. A quantidade atual vem desmarcada por padrão, o custo de compra nunca é importado e produtos ausentes no arquivo não são excluídos nem desativados. Alterações no preço de venda e no estoque selecionado são registradas no histórico/auditoria local. O protótipo ainda guarda os dados somente neste navegador.

## Histórico de preços e estoque

Na tela **Produtos**, abra **Ver evolução de preço e estoque** no produto desejado para consultar gráficos e tabelas de movimentações sem aumentar a lista principal. Os gráficos mostram os últimos 40 pontos; as tabelas detalhadas ficam recolhidas e podem ser abertas na mesma janela. Novas entradas de preço identificam valor anterior/novo, custo, margem estimada, origem e operador local. Alterações manuais, recomendações, importações e preço inicial são registradas.

O histórico de estoque registra edições, compras, importações e transferências. Registros antigos de movimentações de venda, criados antes de sua remoção do app, podem continuar visíveis no histórico local para preservar dados existentes. Como os dados são locais, alterações anteriores que não deixaram uma trilha de auditoria não podem ser reconstruídas com precisão; nesses casos, o gráfico começa quando os registros estão disponíveis.

## Limitações desta versão

Esta é uma aplicação local de validação, não um SaaS multiusuário pronto para produção. Dados estruturados ficam no `localStorage`, e documentos originais no IndexedDB do mesmo navegador. As lojas e os estoques separados existem somente neste navegador; não há sincronização entre dispositivos, backup, autenticação, controle de acesso ou trilha de auditoria no servidor.

## Banco de dados remoto (Supabase)

O esquema PostgreSQL para guardar lojas, usuários, produtos, fornecedores, notas, itens, documentos, custos, preços e auditoria está preparado em [`supabase/schema.sql`](./supabase/schema.sql). Veja [`supabase/README.md`](./supabase/README.md) para a configuração.

**O banco ainda não está conectado a esta aplicação.** Para ligar ao projeto real, é necessário criar o projeto Supabase, executar o SQL, configurar autenticação e implementar a camada de dados. Nenhum dado local será migrado automaticamente. Não compartilhe nem coloque a chave `service_role` no navegador.

Ainda não há:

- Conexão da aplicação ao Supabase
- Login e usuários/permissões
- Banco de dados compartilhado entre dispositivos ou sincronização das lojas
- Integração direta com TouchPay
- Validação de XML contra schemas oficiais
- OCR robusto para todos os layouts e fotos
- Preços da concorrência, elasticidade ou despesas operacionais na recomendação

## Próxima evolução recomendada

1. Testar com XML e DANFEs reais de fornecedores diferentes e validar a extração/cálculos.
2. Ajustar o motor de correspondência usando o catálogo real, EAN e códigos de cada fornecedor.
3. Provisionar o projeto Supabase e validar o modelo multiunidade, autenticação, permissões RLS e armazenamento com usuários de teste.
4. Implementar e testar a camada remota de dados, migração/importação de dados locais e sincronização concorrente entre dispositivos.
5. Configurar backups, recuperação, domínio, monitoramento e implantação antes de receber dados comerciais reais.
6. Avaliar OCR gerenciado somente se a qualidade local não atender à operação.
