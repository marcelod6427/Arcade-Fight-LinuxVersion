#!/bin/bash

# Pega o diretorio onde o script esta (Tela Linux)
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
# Volta uma pasta para acessar a raiz do projeto
ROOT_DIR="$SCRIPT_DIR/.."
cd "$ROOT_DIR" || exit

# 1. Garante que a API e o Banco de Dados estão rodando em segundo plano
docker compose up -d

# 2. Aguarda a API local ficar pronta (como é local, leva 1 ou 2 segundos)
# O comando curl tenta acessar a API invisivelmente até ela responder
while ! curl -s http://localhost:8000/ > /dev/null; do
    sleep 1
done

# 3. Inicia o jogo Electron (ele vai abrir por cima da tela do Tkinter)
cd "$ROOT_DIR/game" || exit
npx electron . --no-sandbox

# 4. Quando o jogador fechar o Electron, o script chega aqui.
# Como o Docker consome pouca memória, podemos deixá-lo rodando para a próxima partida abrir mais rápido!
exit 0