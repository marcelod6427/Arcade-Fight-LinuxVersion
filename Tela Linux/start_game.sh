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

    # 2. Tenta conectar ao servidor remoto (Máximo de 5 tentativas)
    MAX_TENTATIVAS=5
    TENTATIVA=1
    SERVIDOR_ONLINE=false

    echo "Buscando servidor remoto em: $SERVER_URL"

    while [ $TENTATIVA -le $MAX_TENTATIVAS ]; do
        # O curl tenta acessar silenciosamente. Se der sucesso (exit code 0), entra no IF
        if curl -s "$SERVER_URL" > /dev/null; then
            SERVIDOR_ONLINE=true
            echo "Servidor remoto encontrado com sucesso!"
            break
        fi
        
        echo "Tentativa $TENTATIVA de $MAX_TENTATIVAS falhou. Aguardando 1s..."
        sleep 1
        ((TENTATIVA++))
    done

    # 3. Fallback (Plano B): Se a internet caiu ou o servidor falhou, roda local!
    if [ "$SERVIDOR_ONLINE" = false ]; then
        echo "Servidor remoto inacessível. Iniciando modo OFFLINE (Docker local)..."
        
        cd "$ROOT_DIR" || exit
        podman-compose up -d
        
        echo "Aguardando API local iniciar (Timeout de 15s)..."
        TIMEOUT=15
        CONTADOR=0
        while ! curl -s "http://localhost:8000/" > /dev/null; do
            sleep 1
            ((CONTADOR++))
            if [ $CONTADOR -ge $TIMEOUT ]; then
                echo "A API demorou muito. Forçando início do jogo mesmo assim..."
                break
            fi
        done
        echo "Servidor local pronto ou timeout atingido!"
    fi

    # 4. Inicia o jogo Electron
    echo "Iniciando a interface do Arcade..."
    cd "$ROOT_DIR/game" || exit
    npx electron . --no-sandbox

    exit 0
