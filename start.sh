#!/bin/bash
# =============================================================================
# start.sh — Script principal para iniciar o Arcade Fight no Linux
#
# Este script inicia a interface gráfica (Splash Screen) em Python (Tkinter).
# A interface em Python gerencia o fluxo do jogo: ao receber qualquer entrada
# de tecla, ela chama o script interno (Tela Linux/start_game.sh) que aguarda
# a API local responder e então executa o motor do jogo (Electron).
#
# Uso:
#   ./start.sh
# =============================================================================

# Determina o diretório absoluto do script
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")

# Executa o Splash Screen do Arcade
python3 "$SCRIPT_DIR/Tela Linux/telaLinux.py"
