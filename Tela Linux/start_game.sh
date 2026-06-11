#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Pega o diretorio onde o script esta (Tela Linux)
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
# Volta uma pasta para acessar a raiz do projeto
ROOT_DIR="$SCRIPT_DIR/.."
cd "$ROOT_DIR" || exit

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}                 ARCADE FIGHT                   ${NC}"
echo -e "${GREEN}================================================${NC}\n"

# ... (o resto do script continua identico daqui para baixo)
