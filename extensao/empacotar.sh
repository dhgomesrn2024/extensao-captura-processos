#!/usr/bin/env bash
#
# Gera o ZIP distribuível da extensão.
#
# A extensão é a mesma em Mac, Windows e Linux — extensão do Chrome não tem
# código de sistema operacional. Este script só separa o que roda do que é
# desenvolvimento (testes, amostras, documentação), para o pacote ficar enxuto.
#
# Uso:  ./empacotar.sh
set -euo pipefail

cd "$(dirname "$0")"

VERSAO=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
SAIDA="../dist/captura-processos-${VERSAO}.zip"

mkdir -p ../dist
rm -f "$SAIDA"

# Roda os testes antes: pacote com teste quebrado não deveria existir.
for t in teste/*.teste.js; do
  node "$t" > /dev/null || { echo "FALHOU: $t — pacote não gerado"; exit 1; }
done

zip -q -r "$SAIDA" \
  manifest.json \
  popup.html popup.js \
  nucleo adaptadores \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  README.md

echo "Gerado: $(cd .. && pwd)/dist/captura-processos-${VERSAO}.zip"
unzip -l "$SAIDA" | tail -1
