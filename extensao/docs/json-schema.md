# Schema do JSON exportado

## Envelope

```json
{
  "gerado_em": "2026-08-16T17:00:00.000Z",
  "total": 187,
  "avisos": [
    { "comarca": "Comarca de Parnamirim 23", "aviso": "colhidos 20 de 23 declarados (possível paginação não percorrida)" }
  ],
  "erros": [
    { "numero_processo": "0800000-00.2024.8.20.5001", "erro": "HTTP 500" }
  ],
  "processos": []
}
```

`avisos` e `erros` existem para que nenhuma perda fique silenciosa: confira ambos antes de dar a migração por concluída.

O envelope traz ainda:

- `coleta_completa` — `false` quando a fase 1 não percorreu todas as comarcas.
- `comarcas_concluidas` — comarcas que fecharam colhido = declarado.
- `revisar_manualmente` — processos em que algum polo não pôde ser interpretado. É a lista para conferir à mão; num acervo de 200, um polo mal lido passaria despercebido sem ela.
- `sem_cliente_identificado` — processos onde a OAB configurada não apareceu. Pode ser correto (você não é o advogado constituído nos autos) ou sintoma de leitura incompleta; cruze com `revisar_manualmente`.

## Diagnóstico por polo

Cada processo traz `diagnostico`, que separa polo genuinamente vazio de falha de leitura — os dois davam lista vazia antes:

```json
"diagnostico": {
  "polo_ativo":   { "status": "ok", "linhas_analisadas": 4 },
  "polo_passivo": { "status": "sem_partes_cadastradas", "linhas_analisadas": 0 },
  "revisar_manualmente": false
}
```

| status | significado |
|---|---|
| `ok` | partes lidas normalmente |
| `sem_partes_cadastradas` | a seção existe e está vazia no PJe — normal em alvará e divórcio consensual |
| `nao_interpretado` | a seção tem conteúdo que não virou parte alguma: **conferir à mão** |
| `secao_ausente` | o cabeçalho do polo não foi encontrado na página |

## Processo

```json
{
  "numero_processo": "0000005-06.2022.8.20.0001",
  "comarca": "Comarca de Ceará-Mirim 8",
  "classe": "AÇÃO PENAL - PROCEDIMENTO ORDINÁRIO",
  "classe_codigo": "283",
  "assunto": "Roubo",
  "assunto_codigo": "3419",
  "jurisdicao": "Comarca de Ceará-Mirim",
  "orgao_julgador": "1ª Vara da Comarca de Ceará-Mirim",
  "competencia": "Justiça Comum - Criminal",
  "cargo_judicial": "Juiz de Direito",
  "autuacao": "10 mar 2022",
  "ultima_distribuicao": "10 mar 2022",
  "valor_causa": "R$ 0,00",
  "segredo_justica": "NÃO",
  "justica_gratuita": "SIM",
  "tutela_liminar": "NÃO",
  "prioridade": "NÃO",
  "polo_ativo": [],
  "polo_passivo": [],
  "clientes": [{ "nome": "REU SEGUNDO EXEMPLO", "papel": "REU", "polo": "passivo" }],
  "qtd_clientes": 1,
  "fonte": "PJe",
  "tribunal": "TJRN",
  "grau": "1",
  "extraido_em": "2026-08-16T17:00:00.000Z"
}
```

## Parte (dentro de `polo_ativo` / `polo_passivo`)

```json
{
  "nome": "REU SEGUNDO EXEMPLO",
  "papel": "REU",
  "documento": { "tipo": "CPF", "valor": "000.000.000-00" },
  "advogados": [
    {
      "nome": "ADV EXEMPLO",
      "oab": { "uf": "RN", "numero": "99999", "sufixo": null, "original": "OAB RN0099999" },
      "documento": { "tipo": "CPF", "valor": "000.000.000-00" }
    }
  ],
  "is_cliente": true
}
```

## Regras

- `classe` / `assunto`: o código entre parênteses é separado em `classe_codigo` / `assunto_codigo`.
- `papel`: vem como o PJe escreve — `AUTOR`, `REU`, `EXEQUENTE`, etc. (sem acento em `REU`).
- `oab.numero`: sem zeros à esquerda (`OAB RN0099999` → `"99999"`). `original` guarda a forma como aparece no PJe.
- `advogados`: ligados à parte imediatamente anterior na listagem do PJe, que é como o sistema agrupa.
- `is_cliente`: `true` quando algum advogado daquela parte bate com a OAB configurada. Numa ação com vários réus, só os réus efetivamente representados são marcados — e podem ser mais de um: em `0000006-07.2022.8.20.0001`, dos 19 réus, dois têm a OAB configurada e ambos saem como clientes.
- `clientes`: resumo das partes marcadas, com o polo em que estão. `qtd_clientes` repete o tamanho da lista para facilitar filtro.
- Campo textual ausente vem como `null`.
- Processo que falhou no download entra em `processos` apenas com `numero_processo`, `comarca` e `erro`, e também é listado em `erros`.

---

# Registros do SEEU

O SEEU preenche **o mesmo envelope** do PJe: `numero_processo`, `fonte`,
`polo_ativo`, `polo_passivo`, `clientes`, `diagnostico`, `parser_versao`.
Quem consome o padrão do PJe não precisa mudar nada.

Correspondência de polos, a partir da listagem:

| SEEU | Campo |
|---|---|
| Autoridade | `polo_ativo`, papel `AUTORIDADE` |
| Executado / Sentenciado | `polo_passivo`, papel `EXECUTADO` |

O cliente é identificado pela OAB dentro de `Advogados/Defensoria`. Como o
separador varia, a busca é por grupos de dígitos comparados numericamente —
reconhece `NOME 99999`, `NOME - 99999/RN`, `NOME (99999)` e `99999 - NOME`.

## Bloco aditivo `execucao_penal`

Só existe em registros do SEEU. Campo novo, nunca alteração de campo
existente — por isso não quebra consumidor algum.

```json
"execucao_penal": {
  "sentenciado": "FULANO DE TAL",
  "nome_da_mae": "MARIA EXEMPLO",
  "advogados_defensoria": "ADV EXEMPLO 99999",
  "status_bnmp": "Sem mandado ativo",
  "local_prisao": "PENITENCIÁRIA EXEMPLO",
  "sumario_pena": "12 anos e 6 meses",
  "situacao_atual": "EM EXECUÇÃO",
  "pena_inicio": "01/02/2020",
  "pena_termino": "01/08/2032",
  "beneficios": {
    "progressao_regime": "15/03/2027",
    "saida_temporaria": "20/12/2026",
    "livramento_condicional": "10/06/2028"
  }
}
```

Os três benefícios são os marcos que definem quando o cliente progride, sai
ou é solto. Não há equivalente no PJe.

## `movimentos`

O SEEU traz as movimentações na própria página, então o registro as inclui:

```json
"movimentos": [
  { "sequencial": "102", "data": "14/08/2026", "evento": "Juntada de Petição", "movimentado_por": "Advogado" }
]
```

Campo opcional do envelope: o PJe hoje devolve lista vazia, e pode passar a
preencher sem quebrar nada.

## Diferenças a conhecer

- `tribunal` fica `null` para o SEEU: o domínio é nacional e não revela a
  sigla. Em troca vem `tribunal_codigo` extraído do próprio número CNJ
  (`8.20`). Traduzir para sigla exigiria a tabela do CNJ, que não foi
  conferida — inventar seria pior que omitir.
- `classe_codigo`, `assunto_codigo`, `valor_causa` e `competencia` não
  existem na capa do SEEU e vêm `null`.
- A listagem é lida com o filtro **Situação: Ativo**, que é o recorte
  combinado. Processos arquivados não entram.

---

# Movimentações: com ou sem

O popup traz a opção **Incluir movimentações no JSON**, com a contagem do
acervo ao lado para a escolha ser informada (um acervo de 48 processos do
SEEU passou de 15 mil movimentações).

A decisão é do **export**, não da captura. As movimentações são sempre
colhidas e guardadas; o que muda é o que entra no arquivo. Assim o mesmo
acervo gera os dois formatos sem migrar de novo, e o caminho de coleta não
muda para sistema nenhum.

O envelope registra a escolha, e o nome do arquivo também:

```json
{ "inclui_movimentos": false }
```
`pje-acervo-1g-sem-movimentos-2026-08-17.json`

Quando omitidas, o registro guarda a prova de que existiam:

```json
{
  "movimentos_omitidos": true,
  "qtd_movimentos": 214
}
```

Omitir calado faria um processo movimentado parecer parado — o mesmo
princípio que vale para polo vazio e para processo ausente do DataJud.

Registro do PJe não tem movimentações e passa intacto nas duas opções: não
ganha `movimentos_omitidos` nem contagem.

## Limpeza obrigatória no export

Todo texto exportado passa por uma varredura que remove `_tj`, `jsessionid`
e `ca` em qualquer nível do registro. São tokens de sessão, e um arquivo
destinado a outro sistema não pode carregá-los.

Vale para todos os adaptadores, inclusive os que vierem depois.
