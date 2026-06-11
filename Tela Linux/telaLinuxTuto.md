content = """# Configuração da Tela de Inicialização - Projeto Arcade

Este documento apresenta o guia passo a passo para configurar o aplicativo de inicialização (Splash Screen) em Python (`TelaLinux.py`) integrado ao script de inicialização do jogo (`start_game.sh`). O objetivo é fazer com que o sistema exiba a interface visual imediatamente após o login do Linux, otimizando o carregamento do servidor remoto no Render em segundo plano.

---

## 1. Visão Geral do Fluxo de Inicialização

1. **Inicialização do Sistema**: O Linux carrega o ambiente gráfico e executa o script `TelaLinux.py` em modo de tela cheia.
2. **Ativação Antecipada (Render)**: No exato instante em que a tela abre, o Python dispara uma requisição HTTP assíncrona (em uma thread separada) para a URL da API no Render. Isso inicia o processo de "acordar" o servidor remoto sem congelar a interface.
3. **Interação do Usuário**: O aplicativo monitora qualquer entrada de hardware (pressionamento de qualquer botão do painel arcade ou teclado).
4. **Transição Eficiente**: Assim que um botão é detectado, a tela do Python se encerra e invoca o script de lote `start_game.sh`.
5. **Carregamento Otimizado**: O script `start_game.sh` inicia o backend local e faz uma checagem única de até 30 segundos utilizando o ambiente virtual. Como o servidor já começou a ser acordado previamente pelo Python, o tempo de espera real em linha de comando é severamente reduzido.

---

## 2. Arquivos Necessários

Ambos os arquivos devem residir no mesmo diretório para o correto funcionamento das chamadas relativas de caminho.

### 2.1. Arquivo Python (`TelaLinux.py`)

Crie o arquivo `TelaLinux.py` e insira o seguinte código: