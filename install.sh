#!/bin/bash
echo "Preparando o ambiente do Arcade Fight..."

# 1. Atualiza a lista de pacotes do Linux
echo "Atualizando repositórios..."
sudo apt-get update

# 2. Instala o Podman e Podman-Compose (se não existirem)
if ! command -v podman &> /dev/null; then
    echo "Instalando Podman..."
    sudo apt-get install -y podman
fi

if ! command -v podman-compose &> /dev/null; then
    echo "Instalando Podman-Compose..."
    sudo apt-get install -y podman-compose
fi

# 3. Instala o Node.js e NPM (necessários para o Electron)
if ! command -v npm &> /dev/null; then
    echo "Instalando Node.js e NPM..."
    sudo apt-get install -y nodejs npm
fi

# 4. Instala a biblioteca gráfica para a tela de Splash
echo "Instalando dependências do Tkinter..."
sudo apt-get install -y python3-tk

# 5. Instala os pacotes internos do jogo (Electron)
echo "Baixando o motor do jogo (Electron)..."
cd game || exit
npm install
cd ..

# 6. Constrói e sobe os contêineres do banco de dados e da API
echo "Subindo o servidor local..."
podman-compose up -d

echo "--------------------------------------------------------"
echo "Instalação concluída com sucesso!"
echo "O servidor já está rodando em segundo plano."
echo "Você já pode mapear o autostart ou iniciar o jogo."