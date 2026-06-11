#!/bin/bash

# Cores para o terminal
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # Sem cor

ROOT_DIR=$(dirname "$(readlink -f "$0")")
cd "$ROOT_DIR"

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}           ARCADE FIGHT | INSTALADOR LINUX      ${NC}"
echo -e "${GREEN}================================================${NC}\n"

# ======================================================================
# [1/6] Dependências do Sistema (Python 3.12 e Node.js)
# ======================================================================
echo -e "${YELLOW}[1/6] Verificando e instalando dependências do sistema...${NC}"
echo "Isso pode pedir sua senha de usuário (sudo)."

# Atualiza repositórios básicos
sudo apt update -y

# Garante a instalação do Python 3.12 e do pacote venv
if ! command -v python3.12 &> /dev/null; then
    echo -e "${YELLOW}Python 3.12 não encontrado. Instalando...${NC}"
    sudo apt install -y software-properties-common
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt update -y
    sudo apt install -y python3.12 python3.12-venv
else
    echo -e "${GREEN}Python 3.12 já está instalado. Garantindo que o pacote venv também esteja...${NC}"
    sudo apt install -y python3.12-venv
fi

# Garante a instalação do Node.js e do npm
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}Node.js ou npm não encontrados. Instalando versão 22.x LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "${GREEN}Node.js e npm já estão instalados.${NC}"
fi

# ======================================================================
# [2/6] Ambiente virtual Python (venv)
# ======================================================================
echo -e "\n${YELLOW}[2/6] Configurando ambiente virtual Python...${NC}"
cd "$ROOT_DIR/backend" || exit

if [ -d "venv" ]; then
    echo "Removendo venv existente..."
    rm -rf venv
fi

echo "Criando novo ambiente virtual..."
python3.12 -m venv venv || { echo -e "${RED}[ERRO] Falha ao criar venv.${NC}"; exit 1; }
echo -e "${GREEN}Ambiente virtual criado!${NC}"

# ======================================================================
# [3/6] Dependências do backend (Python)
# ======================================================================
echo -e "\n${YELLOW}[3/6] Instalando dependências do backend...${NC}"

source venv/bin/activate
pip install --upgrade pip setuptools wheel --quiet
pip install -r requirements.txt || { echo -e "${RED}[ERRO] Falha nas dependências do backend.${NC}"; exit 1; }
deactivate
echo -e "${GREEN}Dependências do backend instaladas!${NC}"

# ======================================================================
# [4/6] Dependências do jogo (npm)
# ======================================================================
echo -e "\n${YELLOW}[4/6] Instalando dependências do jogo (Electron)...${NC}"
cd "$ROOT_DIR/game" || exit

npm install --no-fund --no-audit || { echo -e "${RED}[ERRO] Falha ao instalar dependências do jogo.${NC}"; exit 1; }
echo -e "${GREEN}Dependências do jogo instaladas!${NC}"

# ======================================================================
# [5/6] Atalho na Área de Trabalho (.desktop)
# ======================================================================
echo -e "\n${YELLOW}[5/6] Criando atalho na Área de Trabalho...${NC}"

DESKTOP_FILE="$HOME/Desktop/Arcade_Fight.desktop"
# Tradução de Desktop em sistemas PT-BR
if [ -d "$HOME/Área de Trabalho" ]; then
    DESKTOP_FILE="$HOME/Área de Trabalho/Arcade_Fight.desktop"
fi

cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Name=Arcade Fight
Comment=Iniciar Arcade Fight
Exec=$ROOT_DIR/start.sh
Icon=utilities-terminal
Terminal=true
Type=Application
Categories=Game;
EOF

chmod +x "$DESKTOP_FILE"
# Dá permissão de execução aos scripts .sh
chmod +x "$ROOT_DIR/start.sh"
chmod +x "$ROOT_DIR/install.sh"

echo -e "${GREEN}Atalho criado!${NC}"

# ======================================================================
# Conclusão
# ======================================================================
echo -e "\n${GREEN}================================================${NC}"
echo -e "${GREEN}       INSTALAÇÃO CONCLUÍDA COM SUCESSO!        ${NC}"
echo -e "${GREEN}================================================${NC}\n"
echo "Para jogar, utilize o atalho 'Arcade Fight' criado na sua"
echo "Área de Trabalho, ou execute o arquivo start.sh no terminal."
echo ""

exit 0