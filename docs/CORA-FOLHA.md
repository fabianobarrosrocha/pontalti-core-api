# Integração Cora: conta e folha

Implementação de 16/09/2026, correspondente à base bancária e à primeira versão da folha da proposta no diretório pai. Recebíveis, boletos de fornecedores, tributos, cartões e notas fiscais continuam nas próximas etapas.

## O que está disponível

- Menu **Financeiro** para administradores: dados da conta, saldo, extrato paginado e folhas.
- Conta bancária por funcionário, vinculada ao nome e CPF do cadastro, com edição versionada.
- Uma folha por categoria e competência, para cada conexão Cora. Categorias: salário, adiantamento, férias e bônus. Valor líquido informado individualmente, sem cálculo trabalhista.
- Data de pagamento e data/hora de envio distintas. Interpretação em `America/Sao_Paulo`, independente do fuso do navegador ou servidor.
- `auto_submit_to_cora=false`: administrador confere e libera os itens; `true`: processador libera quando chega o horário. **Ambos os modos dependem de aprovação no aplicativo Cora.**
- Revisão de valores, datas e contas antes de qualquer tentativa de envio. A revisão fica pausada e deve ser retomada pelo administrador.
- Pausa, cancelamento local de itens ainda não enviados, nova tentativa para falhas cujo envio não ficou incerto e consulta de resultado.
- Gastos registrados uma única vez após `COMPLETED` em produção. Estorno observado após a baixa gera gasto negativo vinculado; estorno observado antes de qualquer baixa não gera despesa líquida. Gastos bancários não podem ser editados/excluídos manualmente.
- Eventos de auditoria com autor, horário, valores da revisão e resultado. Consulta exibe os últimos 100 eventos; registros anteriores permanecem no banco.
- **Financeiro → Notificações**: histórico das atualizações de transferências confirmadas por consulta autenticada, filtros de situação/não lidas, paginação, link para a folha e leitura individual por administrador. A página mostra o total não lido e consulta novas notificações a cada 30 segundos.

## Ativação

A migration bancária foi aplicada à base **local** `factory-db` em 13/10/2026, preservando os registros existentes. As consultas autenticadas à Cora stage e produção foram verificadas. Uma instrução real de R$ 10,00 foi iniciada em produção no mesmo dia, com data solicitada de 14/10/2026. Após o usuário aprová-la no aplicativo, a consulta autenticada confirmou `SCHEDULED` em 13/10/2026 às 22:06, no fuso de São Paulo. A auditoria de 15/10 confirmou a mesma transferência como `COMPLETED`, com uma única tentativa e uma única despesa de R$ 10,00. A implantação em outras bases requer aplicar a migration abaixo.

1. Revise e aplique **uma vez** `prisma/manual-migrations/20260916_banking_payroll.sql` na base de destino antes de iniciar a nova versão da API. O SQL apenas adiciona os objetos financeiros, mantém os dados existentes e usa uma transação. Ele não contém alterações pendentes de outros módulos. O repositório não tinha histórico Prisma Migrate para esta base; por isso o arquivo é uma migration SQL manual, não um novo baseline.

   ```sh
   npx prisma db execute --file prisma/manual-migrations/20260916_banking_payroll.sql --schema prisma/schema.prisma
   npx prisma db execute --file prisma/manual-migrations/20261015_banking_notifications.sql --schema prisma/schema.prisma
   npx prisma generate
   ```

   O comando utiliza o `DATABASE_URL` do ambiente selecionado. Não use o script `npm run prisma`, que reseta a base.

2. Preencha as variáveis de `.env.banking.example` no ambiente da API. A conexão usa Integração Direta, certificado e chave mTLS, hosts fixos de stage/produção e token de curta duração. Não reutilize a conexão de stage para produção.
3. Configure um `AUTH_SECRET` forte no frontend e `PRIVATE_KEY` forte na API. O frontend deixou de usar um segredo de sessão fixo no código: sessões antigas precisarão de novo login. `CORE_API_URL` é uma variável apenas do servidor Next; padrão `http://localhost:3001/api/v1`.
4. Com os envios desabilitados, cadastre as contas dos funcionários e confira saldo/extrato. Crie uma folha manual em stage, habilite os dois flags `CORA_TRANSFERS_ENABLED=true` e `CORA_PAYROLL_WORKER_ENABLED=true`, reinicie a API, libere a folha e homologue a aprovação e os retornos no aplicativo Cora.
5. Se usar webhooks, configure no banco o recurso `transfer` com triggers `completed`, `canceled` e `refunded` apontando para `POST /api/v1/banking/webhook` da API pública. O cadastro desse endpoint na Cora ainda é uma configuração operacional. O polling funciona sem webhook.
6. Para produção, configure credenciais de produção e `CORA_ENV=production`. Confira a conta apresentada no painel antes de habilitar envio e processador. Folhas de stage ficam associadas à conexão anterior e não são enviadas pela conta nova.

Mantenha ao menos uma instância persistente da API executando. O ciclo do processador ocorre a cada 60 segundos, com lotes limitados; não é um serviço de execução no segundo exato. Se a API ficar indisponível, itens vencidos não são pagos automaticamente com outra data: a folha será pausada. Monitore a disponibilidade do processo e suas mensagens de erro.

## Configuração local em 13/10/2026

- PostgreSQL 18: container `pontalti-postgres-local`, em `127.0.0.1:55432`, usando o volume original da fábrica. O container antigo `factory-control` permanece parado; ambos usam o mesmo volume e não devem executar simultaneamente. A porta 5432 é usada por outro projeto.
- API: `http://localhost:3101/api/v1`, com `PORT=3101` no `.env`.
- Painel: executar `npm run dev -- --port 3100` em `factory-control`; seu `.env` aponta `CORE_API_URL` e `NEXT_PUBLIC_API_URL` para a API na porta 3101, e `AUTH_URL` para a porta 3100.
- Cora na API: após validar o conjunto de produção fornecido pelo usuário, o `.env` da API passou a usar `CORA_ENV=production`, `CORA_TRANSFERS_ENABLED=true` e `CORA_PAYROLL_WORKER_ENABLED=true`. A única folha existente é o teste manual autorizado de R$ 10,00, com `auto_submit_to_cora=false`. O marketplace continua usando suas credenciais stage.
- Backup do volume original e das configurações anteriores: `/Users/fabiano/pontalti-secrets/backups/`. A migration adicionou apenas os objetos financeiros, mantendo 8 funcionários, 4 usuários, 11 pedidos e 20 despesas existentes.

Para conferir a configuração, executar na API:

```sh
npm run cora:check
```

Esse comando verifica certificado/chave, autenticação, conta, saldo, bancos, extrato, listagem de transferências e presença das tabelas financeiras. Ele consulta a Cora e PostgreSQL sem emitir cobranças, enviar transferências ou executar o processador de folhas. Retorna código de saída 1 se alguma verificação falhar e omite segredos e números de conta do relatório.

Na configuração local acima, as sete verificações passaram. Também responderam HTTP 200 as rotas autenticadas de visão geral, conta, saldo, funcionários e folhas pelo proxy do painel, o proxy de clientes e a página `/finance`. Os builds da API e do painel passaram; o lint do proxy alterado passou, enquanto o lint geral do painel ainda apontou falhas nos módulos antigos. Relatório HTTP: `/tmp/pontalti-cora-config-http-20261013.json`.

### Obter e configurar credenciais de produção

As credenciais do marketplace configurado neste computador são de **stage**. Para movimentar dinheiro real, obter um conjunto de produção da conta pagadora. A documentação oficial aponta o menu **Conta → Integrações via APIs** no Cora Web/aplicativo; a modalidade utilizada neste projeto é **Integração Direta**. Selecionar o ambiente de produção e obter o client ID, `certificate.pem` e `private-key.key`. [Credenciais e ambientes](https://developers.cora.com.br/docs/client-credentials-int-direta), [menu de integrações](https://developers.cora.com.br/docs/instrucoes-iniciais).

A pasta `/Users/fabiano/pontalti-secrets/cora-prod/` foi preparada com permissão restrita. Salvar nela o certificado e a chave de produção. O arquivo `api.env` dessa pasta é um modelo privado, ainda com client ID vazio; **ele não é carregado automaticamente pela API**.

Depois de preencher o client ID e salvar os arquivos, atualizar somente as variáveis `CORA_*` do `.env` da API com a configuração de produção e executar `npm run cora:check`. Manter os dois flags de envio/processador desabilitados durante essa conferência. Confirmar a conta pagadora e as folhas existentes antes de habilitar o envio. As credenciais de stage do marketplace permanecem associadas à homologação da loja.

O teste autorizado de R$ 10,00 foi iniciado em produção com 1.000 centavos, uma referência e uma chave de idempotência persistidas antes do único POST. Foi criado um cadastro de teste na base local para exercitar a folha; os oito funcionários anteriores foram preservados. O favorecido e a conta Nubank foram informados pelo usuário. A Cora exige aprovação no aplicativo após iniciar a transferência. O retorno `INITIATED` indica essa pendência; somente uma consulta bancária com `COMPLETED` comprova a confirmação. [Fluxo de transferência](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-transfer%C3%AAncia).

O teste revelou duas diferenças em relação aos contratos simulados: a resposta de produção omite o campo opcional `holder.document.type`, que agora é inferido apenas quando há um CPF/CNPJ completo e idêntico ao esperado; a listagem aceita `CANCELLED` e `SCHEDULED`, enquanto `CANCELED` retorna HTTP 500. A sincronização usa os filtros aceitos. Foram mantidas as verificações de referência, identificador, valor, banco, agência, conta, tipo de conta e documento; divergências continuam impedindo a baixa.

A mesma instrução foi recuperada por consulta autenticada, sem reenvio, inicialmente como `INITIATED`, e passou a `SCHEDULED` após a aprovação no aplicativo. Na auditoria de 15/10, o banco confirmou `COMPLETED`; a base mantém uma tentativa, o mesmo identificador Cora e a despesa de folha nº 21, de R$ 10,00. O horário local de primeira confirmação consultada é 14/10 às 07:10:51 em São Paulo, não uma garantia do instante do crédito no banco de destino. Passaram 33 testes em PostgreSQL descartável com banco simulado e o build da API. O journal privado com as referências e dados bancários fica em `/Users/fabiano/pontalti-secrets/cora-prod/payroll-test-10-20261013.json`; o relatório atualizado da auditoria fica em `/tmp/pontalti-cora-audit-transfer-20261015.json`.

Para localizar a pendência, conferir a conta Pontalti no aplicativo e a área de aprovações. A orientação publicada pela Cora aponta o sininho no aplicativo e a área de aprovações no Cora Web. Perfis e limites são administrados em Conta → Perfis de acesso no aplicativo; pedidos sujeitos a aprovação são encaminhados ao titular ou perfil completo. [Aprovações](https://www.cora.com.br/blog/chegou-a-cora-web/), [perfis](https://www.cora.com.br/ajuda/artigo/como-defino-ou-altero-os-limites-de-meus-perfis-de-acesso/).

O usuário localizou a instrução no menu **Aprovações** do Cora Web e depois informou ter aprovado no aplicativo. A consulta autenticada de 14/10/2026 às 01:06 UTC confirmou a mesma TED de R$ 10,00 como `SCHEDULED`, sem avisos de sincronização; naquele momento não havia baixa. Em 15/10, o retorno passou a ser observado como `COMPLETED`, com uma folha, uma transferência e 21 despesas. O extrato confirmou débito de R$ 10,00 e tarifa de R$ 2,00 descrita como “Taxa de transferência via API”. A despesa bancária automática registra somente os R$ 10,00 da folha; a conciliação da tarifa ainda não está implementada. [Página das APIs](https://developers.cora.com.br/).

## Auditoria de cobertura em 15/10/2026

A integração é parcial. Foram comparados o código da fábrica e do marketplace com os recursos públicos documentados pela Cora e executadas consultas autenticadas nos dois ambientes. A fábrica utiliza produção; o marketplace continua em stage. Esta auditoria não iniciou pagamentos, emitiu/cancelou cobranças, cadastrou webhooks ou alterou credenciais. A sincronização local do teste apenas reconciliou a instrução existente com o retorno do banco.

| Recurso | Situação no projeto | Evidência ou pendência |
| --- | --- | --- |
| Autenticação mTLS e token | Implementada nos dois aplicativos | Consultas autenticadas bem-sucedidas em produção e stage; certificado de produção válido |
| Conta, saldo disponível e bancos | Implementados na fábrica | Diagnóstico bancário e rotas locais autenticadas responderam com sucesso; `blockedBalance` retornado pela Cora ainda não é exposto pelo adaptador |
| Extrato | Consulta implementada na fábrica | Consulta real e rota local HTTP 200; não importa movimentações para Gastos nem faz conciliação geral |
| TED para folha, agendamento e acompanhamento | Implementados e testados em produção | Teste autorizado de R$ 10,00 confirmado `COMPLETED`, uma tentativa, uma despesa; filtros `INITIATED`, `SCHEDULED`, `COMPLETED`, `CANCELLED` e `REFUNDED` consultados sem avisos |
| TED para fornecedores e reembolsos gerais | Sem módulo próprio | O fluxo atual exige funcionário cadastrado e envia a categoria `PAYROLL`; não há conta bancária de fornecedor no módulo |
| Cobrança por boleto e QR Code Pix | Implementada no marketplace em stage | GET da listagem e de uma cobrança existente HTTP 200, com PDF do boleto e Pix disponíveis; não há emissão equivalente no financeiro B2B da fábrica |
| Consulta global de cobranças | Não integrada ao painel | GET `/v2/invoices/` HTTP 200 nos dois ambientes; o marketplace consulta detalhes por ID, sem cliente de listagem global |
| Cancelamento de cobrança | Apenas adaptador no marketplace | `cancelInvoice` existe, mas não tem chamada de produto encontrada; nenhuma cobrança foi cancelada para testar |
| Carnês | Não implementados | API documentada para até 24 parcelas; não há adaptação, persistência ou interface |
| Juros, multas, descontos e lembretes bancários de cobrança | Não implementados no fluxo de emissão | O payload atual não envia essas opções; GET de notificações de uma cobrança existente em stage retornou HTTP 404, sem concluir que a API esteja indisponível em geral |
| Pagamento/agendamento de boletos de terceiros | Não implementado | GET `/payments/` HTTP 200 em produção e stage; os módulos legados `payments`/`invoices` da fábrica só gravam registros locais |
| Histórico de iniciações e cancelamento de pagamentos | Não integrados | A listagem de iniciações está acessível; não há cliente/rotas/interface bancários para essa jornada |
| DARF e GPS | Não implementados | APIs de iniciação documentadas; nenhum tributo foi iniciado ou pago nesta auditoria |
| Webhooks | Receptores existem; cadastro operacional ausente | GET `/endpoints/` retornou lista vazia nas duas conexões consultadas; a folha acompanha por polling, e o cadastro em produção exige um receptor público alcançável |
| NFS-e | Não implementada; disponibilidade consultada | Produção retornou `is_available=true`; consultas de CNAEs e códigos de serviço HTTP 200, com 461 códigos retornados; isso não confirma cadastro fiscal, certificado A1 ou emissão habilitada |
| Pré-cadastro e reporte de contas indicadas | Não implementados; outro cenário de produto | Documentação voltada a parceiros que indicam novas contas; não necessário para operar a conta própria da Pontalti |
| Simulação de recebimento | Utilitário exclusivo de stage | Existe no marketplace e há homologação anterior documentada; não executada novamente nesta auditoria |

As consultas de conta, saldo, extrato, cobranças, iniciações de pagamentos e endpoints retornaram HTTP 200 nos dois ambientes. Em produção, a consulta de cobranças estava vazia apenas para o intervalo de vencimentos de 01/09 a 31/10/2026; isso não prova ausência de cobranças fora do período. Na API local, as sete rotas consultadas — visão geral, conta, saldo, bancos, extrato, funcionários e folhas — retornaram HTTP 200 com autenticação administrativa.

As lacunas prioritárias são: cadastrar e validar webhooks públicos; conciliar tarifas e demais movimentações com os registros financeiros; oferecer pagamentos de fornecedores/boletos; disponibilizar cobranças B2B e homologar o marketplace em produção; depois acrescentar carnês, condições de cobrança e tributos. NFS-e deve ser tratada conforme a atividade da empresa: a API consultada documenta notas de serviço, não NF-e de mercadorias. A API pública de QR Code Pix documentada é de recebimento e informa que não permite transferência Pix de saída.

Um GET bem-sucedido comprova acesso à consulta testada, não aprovação de emissão, pagamento ou cancelamento em produção. Esses fluxos ausentes não foram exercitados com transações nesta auditoria. Os relatórios locais omitem documentos, contas completas e credenciais:

- `/tmp/pontalti-cora-api-audit-20261015.json`: consultas principais nos dois ambientes.
- `/tmp/pontalti-cora-api-audit-supplement-20261015.json`: consultas fiscais, notificações e lançamentos do teste no extrato.
- `/tmp/pontalti-cora-audit-transfer-20261015.json`: confirmação da instrução e despesa única.

Referências: [pagamento de boletos](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-pagamento), [histórico de iniciações](https://developers.cora.com.br/reference/lista-de-pagamentos), [DARF](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-pagamento-darf), [GPS](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-pagamento-gps), [carnês](https://developers.cora.com.br/reference/emiss%C3%A3o-de-boleto-parcelado-v2), [condições e notificações de cobrança](https://developers.cora.com.br/reference/emiss%C3%A3o-de-boleto-registrado-v2), [listagem de webhooks](https://developers.cora.com.br/reference/lista-de-endpoints), [disponibilidade fiscal](https://developers.cora.com.br/reference/disponibilidade-da-nota-fiscal-por-cliente), [emissão de NFS-e](https://developers.cora.com.br/reference/emiss%C3%A3o-nota-fiscal-servico), [limite de Pix de saída](https://developers.cora.com.br/reference/qr-code-pix-v2).

## Notificações financeiras e webhook de transferências

Implementados em 15/10/2026. Página local: `http://localhost:3100/finance/notifications`, disponível apenas para administradores no menu Financeiro. A leitura é individual: marcar um aviso como lido não altera a leitura dos outros administradores. “Marcar todas como lidas” preserva avisos que chegaram depois do instante em que a lista foi carregada.

O histórico é gerado na mesma transação que aplica o retorno autenticado da Cora. Uma atualização de estado por transferência gera no máximo uma notificação, inclusive sob consultas concorrentes e entregas repetidas. Os dados da lista incluem nome, valor e referência da folha; não incluem documento ou conta do favorecido. As notificações referem-se às transferências acompanhadas pelo módulo de folha da fábrica, não aos recebimentos do marketplace.

A migration aditiva `20261015_banking_notifications.sql` acrescenta `BankNotification` e `BankNotificationRead`, sem alterar os registros anteriores. Foi aplicada à base local após backup em `/Users/fabiano/pontalti-secrets/backups/factory-before-notifications-20261015.dump`. O pagamento real já confirmado de R$ 10,00 apareceu no histórico pela reconciliação da mesma instrução, mantendo uma transferência e uma despesa de folha.

O receptor `POST /api/v1/banking/webhook` aceita os eventos `transfer.completed`, `transfer.canceled` e `transfer.refunded`, valida os identificadores e registra um pedido de consulta somente para operações conhecidas da conexão atual. Um header não comprova pagamento: o processador confirma os dados via mTLS antes de atualizar a operação, registrar despesa ou gerar notificação. Os eventos pendentes são retomados após indisponibilidade do banco. O processador roda a cada minuto; as consultas periódicas continuam funcionando quando não há entrega de webhook.

O usuário confirmou que o sistema está somente local. **Nenhum webhook foi cadastrado na Cora nesta implementação**, porque `localhost` não é alcançável pelo banco. O histórico já funciona com as consultas periódicas. Quando houver uma URL HTTPS pública que encaminhe ao receptor da API, executar na pasta da API:

```sh
npm run cora:webhook -- --check
npm run cora:webhook -- --url https://sua-api.exemplo.com/api/v1/banking/webhook
```

Também é possível definir `CORA_WEBHOOK_URL` e executar `npm run cora:webhook`. O comando confere primeiro se o receptor responde ao POST de verificação, com uma referência inexistente que não gera notificação financeira. Depois lista os cadastros e cria somente a assinatura `resource=transfer`, `trigger=*` se não houver uma idêntica ativa; usa chave de idempotência estável e confirma o cadastro por nova listagem. Não remove assinaturas de outros sistemas. `--check` apenas consulta e não exige URL pública. O ambiente vem de `CORA_ENV`; não trocar as credenciais do marketplace para ativar este receptor da fábrica.

Validação desta entrega: 42 testes bancários passaram em PostgreSQL descartável com Cora interceptada, incluindo eventos falsos/duplicados, recuperação após falha do banco, concorrência, isolamento por conta e leitura por administrador. O receptor local recebeu o mesmo aviso de teste duas vezes e reconciliou a transferência real já concluída por consulta autenticada, sem acrescentar transferência, despesa ou notificação duplicada. Passaram o build da API, o build do painel e o lint dos cinco arquivos TypeScript/TSX alterados no painel. O TypeScript geral manteve 172 erros anteriores, sem diagnósticos nos arquivos alterados; o lint geral também segue com falhas em módulos anteriores. A tela foi conferida no navegador em desktop e celular, incluindo marcação de leitura e filtro vazio, sem rolagem horizontal. A entrega externa da Cora não foi homologada, pois falta o endereço público.

## Integridade e limites operacionais

- Cada item guarda destino, valor em centavos, referência própria e chave de idempotência antes do primeiro POST. O valor é convertido em Decimal apenas na criação do gasto.
- O processador grava `SUBMITTING` e um prazo de recuperação antes de chamar o banco. Outros processos não podem assumir esse item. Os bloqueios sempre seguem folha → transferência → funcionário.
- Timeout, interrupção ou resposta ambígua resultam em `UNKNOWN`. Não há reenvio automático desses itens. A consulta usa a referência e confere valor, banco, agência, conta e documento antes de aceitar o resultado. HTTP 408/409 e respostas inesperadas também são tratadas como incertas.
- Falhas definitivas de autenticação/limite podem ser tentadas novamente com a mesma instrução e chave. Recusas de negócio ficam `REJECTED`; não há recriação silenciosa do pagamento.
- Revisões após uma tentativa de envio não estão disponíveis nesta versão. Para recusa definitiva ou dados que precisem mudar após uma tentativa, trate a obrigação com o responsável financeiro e a Cora; não reutilize outra categoria/competência para contornar o bloqueio. Pagamentos complementares e substituição auditada de instruções são uma evolução pendente.
- Alterações no cadastro ou conta bancária antes do envio pausam a folha. A plataforma não aceita editar um destino já tentado. A aprovação manual e a revisão validam a versão exibida para evitar liberar dados alterados por outro administrador.
- Pausar/desabilitar automático retira itens ainda na fila, mas um envio já iniciado pode concluir. Cancelamento na plataforma não cancela uma transferência que já está no banco. A documentação pública de transferências não oferece um endpoint de cancelamento equivalente ao de pagamentos de boletos.
- Headers públicos de webhook não são prova de liquidação. Eles apenas registram uma solicitação de consulta autenticada de uma referência já conhecida. Eventos repetidos são deduplicados; recursos desconhecidos são ignorados e envios incertos são recuperados por polling.
- Polling acompanha itens pendentes e pagamentos concluídos nos últimos 30 dias. Webhook de uma referência conhecida ou consulta manual também pode localizar estornos posteriores. Ausência de uma instrução na listagem não muda seu status. Falha em algum filtro é informada como consulta parcial.
- A data em Gastos é o instante da confirmação consultada, pois a listagem pública não fornece uma data de liquidação distinta garantida. O painel identifica o horário como **confirmado em**.
- Stage nunca cria Gastos reais. O ambiente da folha não pode ser alterado e a conexão é vinculada a ambiente + client ID.
- A folha usa transferência bancária por conta (API de transferências/TED), não Pix de saída. Não há promessa de pagamento em fim de semana, feriado ou após horário de corte: a Cora precisa aceitar a data e a empresa precisa aprovar no aplicativo. Homologue essas condições com o banco.
- As credenciais permanecem no backend. Contas/CPFs são mascarados nas listas; o detalhe completo da conta só está disponível para administradores. Cadastro de usuários e alteração de nível de acesso também exigem administrador na API; as antigas exceções de autenticação por substring foram removidas.

## Testes

`npm run test:banking` usa um PostgreSQL real e um adaptador Cora simulado. A suíte recusa qualquer URL que não aponte para `localhost`/`127.0.0.1` e banco `pontalti_cora_test`, e exige `BANKING_TEST_DATABASE_URL` igual a `DATABASE_URL`. Ela **limpa esse banco de teste** entre os cenários.

Exemplo em um banco descartável já criado:

```sh
export BANKING_TEST_DATABASE_URL='postgresql://postgres:test-password@127.0.0.1:55433/pontalti_cora_test?schema=public'
DATABASE_URL="$BANKING_TEST_DATABASE_URL" npx prisma db push --skip-generate
DATABASE_URL="$BANKING_TEST_DATABASE_URL" npm run test:banking
```

Cobertura: modos manual/automático, horário futuro, dois processadores, timeout e recuperação, idempotência, confirmação e estorno concorrentes, stage, divergência de beneficiário/valor, mudança de conta, desligamento, troca de conexão, revisão concorrente, pausa/cancelamento, recuperação após interrupção, webhook falso e permissões HTTP. O adaptador HTTP também é verificado com interceptação integral de rede: certificado, token, headers, centavos, paginação, conflito e timeout.

O fluxo foi validado também no Chrome com API local e Cora simulada: conta/extrato, criação de folha manual, liberação, aprovação pendente, confirmação, layout de celular e restrições para usuário comum e visitante. Nenhuma transferência ou leitura de conta real foi realizada nessa verificação.

Na validação original, os checks gerais do repositório tinham falhas anteriores à integração: 18 erros TypeScript no serviço de mensagens da API, 172 no frontend e falhas de lint em módulos antigos. Em 13/10/2026, os imports e os tipos de IDs do serviço de mensagens foram alinhados ao repository/Prisma, e o build da API passou. O build de produção Next desabilita validação de tipos e lint; por isso seu sucesso sozinho não comprova ausência desses diagnósticos.

Resultado da validação local: 24 testes passaram; lint dos arquivos financeiros, autenticação e menu passou; nenhum novo diagnóstico TypeScript nas duas aplicações. O PostgreSQL e os servidores de teste foram encerrados após a validação. A configuração existente `output: standalone` também emitiu aviso de ausência de `sharp` ao carregar imagem na rota de login; esse problema de otimização de imagens permanece fora do módulo financeiro.

## Pagamentos a fornecedores e reembolsos — 15/10/2026

O menu **Financeiro → Pagamentos e reembolsos** permite cadastrar favorecidos PF/PJ, vincular funcionários ou fornecedores existentes e registrar outras pessoas/empresas sem criar funcionários fictícios. As contas são versionadas e associadas à conexão Cora. As listas mascaram documento e conta; o cadastro completo e os comprovantes exigem administrador.

O fluxo é: cadastrar favorecido → registrar solicitação → anexar comprovantes → aprovar solicitação → selecionar despesas e valores → preparar TED → conferir e liberar envio → aprovar no aplicativo Cora → acompanhar confirmação. A aprovação da solicitação não envia dinheiro; a preparação da TED reserva valores e também não inicia uma transferência. Somente a liberação explícita coloca a instrução na fila do processador.

- **Fornecedor:** o favorecido deve estar vinculado ao cadastro do fornecedor e ao CNPJ correspondente. Uma despesa existente deve pertencer ao mesmo fornecedor e não exigir reembolso.
- **Reembolso:** o destinatário é quem adiantou o dinheiro, independentemente de quem forneceu a compra. Exige ao menos um comprovante antes da aprovação. Pode atender funcionários, outras pessoas ou empresas.
- A solicitação pode criar uma despesa nova ou vincular uma existente. Uma despesa só pode ter uma obrigação financeira neste fluxo. Despesas já ligadas à confirmação da folha não podem ser reaproveitadas. Despesas antigas exigem conferência manual de pagamentos anteriores antes da vinculação; o sistema não presume um histórico de quitação externa.
- Cada TED pode agrupar parcelas de várias despesas aprovadas da mesma finalidade e do mesmo favorecido. Valores são inteiros em centavos, com limite de Int32 por instrução. Cada distribuição é persistida separadamente.
- Saldo disponível = total original − parcelas confirmadas − parcelas reservadas. Rascunhos, fila, envios, aprovações pendentes, agendamentos, falhas recuperáveis e resultados incertos mantêm reserva. Cancelamento local permitido ou recusa definitiva libera a reserva. `COMPLETED` transforma reserva em valor pago; `REFUNDED` reabre somente o saldo das parcelas daquela TED.
- Preparação, liberação, envio e confirmação usam o mesmo bloqueio transacional para impedir reservas concorrentes. O envio confere novamente saldos, cadastro, versão da conta e data. Uma confirmação tardia que invalide outra reserva impede seu envio e exige conferência.
- Timeout ou interrupção não provoca reenvio automático. A instrução persiste referência e chave de idempotência antes do primeiro POST. Nova tentativa de falha definitiva usa a mesma instrução/chave; resultado incerto precisa de consulta autenticada.
- A confirmação registra a quitação da despesa original, sem criar outro gasto. Estorno é registrado no histórico de pagamentos e reabre o saldo, sem apagar ou duplicar o gasto original. Despesas vinculadas não podem ser alteradas ou excluídas pela API de Gastos.
- Comprovantes ficam em armazenamento privado no PostgreSQL, limitados a três arquivos PDF/JPG/PNG de até 2 MB por solicitação, com conferência de formato e tamanho. O download é autenticado. Não existem URLs públicas de arquivos.
- Solicitações sem pagamentos reservados nem tentativas bancárias podem ser revisadas com controle de versão, atualizando a mesma despesa e voltando para análise. Comprovantes podem ser removidos antes da aprovação, com auditoria. Após uma tentativa bancária, os dados da obrigação permanecem preservados no histórico.
- A categoria opcional `category` da Cora é omitida para estes pagamentos; eles não são enviados como `PAYROLL`. A finalidade e a classificação da despesa continuam registradas internamente. O contrato e a aprovação no aplicativo seguem a [API de iniciação de transferência](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-transfer%C3%AAncia).

O cliente mTLS, as regras de conferência de destino e o processador existente são reutilizados. Os novos registros usam `BankBeneficiary`, `BankPayable`, `BankPayment` e `BankPaymentAllocation`; `BankTransfer` e `BankPayrollRun` preservam o fluxo original da folha. A lista de notificações aceita ambas as origens e abre a tela correspondente. Webhooks continuam solicitando somente uma nova consulta autenticada; o polling atende a instalação local sem URL pública.

Aplicar uma vez, depois das migrations anteriores e de backup:

```sh
npx prisma db execute --file prisma/manual-migrations/20261015_supplier_reimbursements.sql --schema prisma/schema.prisma
npx prisma generate
```

A migration é aditiva e transacional. Foi aplicada à base local depois de backup privado, preservando os quatro usuários, nove funcionários, 21 despesas, uma folha, uma transferência real e a notificação existente. As instruções novas só podem ser enviadas após sua liberação explícita; não foram criados pagamentos reais para validar esta implementação.

A suíte `npm run test:banking` executa os arquivos sequencialmente porque compartilham o banco descartável `pontalti_cora_test`. Os 61 testes incluem os cenários originais da folha e os novos testes de PF/PJ, comprovantes, divisão entre despesas, parcelas concorrentes, idempotência, cancelamento, timeout, recusa, estorno, mudança de conta, confirmação tardia, revisão de solicitações e permissões HTTP. O fluxo também foi exercitado no navegador com API real em banco de teste separado e adaptador Cora simulado: cadastro PF/PJ, fornecedor parcialmente pago, segunda parcela reservada, reembolso de terceiro com comprovante e notificação, revisão e substituição de comprovante, em desktop e celular. Nenhum gasto extra foi criado pela confirmação bancária nos testes.

## Referências consultadas

- [Integração Direta](https://developers.cora.com.br/docs/utiliza%C3%A7%C3%A3o-das-apis)
- [Iniciação de transferência](https://developers.cora.com.br/reference/inicia%C3%A7%C3%A3o-de-transfer%C3%AAncia)
- [Lista de transferências](https://developers.cora.com.br/reference/lista-de-transfer%C3%AAncia)
- [Dados da conta](https://developers.cora.com.br/reference/dados-de-conta), [saldo](https://developers.cora.com.br/reference/saldo-de-conta), [extrato](https://developers.cora.com.br/reference/consulta-de-extrato)
- [Cadastro de webhook e triggers](https://developers.cora.com.br/reference/cria%C3%A7%C3%A3o-de-endpoints), [notificação](https://developers.cora.com.br/reference/exemplo-de-post-da-notifica%C3%A7%C3%A3o)

## Saldo de clientes e aprovação de pedidos

O módulo `customer-finance` estende os clientes, pedidos e recebimentos existentes: o histórico de centavos é a fonte do saldo e projeta a dívida de produção em `Customers.debts`, na mesma transação. A primeira movimentação importa os débitos manuais existentes uma única vez como abertura. Testes `STAGE` possuem histórico separado, nunca alteram os débitos de produção nem registram pedidos físicos na fábrica.

O contrato JSON e os endpoints estão documentados em `src/modules/v1/customer-finance/contracts.ts`. A API administrativa exige JWT de administrador; a integração interna da loja exige `CUSTOMER_FINANCE_INTERNAL_TOKEN` privado, com pelo menos 32 caracteres. Um CPF informado na loja não autoriza acesso a um cadastro anterior: o vínculo entre UUID da loja e cliente existente fica pendente de conferência administrativa. Clientes e documentos duplicados não são mesclados automaticamente.

Pedidos com saldo suficiente são confirmados. Pedidos com projeção negativa reservam somente o dinheiro positivo disponível e aguardam a aprovação da Pontalti, sem criar dívida antecipada. Cliente e administrador revisam saldo, reservas e projeção usando a revisão da conta. A aprovação não pode piorar a dívida aceita pelo cliente; a renovação explícita de consentimento está disponível em `/purchases/:id/renew-consent`. As decisões, reservas, recebimentos, estornos e registros em fábrica são serializados e auditados.

A ação administrativa `register-order` cria `Orders`, `OrderItems` e os recebimentos de saldo confirmado em uma única transação, com retorno idempotente. Crédito comercial aprovado não é registrado como dinheiro recebido. Depósitos posteriores abatem a dívida e alocam dinheiro aos recebíveis desses pedidos, preservando `Payments.remaining`. Edição direta de débitos e identidade vinculada, exclusão/edição de recebimentos financeiros e mudanças em preço, produtos, cliente ou cancelamento de pedido financeiro já registrado ficam bloqueados para não romper a conciliação.

As solicitações “já depositei” não liberam saldo por comprovante. O administrador precisa vincular uma entrada `CREDIT/TRANSFER`, do mesmo valor e ambiente, não utilizada, encontrada novamente numa consulta autenticada atual ao extrato. PIX e pagamentos de boleto não são elegíveis para esse vínculo manual, porque podem representar uma cobrança já paga. Essa restrição evita creditar a mesma entrada como pagamento de pedido e como saldo.

Para dinheiro físico, a emissão de boleto individual de saldo usa `/v2/invoices/` da Cora e precisa de `CORA_CUSTOMER_DEPOSITS_ENABLED=true`. A confirmação exige consulta autenticada da mesma cobrança, código, valor integral e estado `PAID`. Um resultado ambíguo de emissão fica `UNKNOWN`, sem reenvio automático. O processador `CORA_CUSTOMER_DEPOSIT_WORKER_ENABLED=true` consulta cobranças e extrato a cada minuto; ele não emite boletos nem transferências. Cada ambiente solicitado precisa corresponder à conexão Cora usada na operação bancária.

Migração aditiva: `prisma/manual-migrations/20261015_customer_account.sql`. Fazer backup antes de aplicá-la. A migração não reescreve os clientes, pedidos ou pagamentos anteriores. `npm run test:customer-finance` exige `DATABASE_URL` e `CUSTOMER_FINANCE_TEST_DATABASE_URL` iguais, apontando exclusivamente para banco local descartável `pontalti_customer_finance_test`; os testes limpam apenas esse banco explicitamente permitido.

Referências do banco: [extrato](https://developers.cora.com.br/reference/consulta-de-extrato), [emissão de boleto](https://developers.cora.com.br/reference/emiss%C3%A3o-de-boleto-registrado-v2), [consulta da cobrança](https://developers.cora.com.br/reference/consultar-detalhes-de-um-boleto-v2).

**Dívida histórica:** os débitos manuais antigos não possuem associação verificável a cada pedido. A abertura os preserva e o resumo informa `opening_debts_cents`, `legacy_debt_unallocated_cents` e `legacy_debt_review_required`. Não são criados recebimentos fictícios em pedidos antigos quando um depósito abate essa dívida. Após a conta do cliente passar a ser gerenciada, registrar um novo recebimento em pedido anterior sem vínculo financeiro exige conciliação histórica pela Pontalti; a API retorna 409 com essa orientação. Clientes que ainda não passaram a usar o fluxo financeiro mantêm o recebimento anterior. Nenhum histórico antigo é reescrito pela migração.
