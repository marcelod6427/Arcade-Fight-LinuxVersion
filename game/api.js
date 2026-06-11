// =============================================================================
// api.js — Comunicação com o backend FastAPI
//
// Centraliza todas as chamadas HTTP do jogo ao servidor.
// Usado por:
//   game.js    → Api.registrarResultado (registra resultado da partida)
//   index.html → Api.criarSala, Api.statusSala, Api.cancelarSala,
//                Api.placarQR, Api.verificarConexao
//
// Backend correspondente: backend/main.py (FastAPI)
// Rotas do backend para o site mobile: backend/main.py também serve
//   /auth/cadastro, /auth/login, /sala/{id}/entrar, /placar
//   mas essas são usadas pelo site mobile (site/login.html, site/placar.html),
//   não pelo jogo Electron — portanto não estão aqui.
//
// URL base (resolvida em tempo de execução por verificarConexao()):
//   Online  → https://arcade-fight-ifsp.onrender.com (servidor Render acessível)
//   Offline → http://localhost:8000 (FastAPI rodando localmente)
//
// Todas as funções retornam um objeto com { ok: true, ...dados }
// ou { ok: false, erro: 'mensagem' } em caso de falha.
//
// Exporta para window:
//   window.Api — objeto singleton consumido por game.js e index.html
// =============================================================================

// URLs possíveis do backend.
const ONLINE_URL  = 'https://arcade-fight-ifsp.onrender.com';
const OFFLINE_URL = 'http://localhost:8000';

// Começa apontando para o servidor online; verificarConexao() corrige para
// OFFLINE_URL se o servidor não responder dentro do timeout de 3s.
let API_BASE = ONLINE_URL;

// =============================================================================
// Api — métodos públicos usados pelo jogo
// =============================================================================
const Api = {

  // ── Gerenciamento de Salas ─────────────────────────────────────────────────

  // Cria uma nova sala no backend e retorna o QR Code para os jogadores entrarem.
  // modo: 'single' | 'multi'
  // ► POST /sala/criar → backend/main.py: criar_sala()
  // Resposta: { ok, sala_id, qr_base64, url_mobile, token }
  async criarSala(modo) {
    return _post('/sala/criar', { modo });
  },

  // Consulta o estado atual de uma sala (jogadores conectados, status).
  // Chamado em polling a cada 1.5s por index.html enquanto aguarda jogadores.
  // ► GET /sala/{sala_id} → backend/main.py: status_sala()
  // Resposta: { ok, sala_id, modo, status, jogador1, jogador2 }
  //   status: 'aguardando' | 'pronto' | 'em_jogo'
  //   jogador1/2: { nick, token } (null se ainda não conectou)
  async statusSala(salaId) {
    return _get(`/sala/${salaId}`);
  },

  // Cancela e remove uma sala (chamado ao voltar ao menu antes de a partida iniciar).
  // ► DELETE /sala/{sala_id} → backend/main.py: cancelar_sala()
  async cancelarSala(salaId) {
    return _delete(`/sala/${salaId}`);
  },

  // ── Resultado da Partida ───────────────────────────────────────────────────

  // Registra o resultado da partida no backend ao final do GAME_OVER.
  // Chamado por game.js → _encerrarPartida() apenas em modo online (salaId != null).
  // ► POST /partida/resultado → backend/main.py: registrar_resultado()
  // tokenVencedor: JWT do P1 (único token disponível no Electron)
  // pontosJ1/J2: dano total causado por cada jogador durante a partida
  async registrarResultado(salaId, tokenVencedor, pontosJ1, pontosJ2 = 0) {
    return _post('/partida/resultado', {
      sala_id:   salaId,
      token:     tokenVencedor,
      pontos_j1: pontosJ1,
      pontos_j2: pontosJ2
    });
  },

  // ── Placar ─────────────────────────────────────────────────────────────────

  // Obtém o QR Code que aponta para a página de placar do site mobile.
  // Chamado por index.html → mostrarQrPlacar() após o GAME_OVER.
  // ► GET /placar/qr → backend/main.py: placar_qr()
  // Resposta: { ok, qr_base64 }
  async placarQR() {
    return _get('/placar/qr');
  },

  // ── Conectividade ──────────────────────────────────────────────────────────

  // Verifica se o servidor online está acessível antes de iniciar o jogo.
  // Timeout de 3s — se não responder, cai para localhost (modo offline).
  // Como efeito colateral, ajusta API_BASE para a URL correta antes de Game.init().
  // Chamado por index.html no DOMContentLoaded, antes de Game.init().
  // ► GET / → backend/main.py: root() — retorna { status: "ok" }
  async verificarConexao() {
    for (let i = 0; i < 5; i++) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(ONLINE_URL + '/', { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) { API_BASE = ONLINE_URL; return true; }
      } catch { /* timeout ou sem rede — tenta novamente */ }
    }
    API_BASE = OFFLINE_URL;
    return false;
  }
};

// =============================================================================
// Helpers internos — não expostos ao window
// =============================================================================

// Executa GET em API_BASE + rota.
// Retorna { ok: true, ...dados } ou { ok: false, erro: '...' }.
async function _get(rota) {
  try {
    const res  = await fetch(API_BASE + rota);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return { ok: true, ...data };
  } catch (e) {
    console.error('[API GET]', rota, e.message);
    return { ok: false, erro: e.message };
  }
}

// Executa POST em API_BASE + rota com body serializado como JSON.
// Retorna { ok: true, ...dados } ou { ok: false, erro: '...' }.
async function _post(rota, body) {
  try {
    const res = await fetch(API_BASE + rota, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return { ok: true, ...data };
  } catch (e) {
    console.error('[API POST]', rota, e.message);
    return { ok: false, erro: e.message };
  }
}

// Executa DELETE em API_BASE + rota.
// Retorna { ok: true, ...dados } ou { ok: false, erro: '...' }.
async function _delete(rota) {
  try {
    const res  = await fetch(API_BASE + rota, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return { ok: true, ...data };
  } catch (e) {
    console.error('[API DELETE]', rota, e.message);
    return { ok: false, erro: e.message };
  }
}

// Exporta o singleton para uso por game.js e index.html
window.Api = Api;
