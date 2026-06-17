#!/bin/bash
echo "Preparando o ambiente do Arcade Fight..."

# Constrói os contêineres do banco de dados e da API
docker compose build

echo "Instalação concluída! Você já pode iniciar o jogo."