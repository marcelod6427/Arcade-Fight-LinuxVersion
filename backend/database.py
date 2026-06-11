# =============================================================================
# database.py — Camada de acesso ao banco de dados PostgreSQL
#
# Todas as funções abrem e fecham a conexão de forma independente (sem pool).
# Isso é adequado para o volume do projeto; se o tráfego crescer, substituir
# get_conn() por um pool (psycopg2.pool ou asyncpg).
#
# Variável de ambiente obrigatória:
#   DATABASE_URL — connection string PostgreSQL no formato:
#   postgresql://usuario:senha@host:porta/banco
#   Em produção (Render.com), injetada automaticamente pelo serviço de banco.
#   Em dev local, pode ser definida em .env e carregada via python-dotenv em main.py.
#
# Schema das tabelas:
#
#   jogadores
#     id          SERIAL PK
#     nick        TEXT UNIQUE NOT NULL
#     senha_hash  TEXT NOT NULL        — hash bcrypt da senha
#     vitorias    INTEGER DEFAULT 0
#     pontos      INTEGER DEFAULT 0    — soma de dano causado em todas as partidas
#     criado_em   TIMESTAMP
#
#   salas
#     id          TEXT PK              — 8 chars UUID truncado, ex: "A3F7C21B"
#     modo        TEXT NOT NULL        — 'single' | 'multi'
#     jogador1_id INTEGER FK jogadores
#     jogador2_id INTEGER FK jogadores
#     token_j1    TEXT                 — JWT do jogador 1 (guardado para /sala/{id})
#     token_j2    TEXT                 — JWT do jogador 2
#     status      TEXT DEFAULT 'aguardando'  — 'aguardando'|'pronto'|'em_jogo'|'finalizado'
#     criada_em   TIMESTAMP
#
#   partidas
#     id          SERIAL PK
#     sala_id     TEXT FK salas
#     modo        TEXT NOT NULL
#     jogador1_id INTEGER FK jogadores NOT NULL
#     jogador2_id INTEGER FK jogadores           — NULL em partidas single
#     vencedor_id INTEGER FK jogadores NOT NULL
#     pontos_j1   INTEGER DEFAULT 0
#     pontos_j2   INTEGER DEFAULT 0
#     jogada_em   TIMESTAMP
#
# Chamado por main.py:
#   init_db()              — no boot do FastAPI (antes de registrar as rotas)
#   criar_jogador          — POST /auth/cadastro
#   buscar_jogador_nick    — POST /auth/login, obter_jogador_token()
#   buscar_jogador_id      — GET /sala/{id}
#   listar_placar          — GET /placar
#   atualizar_stats        — POST /partida/resultado
#   criar_sala             — POST /sala/criar
#   buscar_sala            — GET /sala/{id}, POST /sala/{id}/entrar, DELETE /sala/{id}, POST /partida/resultado
#   entrar_sala            — POST /sala/{id}/entrar
#   atualizar_status_sala  — POST /partida/resultado
#   cancelar_sala          — DELETE /sala/{id}
#   registrar_partida      — POST /partida/resultado
# =============================================================================

import os
import psycopg2
import psycopg2.extras
import psycopg2.errors

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL não definida. "
        "Configure em backend/.env (dev local) ou nas variáveis de ambiente do Render."
    )


def get_conn():
    """Abre e retorna uma nova conexão com o banco PostgreSQL.

    Usa DATABASE_URL do ambiente. Cada função de banco abre sua própria
    conexão e a fecha no bloco finally — sem pool de conexões.
    """
    return psycopg2.connect(DATABASE_URL)


def init_db():
    """Cria as tabelas do banco se ainda não existirem (CREATE TABLE IF NOT EXISTS).

    Chamada uma vez no boot de main.py, antes de qualquer requisição.
    Segura para re-execuções: não destrói dados existentes.
    Tabelas criadas: jogadores, salas, partidas.
    """
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS jogadores (
            id SERIAL PRIMARY KEY,
            nick TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            vitorias INTEGER DEFAULT 0,
            pontos INTEGER DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS salas (
            id TEXT PRIMARY KEY,
            modo TEXT NOT NULL,
            jogador1_id INTEGER,
            jogador2_id INTEGER,
            token_j1 TEXT,
            token_j2 TEXT,
            status TEXT DEFAULT 'aguardando',
            criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (jogador1_id) REFERENCES jogadores(id),
            FOREIGN KEY (jogador2_id) REFERENCES jogadores(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS partidas (
            id SERIAL PRIMARY KEY,
            sala_id TEXT,
            modo TEXT NOT NULL,
            jogador1_id INTEGER NOT NULL,
            jogador2_id INTEGER,
            vencedor_id INTEGER NOT NULL,
            pontos_j1 INTEGER DEFAULT 0,
            pontos_j2 INTEGER DEFAULT 0,
            jogada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sala_id) REFERENCES salas(id),
            FOREIGN KEY (jogador1_id) REFERENCES jogadores(id),
            FOREIGN KEY (jogador2_id) REFERENCES jogadores(id),
            FOREIGN KEY (vencedor_id) REFERENCES jogadores(id)
        )
    """)

    conn.commit()
    conn.close()


# =============================================================================
# Jogadores
# =============================================================================

def criar_jogador(nick: str, senha_hash: str) -> bool:
    """Insere um novo jogador na tabela jogadores.

    Retorna True em sucesso, False se o nick já estiver cadastrado
    (UniqueViolation é capturada e convertida em False ao invés de exceção).
    Qualquer outro erro de banco é re-lançado após rollback.
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        c.execute(
            "INSERT INTO jogadores (nick, senha_hash) VALUES (%s, %s)",
            (nick.strip(), senha_hash)
        )
        conn.commit()
        return True
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return False
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def buscar_jogador_nick(nick: str):
    """Busca um jogador pelo nick. Retorna dict com todos os campos ou None se não encontrado.

    Usado em: login (main.py), obter_jogador_token() para validar JWT.
    """
    conn = get_conn()
    try:
        c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        c.execute("SELECT * FROM jogadores WHERE nick = %s", (nick,))
        row = c.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def buscar_jogador_id(jogador_id: int):
    """Busca um jogador pelo ID primário. Retorna dict ou None.

    Usado em status_sala() para resolver jogador1_id e jogador2_id em nicks.
    """
    conn = get_conn()
    try:
        c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        c.execute("SELECT * FROM jogadores WHERE id = %s", (jogador_id,))
        row = c.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def listar_placar(limit: int = 20):
    """Retorna os jogadores ordenados por pontos DESC, vitorias DESC.

    Retorna lista de dicts com campos: nick, vitorias, pontos.
    Chamada por GET /placar em main.py.
    """
    conn = get_conn()
    try:
        c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        c.execute(
            "SELECT nick, vitorias, pontos FROM jogadores "
            "ORDER BY pontos DESC, vitorias DESC LIMIT %s",
            (limit,)
        )
        return [dict(r) for r in c.fetchall()]
    finally:
        conn.close()


def atualizar_stats(jogador_id: int, pontos: int, vitoria: bool):
    """Incrementa os pontos do jogador e, se vitoria=True, também o contador de vitórias.

    Chamada duas vezes em registrar_resultado(): uma para o vencedor (vitoria=True)
    e uma para o perdedor (vitoria=False, só pontos de dano causado).
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        if vitoria:
            c.execute(
                "UPDATE jogadores SET pontos = pontos + %s, vitorias = vitorias + 1 WHERE id = %s",
                (pontos, jogador_id)
            )
        else:
            c.execute(
                "UPDATE jogadores SET pontos = pontos + %s WHERE id = %s",
                (pontos, jogador_id)
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# =============================================================================
# Salas
# =============================================================================

def criar_sala(sala_id: str, modo: str):
    """Insere uma nova sala na tabela salas com status 'aguardando'.

    sala_id: 8 chars gerados em main.py (UUID truncado e capitalizado).
    modo: 'single' | 'multi'.
    jogador1_id e jogador2_id ficam NULL até os jogadores entrarem via entrar_sala().
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        c.execute(
            "INSERT INTO salas (id, modo) VALUES (%s, %s)",
            (sala_id, modo)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def buscar_sala(sala_id: str):
    """Retorna todos os campos de uma sala ou None se não encontrada.

    Usada em: status_sala, entrar_sala_endpoint, cancelar_sala_endpoint,
    registrar_resultado — qualquer rota que precise do estado atual da sala.
    """
    conn = get_conn()
    try:
        c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        c.execute("SELECT * FROM salas WHERE id = %s", (sala_id,))
        row = c.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def entrar_sala(sala_id: str, jogador_id: int, token: str):
    """Atribui o jogador ao primeiro slot disponível da sala e atualiza o status.

    Lógica de slot:
      - Se jogador já está no slot 1 ou 2: retorna o número do slot sem alterar (idempotente).
      - Se jogador1_id é NULL: ocupa slot 1.
        - modo 'single': status muda para 'pronto' imediatamente (sem P2).
      - Se jogador2_id é NULL e modo é 'multi': ocupa slot 2, status → 'pronto'.
      - Se sala está cheia: retorna None.

    Retorno:
        1 ou 2 (número do slot ocupado) | None (sala cheia ou não encontrada).
    """
    conn = get_conn()
    try:
        c = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        c.execute("SELECT * FROM salas WHERE id = %s", (sala_id,))
        sala = c.fetchone()

        if not sala:
            return None

        sala = dict(sala)

        # Evita duplicacao
        if sala["jogador1_id"] == jogador_id:
            return 1
        if sala["jogador2_id"] == jogador_id:
            return 2

        cu = conn.cursor()

        if sala["jogador1_id"] is None:
            cu.execute(
                "UPDATE salas SET jogador1_id = %s, token_j1 = %s WHERE id = %s",
                (jogador_id, token, sala_id)
            )
            slot = 1
            # Single player não precisa de P2: sala fica pronta assim que P1 entra
            if sala["modo"] == "single":
                cu.execute(
                    "UPDATE salas SET status = 'pronto' WHERE id = %s",
                    (sala_id,)
                )

        elif sala["jogador2_id"] is None and sala["modo"] == "multi":
            cu.execute(
                "UPDATE salas SET jogador2_id = %s, token_j2 = %s, status = 'pronto' WHERE id = %s",
                (jogador_id, token, sala_id)
            )
            slot = 2

        else:
            return None  # sala cheia ou modo single com P1 já presente

        conn.commit()
        return slot
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def atualizar_status_sala(sala_id: str, status: str):
    """Atualiza o campo status de uma sala.

    Valores possíveis: 'aguardando' | 'pronto' | 'em_jogo' | 'finalizado'.
    Chamada em registrar_resultado() para marcar a sala como 'finalizado'
    após o resultado ser persistido.
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        c.execute("UPDATE salas SET status = %s WHERE id = %s", (status, sala_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def cancelar_sala(sala_id: str):
    """Remove a sala da tabela salas (DELETE físico).

    Chamada por DELETE /sala/{id} quando o jogador volta ao menu antes da partida.
    A rota é fire-and-forget no frontend — a ausência da sala não é um erro.
    Nota: partidas vinculadas via FK sala_id ficam com sala_id apontando para
    uma sala deletada; a coluna partidas.sala_id não tem ON DELETE CASCADE,
    então só funciona se a sala ainda não teve partida registrada.
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        c.execute("DELETE FROM salas WHERE id = %s", (sala_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# =============================================================================
# Partidas
# =============================================================================

def registrar_partida(sala_id: str, modo: str, j1_id: int, j2_id,
                      vencedor_id: int, pts_j1: int, pts_j2: int):
    """Insere um registro histórico da partida na tabela partidas.

    j2_id pode ser None em partidas single (jogador vs CPU — CPU não tem conta).
    Chamada em registrar_resultado() após atualizar_stats() para ambos os jogadores.
    Os pontos registrados aqui são o dano total causado por cada jogador na partida.
    """
    conn = get_conn()
    try:
        c = conn.cursor()
        c.execute(
            """INSERT INTO partidas
               (sala_id, modo, jogador1_id, jogador2_id, vencedor_id, pontos_j1, pontos_j2)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (sala_id, modo, j1_id, j2_id, vencedor_id, pts_j1, pts_j2)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
