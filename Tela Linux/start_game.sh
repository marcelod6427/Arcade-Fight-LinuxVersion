#!/bin/bash

# Pega o diretorio onde o script esta (Tela Linux)
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
# Volta uma pasta para acessar a raiz do projeto
ROOT_DIR="$SCRIPT_DIR/.."

# 1. Carrega as variáveis de ambiente do arquivo .env (se ele existir)
if [ -f "$ROOT_DIR/.env" ]; then
    export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
fi

# Define a URL baseada no .env, ou usa localhost como plano B
SERVER_URL=${APP_URL:-http://localhost:8000}

# 2. Aguarda o servidor responder
while ! curl -s "$SERVER_URL" > /dev/null; do
    sleep 1
done

# 3. Inicia o jogo Electron
cd "$ROOT_DIR/game" || exit
npx electron . --no-sandbox

exit 0