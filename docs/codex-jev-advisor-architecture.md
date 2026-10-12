# Arquitetura: Codex + Luna + Astra + Jev

## Objetivo

Manter GPT-6 Luna como modelo que conduz a sessão. Jev toma decisões rápidas sobre roteamento e próximos passos. GPT-6 Astra entra como advisor somente quando a política indicar que uma revisão independente pode ajudar.

O proxy nunca executa comandos nem altera arquivos por conta própria. A Luna continua dona das chamadas de ferramenta e da resposta final.

## Identidade do fork

- Nome recomendado do repositório: `codex-jev-advisor`.
- Diretório local aplicado: `~/Projects/codex-jev-advisor`.
- Manter `jev-codex` inicialmente como comando de entrada para reduzir mudanças no uso existente; adicionar `codex-jev` como alias só se for útil.
- Não trocar URL de `origin`, homepage, bugs ou metadados de publicação até existir um repositório remoto sob a conta do usuário. O clone atual ainda aponta para `vinilana/jev-gateway`.
- O nome npm `codex-jev-advisor` depende de disponibilidade e só deve ser verificado ao preparar publicação.
- Na renomeação, atualizar título/descrição, dashboard, user-agent e links do pacote; conservar `~/.jev-gateway` e `JEV_*` como nomes de configuração na primeira versão para não quebrar instalações. Preservar licença MIT, avisos e crédito do upstream.

## Fluxo proposto

```text
Codex (perfil Luna)
  -> gateway local
      -> Jev: ferramenta / ação / necessidade de conselho
      -> opcional: Astra, em consulta read-only
  <- nota curta do Astra adicionada à solicitação da Luna
  -> upstream Responses API, com credencial já usada pelo Codex
  <- resposta e ferramentas da Luna
```

### Por solicitação

1. O perfil Codex define `gpt-6-luna` como modelo principal. O gateway preserva esse modelo nas solicitações da sessão.
2. O gateway decodifica a solicitação Responses e avalia o evento atual junto de um estado compacto da conversa.
3. Jev retorna duas decisões tipadas na mesma chamada quando possível: seleção de ferramenta (se houver ferramentas) e política de sessão (`continue`, `stop`, `consult_astra` ou `pass`). A política também roda quando a solicitação não declara ferramentas. Confiança baixa, respostas conflitantes e falha do Jev sempre resultam em `pass` para a Luna.
4. Uma consulta ao Astra usa o mesmo upstream e autenticação do Codex, sem ferramentas. A resposta é limitada a conselho, riscos e perguntas em aberto; ela não é anexada como resposta do assistant nem vira a próxima resposta encadeada.
5. O gateway inclui a nota do Astra como contexto não confiável e delimitado na solicitação da Luna. A Luna decide se a aplica e continua a sessão normalmente.
6. O corpo, o streaming e a resposta da Luna seguem para o Codex. As falhas do Jev, do Astra ou do estado local não podem impedir o caminho normal da Luna.

## Contexto e continuidade

O gateway atual pula o roteamento quando recebe `previous_response_id` (`src/adapters/responses.ts`). Portanto, a primeira etapa técnica é um spike para verificar se o upstream de Codex aceita uma chamada Astra que continue a partir do response ID da Luna, sem substituir a cadeia principal:

- Consulta Astra: `previous_response_id` atual + solicitação de conselho; modelo Astra; sem ferramentas.
- Chamada Luna: continua usando o response ID original, com a nota do Astra anexada.
- O response ID retornado à sessão continua sendo o da Luna.

Essa bifurcação evita armazenar a transcrição inteira localmente. A documentação pública do Responses API não garante o comportamento do backend de assinatura usado pelo Codex; isso precisa ser validado antes de adotar o caminho.

Se a bifurcação entre modelos não for aceita, alternativa: ledger em memória, indexado pelos response IDs, que reconstrói a conversa a partir de solicitações e eventos `response.output_item.done`. O ledger não grava conteúdo em disco, tem TTL e limite global de bytes, e falha aberto quando perde o histórico. Escolher essa alternativa somente após o spike.

O Jev recebe o último evento e um resumo curto de estado, não a transcrição completa em cada chamada. O estado guarda apenas sinais necessários à política, como ferramenta/resultado recentes, erros repetidos, tentativas e última consulta ao advisor.

## Política do Jev

- **Escolha de ferramenta:** reutilizar o seletor existente do gateway, mantendo a validação atual de argumentos e de confiança.
- **Escolha de arquivo:** Jev só escolhe entre caminhos candidatos presentes no contexto recente. Caminho livre sem candidatos é devolvido à Luna; não pedir ao Jev para inventar um caminho.
- **Repetição ou parada:** detectar resultado de ferramenta com erro repetido e limitar aconselhamento/reparo a uma tentativa por erro recorrente. Jev pode recomendar parar; ações não idempotentes nunca são repetidas automaticamente pelo proxy.
- **Consulta Astra:** considerar antes de planejar quando o pedido claramente exige um plano, após erro recorrente, ou na revisão final. Usar confiança, divergência e estado da sessão como condições; impor intervalo mínimo entre consultas para não chamar Astra em toda continuação.
- **Resposta incerta:** consulta Astra quando a decisão está na zona de incerteza configurada; caso contrário segue direto para Luna.

### Revisão final

Para revisar uma resposta antes de entregá-la, o gateway precisa reconhecer que a resposta da Luna terminou sem chamada de ferramenta. Isso exige segurar a resposta final em streaming até classificar o resultado. Se Jev decidir consultar Astra, o gateway pede uma revisão read-only e permite no máximo uma continuação da Luna com a nota recebida. Sem consulta ou se qualquer etapa falhar, entrega a resposta original da Luna.

Esse modo acrescenta latência apenas no caminho final e precisa de uma opção explícita de configuração. Não se deve afirmar que há revisão pré-entrega enquanto a resposta final estiver sendo transmitida antes da consulta.

## Módulos mínimos

- `src/app.ts`: orquestra decisões, consulta opcional e encaminhamento fail-open.
- `src/adapters/responses.ts`: extrai o evento corrente, detecta continuidade e injeta nota delimitada sem mudar o formato da resposta.
- `src/decide.ts` / `src/questions.ts`: mantém a seleção de ferramenta tipada e combina suas perguntas com a política quando houver ferramentas.
- `src/codex/policy.ts`: classifica etapa, erro repetido, necessidade de conselho e continuação/parada, inclusive em chamadas sem ferramentas.
- `src/codex/session-state.ts`: só se o spike mostrar que estado local é necessário; TTL, limite de memória e limpeza de IDs.
- `src/codex/advisor.ts`: constrói a solicitação Astra sem ferramentas, aplica timeout e limite de saída.
- `src/upstream.ts`: encaminha a chamada Astra com os mesmos headers autorizados e corpo/modelo próprios; nunca expõe credenciais em logs.

Evitar banco, gravação da conversa, fila, worker e dependência nova. A primeira versão roda em um processo local.

## Privacidade e limites

- Astra recebe o histórico por meio do contexto mantido pelo upstream, se a bifurcação for suportada. Caso contrário, o modo ledger envia apenas o contexto necessário, respeitando os limites configurados.
- Jev recebe estado curto e truncado. Nunca enviar headers de autenticação, conteúdo de variáveis de ambiente ou resultado bruto ilimitado.
- O conselho do Astra é entrada não confiável: delimitá-lo e instruir a Luna a tratá-lo como sugestão, não como instrução de sistema.
- Preservar bypass de `codex-auto-review`, solicitações com conteúdo de subagente que o gateway não consegue interpretar, e o modo `x-jev-gateway: off`.
- Dashboard mostra modelo efetivo, motivo do conselho, confiança e latência; não mostra prompts, caminhos ou argumentos.

## Sequência de implementação

1. **Spike:** validar com fixture se o backend aceita uma continuação Astra a partir de um response ID Luna e uma continuação Luna independente a partir do mesmo ID. Sem credenciais reais em testes automatizados.
2. **Identidade do código:** atualizar título, dashboard e package metadata para `codex-jev-advisor`; URLs de repositório/publicação ficam para quando o fork remoto existir. Conservar avisos MIT e atribuição ao projeto original.
3. **Política Jev:** separar decisão de sessão da seleção de ferramenta, tipar resultados e estado mínimo; combinar ambas numa chamada Jev quando houver ferramentas. Preservar comportamento atual como modo padrão desligado até a política estar validada.
4. **Advisor:** consulta Astra read-only, timeout curto, limite de tokens/saída, nota delimitada e fail-open.
5. **Histórico local (se necessário):** implementar ledger em memória apenas se o spike de bifurcação falhar.
6. **Revisão final:** buffer somente respostas finais e permitir no máximo uma revisão da Luna; manter opt-in.
7. **Interface e documentação:** perfil Luna, configuração do Astra, limites/custos, controles `status`, `logs`, `advisor on|off` e rollback para o gateway original.

## Verificações de aceitação

- A solicitação principal e todas as continuações continuam usando Luna.
- Astra só é chamado nos gatilhos configurados, nunca recebe ferramentas e nunca altera a cadeia de respostas da Luna.
- Jev pode encaminhar, recomendar conselho, continuar/parar ou falhar; falha de serviço volta ao comportamento normal da Luna.
- Um erro recorrente não dispara ciclos ilimitados nem repete ferramentas com efeitos colaterais.
- O histórico não aparece em disco nem no dashboard; estado local expira e respeita o teto de memória.
- Testes de Responses cobrem `previous_response_id`, streaming, compressão, derivações de cadeia, timeouts e fallback.
- O teste de integração com o upstream real é opt-in e confirma a bifurcação de modelos antes de habilitar o advisor por padrão.
