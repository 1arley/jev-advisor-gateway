# Headroom nativo no gateway: registro de decisão

Data: 2026-10-18
Status: implementado; validação sintética contra o serviço fixado e auditoria de privacidade concluídas em 2026-10-22; `compress` para conteúdo real continua off por decisão

## Decisão

Integrar o proxy Headroom por uma chamada direta e injetável a `POST /v1/compress`, sem SDK e sem iniciar ou gerenciar o proxy no gateway. A primeira versão trata apenas o caso Codex Responses com exatamente um `function_call_output` textual novo, numa requisição com `previous_response_id`. Em qualquer outro formato, segue passthrough sem alteração.

## Decisões aprovadas

| Tema              | Decisão                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integração        | Chamada local a `/v1/compress`, após fixar e auditar a versão/endpoint.                                                                                                                                                                  |
| Validação inicial | Começar com fixtures sintéticas em shadow mode; medir fidelidade, redução e latência antes de considerar dados reais.                                                                                                                    |
| Escopo            | Codex Responses; somente `function_call_output` textual elegível.                                                                                                                                                                        |
| Continuação       | Comprimir apenas a saída nova junto a `previous_response_id`; histórico permanece intacto; validar duas continuações sintéticas.                                                                                                         |
| Resposta aceita   | Exigir exatamente um item `tool`, `tool_call_id` correspondente ao `call_id` do Responses, conteúdo textual não vazio e menor; rejeitar campos fora do contrato e marcadores CCR. A validação estrutural não prova fidelidade semântica. |
| Ativação          | Desligada por padrão; URL loopback explícita; gateway não inicia o proxy. Não fixar porta padrão.                                                                                                                                        |
| Prova sintética   | Fixar versão Headroom; provar redução e fidelidade de item/ID, sem marcador CCR e sem remover proteções padrão.                                                                                                                          |
| Dados reais       | Bloqueados até auditar persistência, telemetria, chamadas remotas, uso de CCR e ausência de credenciais upstream.                                                                                                                        |
| Latência          | Uma chamada, sem retry, deadline curto configurável; em falha, usar corpo pré-compressão.                                                                                                                                                |
| Fallback          | Timeout, erro ou resposta inesperada descartam somente a compressão e encaminham o corpo original preparado pelo roteador/advisor.                                                                                                       |
| Contrato          | `/v1/compress` simples com um `tool_result` textual; sem extensão gateway/redrive.                                                                                                                                                       |
| Métricas          | Somente tokens, latência e modo/resultado; nunca conteúdo, headers ou credenciais.                                                                                                                                                       |
| Paralelismo       | Se houver zero, mais de um resultado elegível ou resultado não textual, passthrough nesta versão.                                                                                                                                        |

## Proveniência

As respostas de desenho foram coletadas no grill de 2026-10-18. JEV recomendou as decisões registradas; nas perguntas escaladas, o usuário confirmou explicitamente a recomendação. A decisão mais recente sobre saídas paralelas (Q15) também foi aceita pelo usuário. O arquivo local `.grill/headroom-native-2026-10-18.jsonl` preserva as respostas e a proveniência detalhadas.

## Evidências e limites conhecidos

- A pesquisa anterior identificou `/v1/compress` no Headroom v0.41.0 e um caminho simples sem CacheAligner. A extensão gateway tem escopo amplo sobre Responses e pode adicionar obrigações de redrive, portanto não foi escolhida.
- O código e testes sintéticos com `fetch` falso cobrem compressão, fallback, saídas paralelas, métricas sem conteúdo e duas continuações; a validação contra o serviço v0.41.0 fixado foi concluída em 2026-10-22 (seção abaixo).
- A fidelidade sentinela e o comportamento de redução de um resultado isolado foram medidos contra a versão fixa do serviço, sem desativar proteções padrão; a redução no caso realista do gateway foi zero, por design do serviço.
- Persistência, telemetria, chamadas remotas e uso de CCR foram auditados em 2026-10-22 (seção abaixo). `compress` para conteúdo real segue desligado por decisão, não mais por pendência.
- `shadow` também envia o texto elegível ao serviço local; usar apenas fixtures sintéticas enquanto a auditoria estiver pendente. `compress` aplica a resposta validada e tem o mesmo requisito.
- A estabilidade do prefixo/cache foi coberta apenas estruturalmente pelos testes sintéticos; ainda precisa de validação operacional contra o serviço fixo.
- O gateway exige URL loopback explícita terminando em `/v1/compress`, não envia headers/credenciais upstream, rejeita redirects e faz uma chamada sem retry com deadline de 1–5000 ms.

## Implementação

- Variáveis: `JEV_HEADROOM_MODE=off|shadow|compress`, `JEV_HEADROOM_URL` e `JEV_HEADROOM_TIMEOUT_MS` (500 ms por padrão).
- Elegibilidade: cliente Codex, continuação com `previous_response_id` e exatamente um resultado textual `function_call_output`; outros casos seguem passthrough.
- `shadow` registra resultado, latência e tokens, encaminhando o corpo pré-compressão. `compress` altera somente o texto se a resposta tiver o item/ID esperados, texto menor e nenhum marcador CCR.
- Timeout, erro e resposta inválida preservam o corpo pré-compressão já preparado pelo roteador/advisor. Logs Headroom não incluem conteúdo, headers nem credenciais.
- O gate para conteúdo real é operacional, não imposto pelo código: configurar qualquer modo além de `off` envia o texto elegível ao endpoint. Não usar conteúdo real até concluir as auditorias.
- Testes do gateway usam um endpoint falso; não comprovam compressão real ou fidelidade semântica contra v0.41.0.
- Consulte a seção Headroom em `README.md` e os exemplos em `.env.example` antes de configurar o endpoint.

Referência da versão pesquisada: https://github.com/headroomlabs-ai/headroom/tree/76133cff59b71284399bf760c5578dc373c97231

## Próximos gates

Concluídos em 2026-10-22, contra `headroom-ai==0.41.0` num venv local isolado (`/tmp/opencode/headroom-venv`), com proxy lançado pelo auditor como `headroom proxy --stateless --no-ccr` em loopback e `HEADROOM_OFFLINE=1`:

1. **Contrato de formato.** `POST /v1/compress` com `{"model", "messages": [{"role": "tool", "tool_call_id", "content"}]}` responde com exatamente um item `tool`, `tool_call_id` preservado, chaves apenas `content/role/tool_call_id` e `ccr_hashes: []`.
2. **Redução e fidelidade.** Para a forma que o gateway envia na prática — um `function_call_output` JSON completo e bem formado (diagnóstico TS de ~36 KB) — o pipeline padrão devolve o conteúdo inalterado (`router:noop`, tokens idênticos). Duas proteções explicam, e foram confirmadas no código-fonte da versão fixada: a guarda de JSON protegido (issue #3673, `_protected_json_spans`) trata um conteúdo que é um documento JSON ponta a ponta como span protegido, porque um corte do modelo de prosa poderia apagar um registro inteiro silenciosamente; e `protect_recent_reads_fraction` tem padrão 0.0 (proteger toda leitura de ferramenta excluída, o modo mais seguro para agentes de código, também restaurado a 0.0 por `--protect-tool-results`). Em fluxos de log JSON truncados ou sem fechamento a redução engajou (0.39–0.81), com sentinelas de fidelidade preservados em todos os casos. Conclusão honesta: no caso realista do gateway o serviço não traz redução; manter `compress` off não perde nada hoje.
3. **Duas continuações.** Duas requisições sequenciais idênticas devolvem saída idêntica; nenhum estado de sessão/compressão é criado (o serviço só faz replay/caching quando o chamador envia `session_id`, o que o gateway não envia). Nenhum marcador CCR.
4. **Auditoria de privacidade.** O beacon padrão do serviço em v0.41.0 é **ligado** (`BEACON_DEFAULT_ON=true`; envia metadados a `headroom-beacon...workers.dev` a partir de tráfego de compressão). O update check é opt-out (`HEADROOM_UPDATE_CHECK=off`), `kompress_remote` é opt-in (endpoint não configurado) e o endpoint por padrão escuta só em loopback. O modo CCR default é sem marcadores. Operador que rode o proxy precisa de um dos opt-outs do beacon: `HEADROOM_BEACON=off`, `DO_NOT_TRACK=1` ou `HEADROOM_OFFLINE=1` — todos verificados nos logs do auditor (beacon DISABLED).
5. **Persistência e saída de rede.** Com `--stateless` e `HEADROOM_WORKSPACE_DIR` isolado, o proxy não escreveu nada além de lockfiles de beacon no diretório de trabalho, nada em `~/.headroom` e nenhuma chamada remota. Com cache de modelos vazio e `HEADROOM_OFFLINE=1`, o download do Kompress é recusado (guarda offline funciona; a linha "Downloading…" vista com cache aquecido é carregamento do cache local, não download).
6. **Decisão.** `compress` permanece desligado por padrão e não há ganho observado para o caso elegível do gateway contra a versão fixada. Revisitar se o escopo do gateway passar a enviar histórico (além do output novo) ou se o padrão do serviço mudar as proteções acima. O gate para conteúdo real continua operacional: configurar `shadow`/`compress` envia o texto elegível ao serviço.

## Melhorias do projeto: decisões iniciais

Data: 2026-10-20
Status: roteamento exige evidência antes de trocar estratégia; motivos de erro implementados em 2026-10-22; medição de checkpoints do Laya registrada em 2026-10-22

| Tema                   | Decisão                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motivos de erro        | Substituir mensagens brutas de exceção por códigos estáveis nos caminhos de decisão, preservando o fail-open. Reproduzir a exposição atual com erros sintéticos, mapear seus destinos e, após a correção, verificar que o texto não chega a headers, logs, eventos do dashboard ou respostas de decisão e que a requisição segue sendo encaminhada. |
| Rust                   | Considerar Rust somente se profiling mostrar que parsing ou serialização local contribuem de forma relevante para a latência total.                                                                                                                                                                                                                 |
| Mudanças de roteamento | Exigir evidência de qualidade, latência e tokens antes de alterar a estratégia de roteamento.                                                                                                                                                                                                                                                       |

### Motivos de erro: implementado (2026-10-22)

- O texto de exceção não chega mais a motivos: `failureReason()` em `src/decide.ts` classifica em `jev_timeout` (nome do erro), `jev_http_<status>` (status numérico anexado ao erro) e `jev_error` (fallback); os dois pontos de falha do roteador em `src/app.ts` viram o código constante `router_error`. O corpo/mensagem do provedor não é interpolado em nenhum lugar.
- O thrown Error original mantém o detalhe (reprodução via dump continua funcionando); só os reasons perderam texto.
- O dashboard mapeia `jev_http_*` para `jev_http_error` e mantém o mapeamento do prefixo legado `jev_error: <detalhe>` para ler logs antigos. Testes cobrem `jev_http_503`, `jev_timeout` e os textos novos.

### Checkpoints do Laya: medição e decisão (2026-10-22)

`scripts/laya-checkpoints.mjs` mediu `multilingual` contra `typed-decisions` duas vezes, contra o `laya-serve` real em loopback, com as mesmas 6 perguntas sintéticas de roteamento de ferramentas:

| Checkpoint              | Acertos /6 | Latência média             | Confiança                |
| ----------------------- | ---------- | -------------------------- | ------------------------ |
| `multilingual` (padrão) | 2          | ~553 ms                    | calibração normal do Jev |
| `typed-decisions`       | 3          | ~1323 ms (2.4x mais lento) | 0.05–0.28 (degenerada)   |

Limites declarados: cenários sintéticos e rotulados por este projeto, amostra pequena, ambos os checkpoints pende para `no_tool_needed` em casos ambíguos, e o `laya-serve` avisa que o checkpoint `typed-decisions` vem com temperatura não calibrada ("treat confidence as uncalibrated"). Os 0.766 do benchmark próprio do Laya para `typed-decisions` não se reproduziram nos fixtures.

**Decisão: manter `multilingual` como padrão.** Mesmo com 1 acerto a mais na amostra de 6, a confiança do `typed-decisions` (0.05–0.28) não passa de `JEV_MIN_CONFIDENCE=0.7`, então nenhuma decisão dele se aplicaria além do fail-open — e a latência é 2.4x. Trocar o padrão so transformaria o comportamento; não troca qualidade aplicável. Evidência real de sessão é o requisito para reabrir, e o instrumento para reuni-la é o tile "Routing accuracy" do dashboard (captura por requisição a ferramenta escolhida pelo Jev e a realmente chamada na resposta).

Do mesmo ciclo, sem nova configuração: quando `JEV_PROVIDER=laya`, o gateway dispara uma pergunta barata de aquecimento ao `laya-serve` no startup, para o carregamento do checkpoint não consumir o deadline da primeira pergunta real.

## Proveniência e limites

O usuário confirmou as três recomendações em 2026-10-20. Essas respostas são decisões humanas, não respostas do JEV; nenhuma resposta validada do JEV foi recebida nesta rodada. O levantamento local identificou mensagens de exceção incluídas em motivos e a documentação registra impacto variável por modelo e tarefa, com amostras pequenas. Em 2026-10-22 o usuário pediu explicitamente prosseguir com os itens da rodada (motivos de erro, feedback de roteamento, medição de checkpoints e aquecimento), e o que aparece como implementado acima resultou desse pedido.

## Revisão de arquitetura: aprofundar o roteador como um módulo (deepening)

Data: 2026-10-26
Status: implementado e validado em 2026-10-26; 303 testes passaram

Decisões tomadas com o grill-with-jev (proveniência detalhada em `.grill/architecture-review-2026-10-26.jsonl`, sessão `architecture-review-2026-10-26`; JEV via TypeSafe/jev-latest, decisões humanas para as perguntas escaladas):

| Tema                      | Decisão                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escopo (Q1)               | Extrair a transação roteada inteira de `src/app.ts` para `src/router.ts` (módulo profundo). Advisor, policy, session-state e Headroom movem para trás dele, num único lote.                                                                                                                                                            |
| Leitor de reply (Q2)      | Fundir apenas os dois scanners de clone (`readReply` em `src/usage.ts` + `readResponseId` em `src/codex/session-state.ts`); os extratores sobre strings (`summarizeResponse`, `.text` do advisor) ficam como estão.                                                                                                                    |
| Dono do forward (Q3)      | O módulo router profundo é dono da transação inteira: parse → decide → advisor → rewrite → headroom → forward → log → remember. `app.ts` vira registro + flush fino. Seam de volta ao chamador: `prepare(req) -> Response`.                                                                                                            |
| Layout (Q4)               | `src/router.ts` + mover `advisor.ts`, `policy.ts`, `session-state.ts` de `src/codex/` para `src/advisor/`. Renomear `codex` → `advisor` uma vez, junto com a extração; sem dois passos de churn.                                                                                                                                       |
| Walker fundido (Q5)       | Um walker em `src/usage.ts`: `readReply(reply) -> { usage, tool, responseId }`, uma passada sobre um clone. `readResponseId` vira wrapper fino em `session-state.ts` chamando `readReply`.                                                                                                                                             |
| Testes (Q6)               | Manter os testes e2e `app.request()` como backstop comportamental; adicionar `test/router.test.ts` dirigindo a interface do router diretamente (invariantes de ordem: decisão antes do advisor, ordem de prepare, headroom por último, fail-open em `router_error`); `usage.test.ts` e os testes de `readResponseId` ficam como estão. |
| Uma leitura do reply (Q7) | Uma única passada de `readReply` alimenta o log roteado (status, duration, usage, actualTool) e, quando `session && responsesAdapter`, `sessions.remember(responseId)` do mesmo resultado. O reply é lido uma vez por request.                                                                                                         |
| Headroom (Q8)             | Extração é pure move, preservando exatamente o gate do decision-record: off por padrão, URL loopback explícita, escopo Codex continuation, sem knob novo, métricas no mesmo allowlist do dashboard. O gate não é reaberto.                                                                                                             |
| Superfície do router (Q9) | `createRouter(deps)` retorna `{ route }`, com `route(adapter)` a mesma assinatura de hoje; as cinco registrações de rota em `app.ts` mal mudam. `decideFor` e `advisorFor` ficam dentro do módulo router como detalhe de implementação.                                                                                                |
| Mapa de advisor (Q10)     | Manter `advisorFor` comparando adapters por identidade de módulo (já importa `chatAdapter`, `responsesAdapter`, `messagesAdapter`); sem tag no `Adapter`, sem alargar interface. Move para `src/advisor/` inalterado.                                                                                                                  |
| Commit/move (Q11)         | Um commit mecânico único `refactor`: mover advisor/policy/session-state para `src/advisor/` e adicionar `src/router.ts`; rodar `pnpm typecheck && pnpm test && pnpm build`; exports de `src/index.ts` inalterados (router e advisor são internos ao app).                                                                              |

Proveniência: Q1/Q2/Q3/Q7/Q8 confirmados explicitamente pelo usuário (Q3/Q7/Q8 escalados por confiança < 0.6 ou risco de segurança; usuário aceitou a recomendação). Q4, Q5, Q6, Q9, Q10, Q11 aceitos pelo JEV com confiança 0.66–0.79, sem escalação.

Premissas e limites conhecidos:

- O merge do walker não muda o comportamento observável do reply: `readReply` expõe `{ usage, tool, responseId }` e `readResponseId` mantém a assinatura, então `usage.test.ts` e os testes de sessão seguem válidos.
- Antes da fusão, `readResponseId` fazia `reader.cancel()` assim que achava o id; o walker fundido lê o reply até o fim para extrair usage/tool, então a leitura consome o corpo inteiro — comportamento esperado e aceito em Q7 (ler uma vez por request).
- A robustez de fail-open (`router_error`, passthrough preservando o corpo pré-prepare) é mantida: o router nunca faz uma request falhar.
- O Headroom continua off por padrão; a extração é mecânica e não reabre os gates de segurança registrados acima.

## Implementação

- `src/router.ts` agora possui a transação completa das cinco rotas. `createRouter(deps)` retorna somente `{ route }`; o handler separado do preview também usa o decider privado do módulo. `src/app.ts` mantém auth, dashboard, rotas e forward opaco.
- `advisor.ts` e `policy.ts` foram movidos de `src/codex/` para `src/advisor/` sem mudanças de comportamento. `session-state.ts` também foi movido; seu `readResponseId` agora usa o walker compartilhado e lê o reply até o fim.
- `readReply` extrai `responseId` na mesma leitura que usage e ferramenta. O log e `sessions.remember` consomem o mesmo resultado da resposta clonada; o wrapper `readResponseId` permanece compatível e também usa um clone.
- Testes diretos do router cobrem a ordem de decisão, advisor, prepare/encode e forward; Headroom roda depois do prepare, e falhas de advisor, preparação ou Headroom seguem fail-open com o corpo aplicável preservado.
- `pnpm typecheck`, `pnpm build` e a suíte completa passaram em 2026-10-26 (303/303 testes). `test/opencode-coverage.test.ts` fixa `JEV_OPENCODE_MODEL=gpt-5` durante os casos que verificam o padrão e restaura o ambiente após cada teste. Os testes focados de router e usage passaram (46/46). A validação Headroom continua sintética; nenhum serviço real foi chamado nesta mudança.

## Advisor com provider independente

Data: 2026-10-29  
Status: confirmado pelo usuário em 2026-10-29; implementação em andamento.

| Tema                            | Decisão                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider do advisor             | Separar provider, endpoint, modelo e credencial dos usados pelo modelo principal. Exigir opt-in explícito antes de enviar contexto ao destino configurado. Nunca reutilizar a chave do upstream principal.                                                                                |
| Providers e protocolos iniciais | Incluir providers com API OpenAI Chat Completions compatível e Claude/Anthropic via adapter Messages próprio.                                                                                                                                                                             |
| Endpoint                        | Permitir endpoint base explicitamente configurado para esses protocolos. Exigir HTTPS fora de loopback, aceitar HTTP apenas em loopback, validar a URL e recusar redirects.                                                                                                               |
| Custo                           | Sem teto de gastos, conforme decisão explícita do usuário. Manter o limite existente de chamadas do advisor por sessão; ele controla frequência, não gasto.                                                                                                                               |
| Esforço                         | Expor `low`, `medium` e `high`; mapear para o campo nativo do adapter quando o suporte for conhecido. Omitir o campo quando o suporte do modelo for desconhecido ou incompatível. Se o provider rejeitar a chamada, registrar a falha e seguir fail-open, sem retry automático.           |
| Contexto                        | Enviar no máximo as seis mensagens textuais recentes de usuário/assistant, limitadas a 4.000 caracteres cada. Excluir system, developer, reasoning, resultados de ferramentas e mídia. Se o adapter não separar o texto com segurança, pular o advisor e preservar a requisição original. |
| Quando consultar                | Manter os gatilhos decididos pelo Jev e o limite atual por sessão.                                                                                                                                                                                                                        |

### Proveniência

- JEV aceitou o esforço configurável (Q1, confiança 0.89), os gatilhos e limite por sessão (Q3, 0.98) e o fail-open para modelos sem suporte conhecido (Q9, 0.89).
- O usuário decidiu provider independente, opt-in para o destino e sem teto de gastos (Q2); escolheu incluir Claude/Anthropic desde a primeira etapa (Q4); confirmou endpoint explícito com validação, HTTPS remoto e sem redirects (Q5); limitou o contexto a mensagens recentes (Q6/Q8); confirmou o mapeamento de esforço (Q7) e a extração somente de texto identificável, pulando conteúdo ambíguo (Q10).
- JEV escalou Q2, Q5, Q6, Q7 e Q10 por segurança, terceiros, gasto ou baixa confiança. Q4 teve baixa confiança e não foi resolvida por JEV; a escolha final foi do usuário.
- O grill usou `opencode-zen` com `oc/jev-1.13-free` via endpoint local confirmado na configuração. As rodadas bem-sucedidas reportaram 0 tokens e US$ 0. Uma chamada inicial falhou antes de uma rodada válida por precedência de variáveis de ambiente; a rodada foi repetida usando o provider e a credencial da configuração salva.

### Premissas e riscos em aberto

- “Qualquer provider” significa qualquer serviço configurado que implemente OpenAI Chat Completions ou Anthropic Messages; APIs com outros protocolos ficam fora do escopo decidido.
- Não haverá teto de custo. O total de gasto depende dos preços e do uso dos providers configurados e pode ser imprevisível.
- O contexto limitado ainda pode conter texto privado da conversa. A configuração precisa deixar claro qual endpoint o recebe e nunca persistir esse texto em logs, métricas ou arquivos.
- A implementação precisa validar destinos e credenciais, excluir conteúdo não textual, preservar a requisição original em caso de falha e cobrir os adapters com testes offline antes de uso real.
