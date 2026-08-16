# Extensão de captura de processos

Extensão Chrome para **migrar o acervo processual do advogado** para outro sistema de gestão. Lê o PJe e o SEEU pelo mesmo contrato de saída. Percorre o painel do advogado, baixa cada processo, identifica quais partes são clientes seus e exporta tudo num único JSON.

É ferramenta de migração pontual, não de acompanhamento contínuo.

## Como funciona

Duas fases, desenhadas em cima da estrutura real do PJe 1º grau do TJRN:

**Fase 1 — colher.** Percorre a árvore do ACERVO (comarca → caixa de entrada) e colhe de cada linha o número do processo e a URL de detalhe. Essa fase é obrigatória porque a URL traz um token `ca` por processo que só existe na listagem e não pode ser construído.

**Fase 2 — detalhar.** Busca cada URL de detalhe com `fetch` na própria sessão logada, sem abrir aba nenhuma, e extrai os campos.

O progresso é gravado a cada passo: o popup pode ser fechado, e uma execução interrompida continua de onde parou.

## Por que não Playwright

Não é necessário. O `fetch` dentro da sessão já autenticada devolve a página completa do processo (verificado: HTTP 200, ~216 KB, com todos os campos). Usar Playwright exigiria reautenticar no PJe — que pede certificado digital — sem ganhar nada em troca.

A aba CONSULTA PROCESSOS foi descartada como fonte: tem reCAPTCHA.

## Instalar

1. `chrome://extensions` → ative **Modo de desenvolvedor**.
2. **Carregar sem compactação** → selecione a pasta `pje-json-extension`.

## Usar

1. Abra o **Painel do Advogado** do PJe e faça login.
2. Clique no ícone da extensão, preencha OAB e UF (ex.: `99999` / `RN`).
3. Clique em **Migrar acervo completo**. Acompanhe o progresso — pode fechar o popup, a migração continua na aba do PJe.
4. Ao terminar, clique em **Baixar JSON**.

Deixe a aba do PJe aberta e em primeiro plano durante a fase 1: ela depende de cliques reais na árvore.

## Estrutura

```text
extensao/
  manifest.json
  nucleo/            não sabe de tribunal nenhum
    util.js            esperas, toast, codificação, tribunal/grau pela URL
    estado.js          armazenamento e chave fonte+grau+número
    adaptadores.js     registro e seleção por URL
    migrador.js        orquestra as duas fases
    logger.js          log persistente para diagnóstico
  adaptadores/
    pje/
      parser.js        interpreta a página de detalhe
      coletor.js       percorre a árvore do acervo e registra o adaptador
    seeu/
      parser.js        capa da execução penal, benefícios e movimentações
      coletor.js       atravessa os frames e pagina a listagem
  popup.html / popup.js
  teste/
    parser.teste.js    45 casos do parser do PJe
    seeu.teste.js      30 casos do parser do SEEU
    carga.teste.js     ordem de injeção e contrato dos adaptadores
  samples/ docs/ icons/
```

Para acrescentar um sistema novo (SEEU, Projudi, eSAJ), basta um diretório em
`adaptadores/` que implemente o contrato descrito em `nucleo/adaptadores.js`.
O núcleo não muda.

## Testes

```bash
node teste/parser.teste.js
node teste/seeu.teste.js
node teste/carga.teste.js
```

Cobrem os dois casos que importam: processo cível com advogado no polo ativo, e ação penal com três réus onde só o segundo é cliente.

## Identificação de clientes

O PJe lista cada parte seguida dos próprios advogados:

```
REU PRIMEIRO   → ADVOGADO (OAB RN0000325)
REU SEGUNDO    → ADVOGADO (OAB RN0099999)   ← você
REU TERCEIRO   → (sem advogado)
```

Cada advogado é ligado à parte imediatamente anterior. Quando a OAB bate com a configurada, aquela parte — e só ela — é marcada como cliente. Verificado em processo real com três réus.

A comparação ignora zeros à esquerda: `OAB RN0099999` casa com `99999`.

## O que é capturado

Número, classe (nome e código), assunto (nome e código), jurisdição, órgão julgador, competência, cargo judicial, autuação, última distribuição, valor da causa, segredo de justiça, justiça gratuita, tutela/liminar, prioridade, polos completos com documento (CPF/CNPJ) e advogados com OAB, e a lista de clientes.

Ver `docs/json-schema.md`.

## Limites

- Escrita e verificada contra o **PJe 1º grau do TJRN**. Outro tribunal ou outra versão do PJe pode mudar rótulos e quebrar a extração — rode em poucos processos e confira antes de migrar tudo.
- Não captura movimentações, documentos nem prazos: só o cabeçalho do processo e as partes.
- Fase 1 depende de cliques na árvore; se o PJe mudar os ids dos nós, ela para.
- O painel do PJe degrada sob interação repetida: depois de muitos cliques em AJAX, a aba ACERVO passa a não carregar a árvore e a view cai para `home.seam`. **Comece a migração a partir de um login novo**, sem ter navegado muito antes. Se a árvore não abrir, refaça o login.
- Uma comarca que falhe não derruba as demais: vira aviso e a migração segue. Se a sessão cair no meio, a fase 1 encerra com o que colheu, a fase 2 roda mesmo assim, e uma nova execução retoma pelas comarcas que faltaram (`comarcas_concluidas` no JSON).
- A listagem do acervo pagina de 40 em 40 e a extensão percorre as páginas seguintes. Ainda assim, cada comarca é conferida (colhidos × declarados) e qualquer diferença vira aviso no JSON — confira `avisos` antes de dar a migração por concluída.
- Migra o painel onde a extensão for acionada. Para cobrir tudo, rode uma vez no `pje1g` e outra no `pje2g` — os registros são guardados por grau + número (uma apelação conserva o número da origem, então sem isso o 2º grau sobrescreveria o 1º) e o JSON sai com os dois, nomeado `pje-acervo-1e2g-...`.
- Papel de parte fora da lista conhecida não é descartado, e sim marcado com `papel_incomum`. Códigos de unidade que o PJe põe no fim do nome — `DELEGACIA X (DEAM/ZLOS)` — caem aqui. Descartá-los custaria caro: `REPRESENTANTE/NOTICIANTE` tem a mesma forma e é parte real, com CPF e advogado.

## Diagnóstico

Se algo falhar, **Baixar log** no popup gera um JSON com cada etapa registrada.
