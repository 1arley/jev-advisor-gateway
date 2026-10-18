# Headroom nativo no gateway: registro de decisão

Data: 2026-10-18
Status: implementado; validação contra o serviço real e auditoria de privacidade pendentes

## Decisão

Integrar o proxy Headroom por uma chamada direta e injetável a `POST /v1/compress`, sem SDK e sem iniciar ou gerenciar o proxy no gateway. A primeira versão trata apenas o caso Codex Responses com exatamente um `function_call_output` textual novo, numa requisição com `previous_response_id`. Em qualquer outro formato, segue passthrough sem alteração.

## Decisões aprovadas

| Tema | Decisão |
|---|---|
| Integração | Chamada local a `/v1/compress`, após fixar e auditar a versão/endpoint. |
| Validação inicial | Começar com fixtures sintéticas em shadow mode; medir fidelidade, redução e latência antes de considerar dados reais. |
| Escopo | Codex Responses; somente `function_call_output` textual elegível. |
| Continuação | Comprimir apenas a saída nova junto a `previous_response_id`; histórico permanece intacto; validar duas continuações sintéticas. |
| Resposta aceita | Exigir exatamente um item `tool`, `tool_call_id` correspondente ao `call_id` do Responses, conteúdo textual não vazio e menor; rejeitar campos fora do contrato e marcadores CCR. A validação estrutural não prova fidelidade semântica. |
| Ativação | Desligada por padrão; URL loopback explícita; gateway não inicia o proxy. Não fixar porta padrão. |
| Prova sintética | Fixar versão Headroom; provar redução e fidelidade de item/ID, sem marcador CCR e sem remover proteções padrão. |
| Dados reais | Bloqueados até auditar persistência, telemetria, chamadas remotas, uso de CCR e ausência de credenciais upstream. |
| Latência | Uma chamada, sem retry, deadline curto configurável; em falha, usar corpo pré-compressão. |
| Fallback | Timeout, erro ou resposta inesperada descartam somente a compressão e encaminham o corpo original preparado pelo roteador/advisor. |
| Contrato | `/v1/compress` simples com um `tool_result` textual; sem extensão gateway/redrive. |
| Métricas | Somente tokens, latência e modo/resultado; nunca conteúdo, headers ou credenciais. |
| Paralelismo | Se houver zero, mais de um resultado elegível ou resultado não textual, passthrough nesta versão. |

## Proveniência

As respostas de desenho foram coletadas no grill de 2026-10-18. JEV recomendou as decisões registradas; nas perguntas escaladas, o usuário confirmou explicitamente a recomendação. A decisão mais recente sobre saídas paralelas (Q15) também foi aceita pelo usuário. O arquivo local `.grill/headroom-native-2026-10-18.jsonl` preserva as respostas e a proveniência detalhadas.

## Evidências e limites conhecidos

- A pesquisa anterior identificou `/v1/compress` no Headroom v0.41.0 e um caminho simples sem CacheAligner. A extensão gateway tem escopo amplo sobre Responses e pode adicionar obrigações de redrive, portanto não foi escolhida.
- O código e testes sintéticos com `fetch` falso cobrem compressão, fallback, saídas paralelas, métricas sem conteúdo e duas continuações; não foi executado contra o serviço Headroom v0.41.0.
- A fidelidade semântica e a compressão efetiva de um resultado isolado ainda precisam de prova contra a versão fixa do serviço, sem desativar proteções padrão.
- Persistência, telemetria, chamadas remotas e uso de CCR ainda precisam de auditoria antes de enviar prompts reais. Manter `JEV_HEADROOM_MODE=off` até esses gates serem concluídos.
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

1. Fixar e executar o Headroom v0.41.0 em ambiente local controlado com fixtures sintéticas; validar redução, fidelidade semântica e duas continuações.
2. Auditar persistência, telemetria, chamadas remotas e CCR do serviço.
3. Só então decidir se `compress` pode receber conteúdo real. A configuração permanece desligada por padrão.
