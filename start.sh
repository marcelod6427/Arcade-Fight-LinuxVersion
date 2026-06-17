#!/bin/bash
echo "Iniciando o servidor do Arcade Fight..."

# O parâmetro -d roda o servidor em segundo plano (detached)
docker compose up -d

echo "Servidor online! Iniciando a interface gráfica..."
# Aqui você mantém o comando que abre o Electron (ex: npm start)