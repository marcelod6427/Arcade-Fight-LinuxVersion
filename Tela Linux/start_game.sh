#!/bin/bash

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
NC='\\033[0m'

ROOT_DIR=$(dirname "$(readlink -f "$0")")
cd "$ROOT_DIR"

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}                 ARCADE FIGHT                   ${NC}"
echo -e "${GREEN}================================================${NC}\\n"

# Verificacoes de Integridade
if [ ! -f "$ROOT_DIR/backend/venv/bin/activate" ]; then
    echo -e "${RED}[ERRO] Ambiente virtual do backend nao encontrado.${NC}"
    echo "Execute './install.sh' primeiro."
    read -p "Pressione Enter para sair..."
    exit 1
fi

if [ ! -d "$ROOT_DIR/game/node_modules" ]; then
    echo -e "${RED}[ERRO] Dependencias do jogo nao instaladas.${NC}"
    echo "Execute './install.sh' primeiro."
    read -p "Pressione Enter para sair..."
    exit 1
fi

# Inicializacao do Backend Local
echo -e "\\n${YELLOW}[1/2] Iniciando backend (FastAPI)...${NC}"
cd "$ROOT_DIR/backend" || exit

source venv/bin/activate
python main.py &
BACKEND_PID=$!
deactivate

echo " -> Aguardando backend ficar disponivel..."
sleep 5

# Aguardo Estruturado do Servidor Remoto
echo -e "\\n${YELLOW}[2/2] Verificando servidor Render...${NC}"

# Executa uma chamada de longa duracao com timeout de 30 segundos.
# Como a TelaLinux.py ja iniciou a chamada previamente, este passo deve resolver imediatamente.
"$ROOT_DIR/backend/venv/bin/python" -c "import requests; requests.get('[https://arcade-fight-ifsp.onrender.com](https://arcade-fight-ifsp.onrender.com)', timeout=30)"

echo -e "${GREEN}Servidor online! Iniciando o jogo...${NC}\\n"
echo "Para encerrar, feche a janela do jogo."
echo -e "O backend sera encerrado automaticamente.\\n"

cd "$ROOT_DIR/game" || exit
npx electron . --no-sandbox

# Rotina de Encerramento (Cleanup)
echo -e "\\n${YELLOW}Encerrando backend...${NC}"
if ps -p $BACKEND_PID > /dev/null; then
   kill $BACKEND_PID 2>/dev/null
fi

echo -e "${GREEN}Procedimento concluido com sucesso.${NC}"
sleep 2
exit 0
