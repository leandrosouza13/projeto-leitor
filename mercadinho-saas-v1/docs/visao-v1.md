# Visão funcional — recebimento de compras

## Foco da primeira versão

O trabalho principal é receber compras a partir de uma NF, organizar a base única de produtos, identificar incertezas antes de alterar o catálogo e preservar o histórico de custo. Preço, venda e abastecimento são funções secundárias.

## Fluxo de recebimento

1. O operador seleciona um XML, PDF ou foto.
2. A aplicação extrai fornecedor, CNPJ, número, série, chave, data, totais e itens.
3. Cada item é comparado com o catálogo e classificado como match confirmado, provável, possível duplicidade, novo produto ou dados insuficientes.
4. O operador corrige os dados, escolhe o produto ou candidato, cria produto quando não há semelhante, ou ignora a linha.
5. A chave NF-e válida é verificada contra compras anteriores.
6. Ao confirmar, a compra e suas linhas são registradas, estoque e custo atual são atualizados, histórico e auditoria são acrescentados e o documento original é preservado.

Nenhuma correspondência provável ou duplicada é aplicada silenciosamente. A chave de acesso impede importar a mesma NF-e mais de uma vez. A criação é permitida apenas quando não há candidatos suficientemente semelhantes; conflitos exigem selecionar um produto ou ignorar o item.

## Motor de correspondência

Prioridade:

1. EAN/GTIN cadastrado
2. Código associado ao CNPJ do fornecedor
3. SKU/código cadastrado
4. Descrição normalizada
5. Similaridade textual com penalização de conflito de peso ou volume

Descrição normalizada não ignora tamanho. Por exemplo, Coca-Cola 350 ml e Coca-Cola 2 l não são sugeridos como o mesmo produto. Similaridade serve para apontar candidatos, não para tomar decisão. O match confirmado por código ou descrição exata continua editável antes da confirmação da compra.

Percentuais exibidos para descrição são pontuações heurísticas de similaridade textual, não probabilidades estatísticas calibradas.

## Dados extraídos e custo

Do XML são lidos número, série, CNPJ/nome do fornecedor, data, chave, total da nota e campos dos itens: código, GTIN, descrição, NCM, CFOP, quantidade, unidade, valores e descontos disponíveis.

O custo unitário usa os valores do item, frete, seguro e outras despesas discriminadas menos descontos, dividido pela quantidade comercial. Nem todo DANFE deixa os mesmos campos disponíveis; confira a conferência, sobretudo quando despesas aparecem somente no total da nota. PDF e foto dependem de OCR e não garantem precisão.

## Compras, produto e histórico

Cada compra armazena loja lógica, fornecedor/CNPJ, número/série, chave, data de emissão/entrada, total, origem do arquivo, documento original, operador e itens. Cada linha guarda referência ao produto, código fornecedor, EAN, descrição/NCM/CFOP, quantidade, unidade e custo.

A confirmação:

- soma quantidades ao estoque;
- atualiza custo de aquisição sem alterar o preço de venda;
- registra o custo anterior, o novo, fornecedor e origem;
- mantém um log de alteração local.

Menor, maior e custo médio ponderado são calculados sobre o histórico. O comparativo por fornecedor mostra custo mais recente, mínimo, máximo e média ponderada. Preço de venda mantém histórico separado.

## Entrada de arquivos e privacidade

XML é preferido. PDF com texto selecionável é extraído localmente; imagem e PDF digitalizado usam OCR no dispositivo. Bibliotecas são carregadas de CDNs e precisam de internet, mas o documento não é enviado ao OCR. O layout ou a qualidade podem resultar em campos errados; todos devem ser revisados.

## Limites da versão

Produtos e registros estruturados ficam no `localStorage`; o documento original fica no IndexedDB do navegador. A aplicação requer ambos para confirmar uma compra e não oferece backup ou sincronização. Não é ainda um SaaS multiusuário: não há autenticação, isolamento no servidor, gestão de várias lojas, banco central, validação contra os schemas fiscais oficiais ou trilha de auditoria remota. O operador é identificado localmente como “Operador local”.

## Próximos passos

- Validar XML, PDF, foto, custo e OCR usando notas reais de fornecedores diferentes.
- Revisar as faixas de confiança e normalização com o catálogo real.
- Migrar as entidades para banco relacional com tenant/loja, autenticação, transações e cópias de segurança.
- Persistir documentos e histórico no servidor com trilha de auditoria e política de acesso.
- Priorizar somente depois a automação de vendas, pagamentos e abastecimento.
