# Contexto do projeto

Extensão Chrome que migra o acervo processual do advogado para JSON, identificando os clientes pela OAB. Lê **PJe** e **SEEU** pelo mesmo contrato de saída.

Comece pelo [README.md](README.md); o formato do JSON está em [docs/json-schema.md](docs/json-schema.md).

## Como trabalhar aqui

**Rode os testes antes e depois de mexer.** São a única rede:

```bash
node teste/parser.teste.js      # 45 casos do parser do PJe
node teste/seeu.teste.js        # 34 casos do parser do SEEU
node teste/carga.teste.js       # ordem de injeção e contrato dos adaptadores
node teste/exportacao.teste.js  # garantias do arquivo exportado
```

**Suba `VERSAO_PARSER` ao mudar o que o parser extrai.** O migrador reprocessa registros de versão anterior. Sem isso, a correção fica escondida atrás de dado velho já salvo — aconteceu e custou uma rodada.

**Nunca deixe ausência parecer resultado.** É o princípio que atravessa o projeto inteiro, e cada vez que foi violado gerou defeito silencioso:

- polo vazio × polo não interpretado eram a mesma lista vazia; a separação revelou 60 processos com partes truncadas
- migração rodou sem OAB configurada e gravou 20 processos com zero clientes, sem um aviso
- histórico do SEEU vinha cortado em 500 sem dizer
- envelope dizia "coleta completa" enquanto o aviso dizia 26 de 48

**Não invente dado para preencher campo.** Preferir `null` com diagnóstico a um valor plausível: por isso `tribunal` do SEEU é nulo, com `tribunal_codigo` extraído do número.

## Armadilhas já pagas — não redescubra

**PJe**

- O painel degrada sob interação repetida: depois de muitos cliques AJAX a aba ACERVO para de carregar a árvore e a view cai para `home.seam`. **Comece de um login novo.**
- OAB aparece como `OAB RN0016581A` — UF colada ao número, com zeros à esquerda. Não é `OAB/RN 12345`.
- A listagem pagina de 40 em 40. Sem percorrer, uma comarca perdeu 47 processos calada.
- Parte institucional (MP, delegacia) ocupa várias linhas, com o papel só na última, e às vezes com parênteses aninhados.
- Papel entre parênteses em caixa mista é nome de unidade (`DEAM/Parnamirim`), não papel processual. Mas `REPRESENTANTE/NOTICIANTE` é parte real — por isso papel estranho é **sinalizado, nunca descartado**.

**SEEU**

- Páginas em **ISO-8859-1**. `fetch().text()` corrompe todo acento em silêncio. Use `buscarDocumento` do núcleo, que respeita o charset.
- Conteúdo dentro de frames aninhados: `topo > mainFrame > userMainFrame`. O script é injetado no topo e precisa descer.
- **Content script não dispara navegação por URL `javascript:`.** As âncoras de paginação são assim, e clicar não funciona no mundo isolado — embora funcione no console. Foi um falso positivo que custou uma rodada. Submeta o formulário.
- Melhor ainda: `processosAdvogadoPageSize` traz tudo numa página só.
- Espere a listagem terminar de carregar comparando o número de linhas com a faixa que a página declara ("exibindo de 1 até 48"). Sem isso, lê-se o DOM no meio da navegação e volta-se com menos processos.
- Células da capa embutem `<script>` de ajuda, e `textContent` inclui o código — junto com o token de sessão `_tj`. Leia sempre por `textoDaCelula`.
- `Local de Prisão`, `Status BNMP` e `Último Local Prisão SISDEPEN` vêm vazios da própria página. Não é falha de leitura.

## Dados sensíveis

O JSON exportado traz nomes de partes, CPF e processos em segredo de justiça.

- `.gitignore` bloqueia `pje-acervo*.json` e `pje-extension-log*.json`. **Nunca versionar export nem log real.**
- As amostras em `samples/` são anonimizadas de propósito.
- Todo texto exportado passa por `semSegredos`, que remove `_tj`, `jsessionid` e `ca` em qualquer nível. Já houve vazamento de 192 tokens num acervo.

## Acrescentar um sistema novo

Um diretório em `adaptadores/` implementando o contrato de `nucleo/adaptadores.js`. O núcleo não muda — foi por isso que ele foi separado antes do SEEU.

**Olhe a página antes de escrever o parser.** A lição mais cara do projeto: o primeiro parser do PJe foi escrito para uma estrutura que não existia, e só a inspeção real corrigiu.

## Contrato de dados

O JSON exportado é consumido por outro sistema. Mudança no schema descrito em
`docs/json-schema.md` é quebra de contrato — trate como tal.
