#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR=$(dirname "$(readlink -f "$0")")
cd "$ROOT_DIR"

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}                 ARCADE FIGHT                   ${NC}"
echo -e "${GREEN}================================================${NC}\n"

# ================================================
# Verificações
# ================================================

if [ ! -f "$ROOT_DIR/backend/venv/bin/activate" ]; then
    echo -e "${RED}[ERRO] Ambiente virtual do backend não encontrado.${NC}"
    echo "Execute './install.sh' primeiro."
    read -p "Pressione Enter para sair..."
    exit 1
fi

if [ ! -d "$ROOT_DIR/game/node_modules" ]; then
    echo -e "${RED}[ERRO] Dependências do jogo não instaladas.${NC}"
    echo "Execute './install.sh' primeiro."
    read -p "Pressione Enter para sair..."
    exit 1
fi

# ================================================
# PING antecipado ao Render (acorda o servidor)
# ================================================
echo -e "${YELLOW}Enviando sinal de ativação ao servidor remoto...${NC}"
curl -s -o /dev/null --max-time 60 https://arcade-fight-ifsp.onrender.com &

# ================================================
# BACKEND
# ================================================
echo -e "\n${YELLOW}[1/2] Iniciando backend (FastAPI)...${NC}"
cd "$ROOT_DIR/backend" || exit

# Inicia o backend em background e salva o PID (Process ID)
source venv/bin/activate
python main.py &
BACKEND_PID=$!
deactivate

echo " -> Aguardando backend ficar disponível..."
sleep 5

# ================================================
# JOGO
# ================================================
echo -e "\n${YELLOW}[2/2] Iniciando jogo (Electron)...${NC}"
echo ""

# Verificando servidor online
TENTATIVA=1
MAX_TENTATIVAS=5
SERVIDOR_ONLINE=0

while [ $TENTATIVA -le $MAX_TENTATIVAS ]; do
    echo "Verificando conexão com o servidor... (tentativa $TENTATIVA/$MAX_TENTATIVAS)"
    
    # Testa a conexão e procura por "API rodando" na resposta
    RESPOSTA=$(curl -s --max-time 5 https://arcade-fight-ifsp.onrender.com)
    
    if echo "$RESPOSTA" | grep -q "API rodando"; then
        echo -e "${GREEN}Servidor online! Iniciando o jogo...${NC}\n"
        SERVIDOR_ONLINE=1
        break
    else
        if [ $TENTATIVA -eq $MAX_TENTATIVAS ]; then
            echo -e "${RED}Conexão falhou após $MAX_TENTATIVAS tentativas. Iniciando modo offline...${NC}\n"
            break
        fi
        echo "Servidor não respondeu. Aguardando 6s antes da próxima tentativa..."
        sleep 6
        ((TENTATIVA++))
    fi
done

echo "Para encerrar, feche a janela do jogo."
echo -e "O backend será encerrado automaticamente.\n"

cd "$ROOT_DIR/game" || exit
npx electron .

# ================================================
# CLEANUP (Quando o jogo fechar)
# ================================================
echo -e "\n${YELLOW}Encerrando backend...${NC}"
# Mata o processo do backend que estava rodando em background
if ps -p $BACKEND_PID > /dev/null; then
   kill $BACKEND_PID 2>/dev/null
fi

echo -e "${GREEN}Tchau!${NC}"
sleep 2
exit 0
