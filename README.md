# ARCADE FIGHT

> Jogo de luta 2D estilo arcade, desenvolvido como Projeto Integrador Escolar no IFSP.

---

## O QUE É

Arcade Fight é um jogo de luta 2D inspirado nos clássicos dos fliperamas dos anos 90. Dois jogadores escolhem entre cinco personagens únicos e se enfrentam em combates no melhor de dois rounds. O projeto foi desenvolvido para rodar em um gabinete arcade físico da instituição, mas funciona normalmente em qualquer computador com Windows ou distribuições Linux.

---

## PERSONAGENS

| Personagem | Estilo | Especial |
|---|---|---|
| **Espadachim** | Veloz, cortes rápidos | Lâmina Veloz — investida com corte em área |
| **Lutador** | Resistente, golpes pesados | Impacto Sísmico — salta e causa dano em área ao pousar |
| **Mago** | Longa distância | Tempestade Arcana — dispara 3 projéteis simultâneos |
| **Vampira** | Defensiva, invencível | Véu de Sangue — 2 segundos de invencibilidade total |
| **Vampiro** | Mobilidade extrema | Sombra Veloz — teleporte atrás do inimigo seguido de ataque |

---

## MECÂNICAS DE JOGO

* **Sistema de rounds** — melhor de 3 rounds (Best of 3) decide o vencedor (primeiro a vencer 2 rounds)
* **Barra de especial** — carregada causando dano; usa o especial quando cheia
* **Bloqueio** — reduz o dano recebido para 30%
* **Counter** — janela de 300ms que reverte o golpe com 1,5× de dano para o atacante
* **IA adaptativa** — três níveis: fácil, médio e difícil, com reações e agressividade diferentes
* **Projéteis** — Mago dispara orbes independentes que percorrem o cenário

---

## COMO FUNCIONA

O jogo verifica automaticamente a conexão com a internet ao iniciar. Se houver conexão, conecta ao servidor online e permite que os jogadores façam login pelo celular escaneando um QR code único gerado para aquela sessão. Após o login, os jogadores escolhem seus personagens e a luta começa. Ao final, o resultado é registrado no banco de dados e o ranking é atualizado.

Se não houver conexão, o jogo abre no modo offline com jogadores identificados como convidados, sem salvar resultados.

Também é possível iniciar a partida sem login clicando em **"Jogar sem Login"** na tela do QR code.

Durante qualquer partida, pressionar os botões **Single Player** ou **Multi Player** exibe uma confirmação de saída. No modo online, um aviso informa que os dados não serão salvos caso o jogador opte por retornar ao menu.

---

## MODOS DE JOGO

| Modo | Descrição |
|---|---|
| **Single Player** | Um jogador humano contra a Inteligência Artificial |
| **Multi Player** | Dois jogadores humanos no mesmo gabinete |
| **Offline** | Qualquer modo, sem conexão — nenhum resultado é salvo |

---

## CONTROLES

### Controle Arcade (mapeamento padrão)

| Ação | P1 | P2 |
|---|---|---|
| Pular | 🟢 Verde | 🟢 Verde |
| Ataque rápido | 🟡 Amarelo | 🟡 Amarelo |
| Ataque forte | ⚫ Preto | ⚫ Preto |
| Bloquear | 🔴 Vermelho | 🔴 Vermelho |
| Especial | 🔵 Azul | 🔵 Azul |
| Singleplayer | L2 | — |
| Multiplayer | — | R2 |

---

## MENU DE CONFIGURAÇÕES

Acessado pelo botão ⚙ no canto superior esquerdo da tela inicial. Possui duas abas:

* **Som** — controle independente de volume para o Volume Geral (Master), trilhas sonoras (músicas) e efeitos sonoros dos personagens (SFX), com valores de 0–100% salvos automaticamente entre sessões. Também conta com um botão rápido para mutar todo o áudio.
* **Créditos** — informações sobre a equipe de desenvolvimento do projeto, repositório de código, ferramentas de IA e recursos de áudio e aprendizado utilizados.

Toda a navegação do menu de configurações suporta reações via teclado e controles arcade.

---

## SISTEMA DE ÁUDIO

O jogo possui duas camadas de áudio independentes:

**Trilhas sonoras (SoundManager)**
* Menu inicial, configurações e seleção de personagem: `menuInicial.mp3`
* Durante a partida: `luta.mp3`
* Game Over e tela de resultados: `fimDoJogo.mp3`
* Transição suave com crossfade de 1,5 segundos entre as faixas

**Efeitos sonoros dos personagens (SFXManager)**
* Cada personagem possui 5 efeitos: ataque 1, ataque 2, especial, dano recebido e morte
* Tocam somente durante a partida, em canais independentes da trilha sonora

---

## TECNOLOGIAS UTILIZADAS

**Desktop / Frontend**
* Electron.js — empacotamento do aplicativo desktop
* HTML5 Canvas — renderização do jogo em tempo real
* JavaScript puro — lógica do jogo, física, IA, controles
* Web Gamepad API — suporte a controles arcade físicos

**Backend**
* Python 3.12 + FastAPI — servidor de API REST
* PostgreSQL — banco de dados de jogadores e resultados
* Render.com — hospedagem do servidor e banco de dados

**Mobile (páginas de login)**
* HTML / CSS / JavaScript — acessadas via QR code pelo navegador do celular

---

## FERRAMENTAS DE IA UTILIZADAS

| Ferramenta | Uso |
|---|---|
| **Claude AI (Anthropic)** | Geração, revisão e refatoração de código |
| **Suno AI** | Composição das trilhas sonoras do jogo |
| **ChatGPT (OpenAI)** | Geração de imagens e pesquisa de conteúdo |

---

# INSTALAÇÃO E EXECUÇÃO (LINUX)

O projeto conta com scripts de automação que configuram todo o ambiente local (instalando Node.js, NPM, dependências do Electron, Tkinter para a interface Python e Podman/Podman-Compose para subir os serviços locais de banco de dados e API).

## Requisitos Prévios

1. Sistema operacional Linux baseado em Debian (Ubuntu, Linux Mint, Pop!_OS, etc.).
2. Acesso de administrador (`sudo`).

## Passo a Passo

### 1. Instalar o Git

Caso ainda não tenha o Git instalado no sistema, execute:

```bash
sudo apt update
sudo apt install git -y
```

### 2. Baixar o repositório

Clone o repositório e acesse a pasta do projeto:

```bash
git clone https://github.com/marcelod6427/Arcade-Fight-LinuxVersion.git
cd Arcade-Fight-LinuxVersion
```

### 3. Conceder permissão de execução aos scripts

Para garantir que todos os scripts rodem sem problemas de permissão:

```bash
chmod +x install.sh start.sh "Tela Linux/start_game.sh" "Tela Linux/telaLinux.py"
```

### 4. Executar o instalador

Rode o script de instalação para preparar o ambiente. Ele instalará as dependências do sistema e do Node.js, além de subir o banco de dados e o servidor local FastAPI em segundo plano via Podman/Docker:

```bash
./install.sh
```

### 5. Iniciar o jogo

Você pode iniciar o Arcade Fight de duas formas:

**Opção 1 — Execução Manual (via Terminal)**

A partir da raiz do projeto, execute o script principal:

```bash
./start.sh
```

**Opção 2 — Inicialização Automática (Autostart no Boot)**

Para gabinetes arcade físicos onde o jogo deve iniciar automaticamente em tela cheia logo após o login do sistema, consulte o passo a passo completo no arquivo [Guia Inicialização Arcade.pdf](file:///C:/Users/marcelo/Desktop/Arcade-Fight-LinuxVersion/Guia%20Inicialização%20Arcade.pdf) incluído no repositório.

---
