# =============================================================================
# main.py — API FastAPI do Arcade Fight
#
# Ponto de entrada do backend. Serve dois tipos de clientes:
#
#   1. Jogo Electron (game/api.js)
#        POST /sala/criar              → cria sala, retorna QR Code
#        GET  /sala/{id}               → polling de status da sala (a cada 1.5s)
#        DELETE /sala/{id}             → cancela sala ao voltar ao menu
#        POST /partida/resultado       → registra resultado ao fim da partida
#        GET  /placar/qr               → retorna QR apontando para placar.html
#        GET  /                        → healthcheck (verificarConexao no boot)
#
#   2. Site mobile (browser no celular do jogador)
#        POST /auth/cadastro           → cria conta
#        POST /auth/login              → autentica e retorna JWT
#        POST /sala/{id}/entrar        → entra na sala com o JWT
#        GET  /placar                  → ranking top 20
#        /site/*                       → arquivos estáticos (login.html, placar.html)
#
# Autenticação:
#   JWT HS256 com expiração de 24h. O campo "sub" do payload contém o nick.
#   O Electron só usa o token do P1 (recebido via polling da sala) para registrar resultado.
#   O site mobile usa o token para entrar na sala via /sala/{id}/entrar.
#
# Variáveis de ambiente (.env em dev, variáveis do Render em produção):
#   SECRET_KEY  — chave de assinatura JWT (trocar em produção)
#   APP_URL     — URL base pública (ex: https://arcade-fight.onrender.com)
#   DATABASE_URL — connection string PostgreSQL (injetada automaticamente no Render)
#
# Dependências externas:
#   database.py       — todas as operações SQL (PostgreSQL via psycopg2)
#   qrcode_service.py — geração de QR Code em base64 (sem Pillow, usa pypng)
# =============================================================================

import uuid
import os
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from passlib.context import CryptContext
from jose import JWTError, jwt

from dotenv import load_dotenv
load_dotenv()

import database as db
from qrcode_service import gerar_qr_base64

import warnings
warnings.filterwarnings("ignore")  # suprime avisos do passlib sobre bcrypt


# =============================================================================
# Configuração
# =============================================================================

# SECRET_KEY: assina e valida todos os JWTs. Em produção, definir via variável de ambiente.
SECRET_KEY = os.getenv("SECRET_KEY", "arcade_fight_secret_2024")

# APP_URL: base das URLs geradas nos QR Codes. Em produção = URL do Render.
APP_URL    = os.getenv("APP_URL", "https://arcade-fight-ifsp.onrender.com").rstrip("/")

ALGORITHM          = "HS256"
TOKEN_EXPIRE_HOURS = 24  # JWTs expiram em 24h

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="Arcade Fight API", version="2.0.0")

# CORS aberto para todos os origens — necessário para o Electron (file://) e celulares na LAN.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve os arquivos do site mobile em /site/* se o diretório existir.
# login.html e placar.html ficam em backend/site/ e são acessados pelo celular via QR.
SITE_DIR = os.path.join(os.path.dirname(__file__), "site")
if os.path.exists(SITE_DIR):
    app.mount("/site", StaticFiles(directory=SITE_DIR), name="site")

# Cria as tabelas do banco se ainda não existirem (idempotente).
db.init_db()


# =============================================================================
# Helpers internos
# =============================================================================

def hash_senha(senha: str) -> str:
    """Gera o hash bcrypt de uma senha em texto plano."""
    return pwd_context.hash(senha)


def verificar_senha(senha: str, hashed: str) -> bool:
    """Verifica se uma senha em texto plano corresponde ao hash bcrypt armazenado."""
    return pwd_context.verify(senha, hashed)


def criar_token(data: dict) -> str:
    """Gera um JWT HS256 com expiração de TOKEN_EXPIRE_HOURS horas.

    data deve conter {'sub': nick} — o nick é usado para identificar o jogador
    em qualquer rota que receba um token.
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def obter_jogador_token(token: str):
    """Decodifica um JWT e retorna o dict do jogador do banco, ou None se inválido.

    Usado pelas rotas que recebem token no body (entrar_sala, registrar_resultado)
    para validar autenticidade antes de processar a requisição.
    Retorna None tanto para token malformado quanto para nick inexistente.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        nick: str = payload.get("sub")
        if nick is None:
            return None
        return db.buscar_jogador_nick(nick)
    except JWTError:
        return None


# =============================================================================
# Schemas Pydantic — validação automática do corpo das requisições
# =============================================================================

class CadastroSchema(BaseModel):
    nick: str   # mínimo 3 caracteres (validado na rota)
    senha: str  # mínimo 4 caracteres (validado na rota)


class LoginSchema(BaseModel):
    nick: str
    senha: str


class CriarSalaSchema(BaseModel):
    modo: str  # "single" ou "multi"


class EntrarSalaSchema(BaseModel):
    token: str  # JWT do jogador autenticado no site mobile


class ResultadoSchema(BaseModel):
    sala_id:   str
    token:     str  # JWT do P1 (único token disponível no Electron)
    pontos_j1: int  # dano total causado pelo P1 durante a partida
    pontos_j2: int = 0  # dano total do P2 (0 em modo single, P2 é CPU)


# =============================================================================
# Rotas — Autenticação (usadas pelo site mobile)
# =============================================================================

@app.post("/auth/cadastro")
def cadastro(dados: CadastroSchema):
    """Registra um novo jogador e retorna seu JWT.

    Validações:
      - nick: mínimo 3 caracteres
      - senha: mínimo 4 caracteres
      - nick único (db.criar_jogador retorna False em duplicata → 400)

    Retorno: { ok, token, nick }
    """
    if len(dados.nick.strip()) < 3:
        raise HTTPException(400, "Nick deve ter pelo menos 3 caracteres")
    if len(dados.senha) < 4:
        raise HTTPException(400, "Senha deve ter pelo menos 4 caracteres")

    hashed = hash_senha(dados.senha)
    ok = db.criar_jogador(dados.nick.strip(), hashed)
    if not ok:
        raise HTTPException(400, "Nick ja cadastrado")

    token = criar_token({"sub": dados.nick.strip()})
    return {"ok": True, "token": token, "nick": dados.nick.strip()}


@app.post("/auth/login")
def login(dados: LoginSchema):
    """Autentica um jogador existente e retorna seu JWT com estatísticas.

    Retorno: { ok, token, nick, vitorias, pontos }
    """
    jogador = db.buscar_jogador_nick(dados.nick.strip())
    if not jogador or not verificar_senha(dados.senha, jogador["senha_hash"]):
        raise HTTPException(401, "Nick ou senha incorretos")

    token = criar_token({"sub": jogador["nick"]})
    return {
        "ok": True,
        "token": token,
        "nick": jogador["nick"],
        "vitorias": jogador["vitorias"],
        "pontos": jogador["pontos"]
    }


# =============================================================================
# Rotas — Salas (usadas pelo jogo Electron e pelo site mobile)
# =============================================================================

@app.post("/sala/criar")
def criar_sala(dados: CriarSalaSchema):
    """Cria uma nova sala e retorna o QR Code para o celular escanear.

    Gera um sala_id de 8 caracteres (UUID truncado e capitalizado).
    O QR Code aponta para /site/login.html?sala=<id>&modo=<modo>
    onde o jogador se autentica via navegador do celular.

    Chamado por: game/api.js → Api.criarSala(modo)
    Retorno: { ok, sala_id, modo, url_mobile, qr_base64 }
    """
    if dados.modo not in ("single", "multi"):
        raise HTTPException(400, "Modo invalido. Use 'single' ou 'multi'")

    sala_id = str(uuid.uuid4())[:8].upper()
    db.criar_sala(sala_id, dados.modo)

    url_mobile = f"{APP_URL}/site/login.html?sala={sala_id}&modo={dados.modo}"
    qr_base64  = gerar_qr_base64(url_mobile)

    return {
        "ok": True,
        "sala_id": sala_id,
        "modo": dados.modo,
        "url_mobile": url_mobile,
        "qr_base64": qr_base64
    }


@app.get("/sala/{sala_id}")
def status_sala(sala_id: str):
    """Retorna o estado atual de uma sala (jogadores conectados, status).

    Chamado em polling a cada 1.5s pelo jogo Electron enquanto aguarda jogadores.
    Resolve jogador1_id e jogador2_id em nicks consultando a tabela jogadores.

    Chamado por: game/api.js → Api.statusSala(salaId)
    Retorno: {
        sala_id, modo, status,
        jogador1: { nick, id, token } | null,
        jogador2: { nick, id, token } | null
    }
    status: 'aguardando' | 'pronto' | 'em_jogo' | 'finalizado'
    """
    sala = db.buscar_sala(sala_id)
    if not sala:
        raise HTTPException(404, "Sala nao encontrada")

    j1 = db.buscar_jogador_id(sala["jogador1_id"]) if sala["jogador1_id"] else None
    j2 = db.buscar_jogador_id(sala["jogador2_id"]) if sala["jogador2_id"] else None

    return {
        "sala_id": sala_id,
        "modo": sala["modo"],
        "status": sala["status"],
        "jogador1": {"nick": j1["nick"], "id": j1["id"], "token": sala["token_j1"]} if j1 else None,
        "jogador2": {"nick": j2["nick"], "id": j2["id"], "token": sala["token_j2"]} if j2 else None,
    }


@app.post("/sala/{sala_id}/entrar")
def entrar_sala_endpoint(sala_id: str, dados: EntrarSalaSchema):
    """Associa o jogador autenticado a um slot da sala.

    Usado pelo site mobile após o jogador fazer login/cadastro.
    O token JWT identifica o jogador; db.entrar_sala() decide qual slot ocupar.

    Validações:
      - Token válido (obter_jogador_token)
      - Sala existe
      - Sala não está 'em_jogo' ou 'finalizado'
      - Sala não está cheia (db.entrar_sala retorna None se não houver slot)

    Retorno: { ok, slot (1 ou 2), nick, status, token }
    """
    jogador = obter_jogador_token(dados.token)
    if not jogador:
        raise HTTPException(401, "Token invalido")

    sala = db.buscar_sala(sala_id)
    if not sala:
        raise HTTPException(404, "Sala nao encontrada")
    if sala["status"] == "em_jogo":
        raise HTTPException(400, "Partida ja em andamento")
    if sala["status"] == "finalizado":
        raise HTTPException(400, "Sala ja encerrada")

    slot = db.entrar_sala(sala_id, jogador["id"], dados.token)
    if slot is None:
        raise HTTPException(400, "Sala cheia")

    sala_atualizada = db.buscar_sala(sala_id)
    return {
        "ok": True,
        "slot": slot,
        "nick": jogador["nick"],
        "status": sala_atualizada["status"],
        "token": dados.token
    }


@app.delete("/sala/{sala_id}")
def cancelar_sala_endpoint(sala_id: str):
    """Remove a sala do banco (DELETE físico).

    Chamado quando o jogador volta ao menu antes da partida iniciar.
    Se a sala não existir, retorna ok=True silenciosamente (idempotente) —
    o frontend faz fire-and-forget, então não trata erros aqui.

    Chamado por: game/api.js → Api.cancelarSala(salaId)
    Retorno: { ok, msg }
    """
    sala = db.buscar_sala(sala_id)
    if not sala:
        return {"ok": True, "msg": "Sala ja inexistente"}
    db.cancelar_sala(sala_id)
    return {"ok": True, "msg": "Sala cancelada"}


# =============================================================================
# Rotas — Resultado da partida
# =============================================================================

@app.post("/partida/resultado")
def registrar_resultado(dados: ResultadoSchema):
    """Registra o resultado da partida e atualiza as estatísticas dos jogadores.

    Chamado pelo Electron ao final do GAME_OVER, apenas em modo online.
    O token enviado é o JWT do P1 (único token disponível no Electron);
    o vencedor é determinado comparando o ID do P1 com os slots da sala.

    Fluxo:
      1. Valida token → identifica o vencedor pelo ID
      2. Determina perdedor_id e distribui os pontos corretos (j1 ou j2)
         conforme o slot do vencedor
      3. db.atualizar_stats(vencedor, vitoria=True)
      4. db.atualizar_stats(perdedor, vitoria=False) — apenas se perdedor existe (multi)
      5. db.registrar_partida() — histórico na tabela partidas
      6. db.atualizar_status_sala('finalizado')

    Chamado por: game/api.js → Api.registrarResultado(salaId, tokenVencedor, pontosJ1, pontosJ2)
    Retorno: { ok, vencedor (nick), pontos_ganhos }
    """
    vencedor = obter_jogador_token(dados.token)
    if not vencedor:
        raise HTTPException(401, "Token invalido")

    sala = db.buscar_sala(dados.sala_id)
    if not sala:
        raise HTTPException(404, "Sala nao encontrada")

    j1_id = sala["jogador1_id"]
    j2_id = sala["jogador2_id"]

    # Identifica qual conjunto de pontos pertence ao vencedor pelo slot
    if vencedor["id"] == j1_id:
        perdedor_id   = j2_id
        pts_vencedor  = dados.pontos_j1
        pts_perdedor  = dados.pontos_j2
    else:
        perdedor_id   = j1_id
        pts_vencedor  = dados.pontos_j2
        pts_perdedor  = dados.pontos_j1

    db.atualizar_stats(vencedor["id"], pts_vencedor, vitoria=True)
    if perdedor_id:  # None em modo single (CPU não tem conta)
        db.atualizar_stats(perdedor_id, pts_perdedor, vitoria=False)

    db.registrar_partida(
        dados.sala_id, sala["modo"],
        j1_id, j2_id,
        vencedor["id"],
        dados.pontos_j1, dados.pontos_j2
    )
    db.atualizar_status_sala(dados.sala_id, "finalizado")

    return {"ok": True, "vencedor": vencedor["nick"], "pontos_ganhos": pts_vencedor}


# =============================================================================
# Rotas — Placar (usadas pelo site mobile e pelo jogo)
# =============================================================================

@app.get("/placar")
def buscar_placar():
    """Retorna os top 20 jogadores ordenados por pontos e vitórias.

    Usado por placar.html no site mobile para exibir o ranking.
    Retorno: { ok, ranking: [{ nick, vitorias, pontos }, ...] }
    """
    ranking = db.listar_placar(limit=20)
    return {"ok": True, "ranking": ranking}


@app.get("/placar/qr")
def placar_qr():
    """Gera e retorna um QR Code apontando para a página de placar do site mobile.

    Chamado pelo Electron 2.5s após o GAME_OVER para exibir o QR na tela.
    O jogador escaneia para ver o ranking completo no celular.

    Chamado por: game/api.js → Api.placarQR()
    Retorno: { ok, url, qr_base64 }
    """
    url_placar = f"{APP_URL}/site/placar.html"
    qr_base64  = gerar_qr_base64(url_placar)
    return {"ok": True, "url": url_placar, "qr_base64": qr_base64}


# =============================================================================
# Rota raiz — healthcheck
# =============================================================================

@app.get("/")
def root():
    """Healthcheck usado pelo Electron no boot para verificar conectividade.

    game/api.js → Api.verificarConexao() faz GET / com timeout de 3s.
    Se responder 200, o jogo opera em modo online; caso contrário, modo offline.
    Retorno: { status, docs, placar }
    """
    return {
        "status": "Arcade Fight API rodando!",
        "docs":   f"{APP_URL}/docs",
        "placar": f"{APP_URL}/site/placar.html"
    }


# =============================================================================
# Entrypoint para desenvolvimento local
# =============================================================================

if __name__ == "__main__":
    # Em produção (Render), o servidor é iniciado pelo Procfile/start command,
    # não por este bloco. Este bloco só é executado com: python main.py
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
