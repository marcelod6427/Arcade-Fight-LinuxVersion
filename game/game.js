// =============================================================================
// game.js — Lógica principal do Arcade Fight
// Canvas 1280×720 | Física 2D | Combate | IA | Integração com backend
//
// Dependências (carregadas antes deste arquivo via index.html):
//   sprites.js  → window.SpriteManager, window.PERSONAGENS_DEF, window.ANIM_MAP
//   controls.js → window.Controls
//   api.js      → window.Api
//
// Eventos CustomEvent disparados para o index.html:
//   'game:selectIniciado' → oculta menus, troca tela para SELECT
//   'game:lutaIniciou'    → exibe legendas de controle
//   'game:gameOver'       → inicia contagem para exibir QR do placar
//
// Evento CustomEvent escutado vindo do index.html:
//   'game:telaInicial'    → retorna ao menu principal após o QR do placar
// =============================================================================

// ── Constantes de tela e física ───────────────────────────────────────────────
const W         = 1280;   // largura do canvas
const H         = 720;    // altura do canvas
const CHAO      = H - 130; // posição Y do chão (base dos personagens)
const GRAVIDADE = 0.55;   // aceleração gravitacional por frame
const PULO_FORCA = -14;   // impulso vertical do pulo

// ── Caminho base dos sprites ──────────────────────────────────────────────────
// Usa __dirname (Electron/Node) para montar caminho absoluto.
// Fallback para './sprites' em ambiente web sem Node.
const SPRITES_PATH = (() => {
  try {
    const path = require('path');
    return path.join(__dirname, '..', 'sprites');
  } catch (e) {
    return './sprites';
  }
})();

// Caminho da pasta de efeitos sonoros (mesmo nível que sprites/).
const SFX_PATH = (() => {
  try {
    const path = require('path');
    return path.join(__dirname, '..', 'sound');
  } catch (e) {
    return '../sound';
  }
})();

// ── Estado global do jogo ─────────────────────────────────────────────────────
let canvas, ctx;
let spriteManager; // instância de SpriteManager (sprites.js)

// Máquina de estados principal:
// LOADING → TELA_INICIAL → SELECT → COUNTDOWN → FIGHTING → ROUND_END → GAME_OVER
let gameState   = 'LOADING';
let gamePausado = false; // true enquanto modal de confirmação de saída está aberta

// Dados da sala online (null em modo offline)
let salaId      = null;  // ID da sala no backend
let salaToken   = null;  // JWT do P1 usado para registrar resultado
let salaTokenP2 = null;  // JWT do P2 (null em modo offline e single)
let salaModo    = null;  // 'single' | 'multi'

// Nomes dos jogadores (preenchidos por jogadoresEntraramprontos)
let nickP1 = 'P1';
let nickP2 = 'P2';

// Controle de rounds (melhor de maxRounds)
let roundAtual = 1;
let maxRounds  = 3;
let vitorias   = [0, 0]; // [vitórias P1, vitórias P2]

let dificuldadeIA = 'medio'; // 'facil' | 'medio' | 'dificil'

let fighters  = []; // [Fighter P1, Fighter P2]
let projeteis = []; // projéteis ativos (especial do Mago)
let bgImage   = null; // imagem de fundo das partidas (carregada em init)

// Timers de transição entre estados
let countdownVal   = 5;
let countdownTimer = 0;
let roundEndTimer  = 0;

// Seleção de personagens (tela SELECT)
let selecao = {
  cursor:   [0, 1],         // índice do personagem sob o cursor de cada player
  escolhido: [null, null]   // índice do personagem confirmado (null = ainda escolhendo)
};

// =============================================================================
// Sistema de efeitos sonoros dos personagens (SFX)
// Independente da trilha sonora principal — sons tocam em canais separados.
// =============================================================================

// Tenta carregar um áudio testando .mp3 e .wav em paralelo.
// Resolve com o primeiro que carregar; null se ambos falharem ou timeout (5s).
function _tryLoadSound(basePath, name) {
  return new Promise(resolve => {
    const exts = ['.mp3', '.wav'];
    let resolved = false;
    let failed   = 0;

    const done = (audio) => { if (!resolved) { resolved = true; resolve(audio); } };
    setTimeout(() => done(null), 5000); // segurança global

    for (const ext of exts) {
      let fullPath = basePath + '/' + name + ext;
      try { fullPath = require('path').join(basePath, name + ext); } catch {}
      const audio = new Audio(fullPath);
      audio.addEventListener('canplay', () => done(audio), { once: true });
      audio.addEventListener('error',   () => { if (++failed === exts.length) done(null); }, { once: true });
      audio.load();
    }
  });
}

const SFXManager = {
  _sons:   {},   // { personagemIdx: { attack1, attack2, especial, hurt, death } }
  _nomes:  ['Espadachim', 'Lutador', 'Mago', 'Vampira', 'Vampiro'],
  _volume: 0.7,

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('arcade_sfx_volume', this._volume);
  },

  getVolume() { return this._volume; },

  // Carrega todos os sons dos 5 personagens em paralelo.
  // Estrutura: sound/NomePersonagem/tipoNomePersonagem.(mp3|wav)
  // Testa .mp3 primeiro, depois .wav para cada arquivo.
  async init(basePath) {
    const saved = parseFloat(localStorage.getItem('arcade_sfx_volume'));
    this._volume = isNaN(saved) ? 0.7 : Math.max(0, Math.min(1, saved));

    const tipos = ['attack1', 'attack2', 'especial', 'hurt', 'death'];
    const proms = [];
    for (let i = 0; i < this._nomes.length; i++) {
      this._sons[i] = {};
      const nomePersonagem = this._nomes[i];
      // Subpasta do personagem: sound/Espadachim/, sound/Lutador/, etc.
      let subPath = basePath + '/' + nomePersonagem;
      try { subPath = require('path').join(basePath, nomePersonagem); } catch {}

      for (const tipo of tipos) {
        const nomeArquivo = tipo + nomePersonagem; // ex: attack1Espadachim
        proms.push(
          _tryLoadSound(subPath, nomeArquivo).then(audio => {
            this._sons[i][tipo] = audio;
            if (audio) console.log(`[SFX] ${nomePersonagem}/${nomeArquivo} carregado`);
            else        console.warn(`[SFX] ${nomePersonagem}/${nomeArquivo} não encontrado (.mp3/.wav)`);
          })
        );
      }
    }
    await Promise.allSettled(proms);
    console.log('[SFX] Inicialização concluída.');
  },

  // Toca um efeito sonoro do personagem.
  // Só executa durante FIGHTING. Usa cloneNode para permitir sobreposição.
  play(personagemIdx, tipo) {
    if (gameState !== 'FIGHTING') return;
    const som = this._sons[personagemIdx]?.[tipo];
    if (!som) return;
    const clone = som.cloneNode(false);
    clone.volume = this._volume;
    clone.play().catch(() => {});
  }
};

// =============================================================================
// Classe Fighter — representa um lutador (player humano ou controlado pela IA)
// =============================================================================
class Fighter {
  // playerIndex: 0 = P1 (esquerda), 1 = P2 (direita)
  // personagemId: índice em PERSONAGENS_DEF (sprites.js)
  // x: posição X inicial
  constructor(playerIndex, personagemId, x) {
    // Lê a ficha do personagem de PERSONAGENS_DEF (definido em sprites.js)
    const def = PERSONAGENS_DEF[personagemId];

    this.player     = playerIndex;
    this.personagem = personagemId; // usado pelo SpriteManager para buscar frames
    this.def        = def;          // referência à ficha: hp, dano, alcance, velocidade
    this.nome       = 'Jogador';    // sobrescrito por jogadoresEntraramprontos()

    // Posição e física
    this.x  = x;
    this.y  = CHAO;
    this.vx = 0;
    this.vy = 0;
    this.w  = 80;   // largura da hitbox
    this.h  = 120;  // altura da hitbox

    // Status de combate
    this.hp    = def.hp;
    this.maxHp = def.hp;
    this.speed = def.velocidade;

    this.noChao    = true;
    this.virado    = playerIndex === 1; // P2 começa virado para a esquerda
    this.bloqueando = false;

    // Animação: nome da animação atual + frame atual (lido pelo SpriteManager)
    this.state     = 'IDLE';
    this.animState = { nome: 'IDLE', frame: 0, timer: 0 };

    // Controle de ataque
    this.atacando        = false;
    this.ataqueTick      = 0;    // ms restantes do ataque atual
    this.hitboxAtiva     = false; // true = pode colidir com inimigo neste frame
    this._danoAtual      = 0;    // dano do ataque em curso

    // Mecânicas especiais
    this.invencivel      = false;
    this.invincivelTimer = 0;    // ms restantes de invencibilidade (Vampira)
    this.especialCharge  = 0;   // 0–100; chega em 100 ao causar ~25% do próprio HP em dano
    this.counterWindow   = 0;   // ms restantes para janela de counter (b4)
    this.stunTimer       = 0;   // ms de stun pós-recebimento de dano

    this.pontos = 0;    // acumulado de dano causado (enviado ao backend no fim)
    this.morreu = false;
  }

  // Retorna o retângulo de colisão do corpo (x,y = canto superior-esquerdo)
  get hitbox() {
    return { x: this.x, y: this.y - this.h, w: this.w, h: this.h };
  }

  // Retorna o retângulo de alcance do ataque atual.
  // Usa def.alcance.especial durante SPECIAL, def.alcance.normal nos demais.
  // Estende na direção em que o personagem está virado.
  get hitboxAtaque() {
    const isEspecial = this.state === 'SPECIAL';
    const w = isEspecial
      ? (this.def.alcance ? this.def.alcance.especial : 70)
      : (this.def.alcance ? this.def.alcance.normal   : 70);
    return {
      x: this.virado ? this.x - w : this.x + this.w,
      y: this.y - this.h * 0.8,
      w,
      h: this.h * 0.6
    };
  }

  // Executado a cada frame pelo updateFighting().
  // input: Controls.getInput(player) — estado atual das teclas/gamepad
  // inimigo: o Fighter adversário (para especiais direcionados)
  // deltaMs: milissegundos desde o último frame
  update(input, inimigo, deltaMs) {
    if (this.morreu) return;

    // Stun: paralisa o personagem mas mantém física e animação
    if (this.stunTimer > 0) {
      this.stunTimer -= deltaMs;
      spriteManager.tickAnim(this.animState, deltaMs, this.personagem);
      this.vy += GRAVIDADE;
      this.y  += this.vy;
      if (this.y >= CHAO) { this.y = CHAO; this.vy = 0; this.noChao = true; }
      return;
    }

    // Decrementa timers de mecânicas especiais
    if (this.invincivelTimer > 0) {
      this.invincivelTimer -= deltaMs;
      if (this.invincivelTimer <= 0) this.invencivel = false;
    }
    if (this.counterWindow > 0) this.counterWindow -= deltaMs;

    // Durante ataque: bloqueia novo input, apenas avança física e animação
    if (this.atacando) {
      this.ataqueTick -= deltaMs;
      if (this.ataqueTick <= 0) {
        this.atacando    = false;
        this.hitboxAtiva = false;
        this.state       = 'IDLE';
      }
      this.vy += GRAVIDADE;
      this.y  += this.vy;
      if (this.y >= CHAO) { this.y = CHAO; this.vy = 0; this.noChao = true; }
      spriteManager.tickAnim(this.animState, deltaMs, this.personagem);
      return;
    }

    // ── Movimento horizontal ──
    let movendo = false;
    this.bloqueando = false;

    if (input.left) {
      this.vx    = -this.speed;
      this.virado = true;
      movendo     = true;
    } else if (input.right) {
      this.vx    = this.speed;
      this.virado = false;
      movendo     = true;
    } else {
      // Desaceleração com atrito
      this.vx *= 0.7;
      if (Math.abs(this.vx) < 0.3) this.vx = 0;
    }

    // ── Defender (b2 — L1 no gamepad) ──
    if (input.btn[2] && this.noChao) {
      this.bloqueando = true;
      this.vx         = 0;
      this.state      = 'DEFEND';
      spriteManager.setAnim(this.animState, 'DEFEND');
    }

    // ── Pulo (up — W/Espaço teclado, Cruz gamepad, D-pad cima) ──
    if (input.up && this.noChao) {
      this.vy     = PULO_FORCA;
      this.noChao = false;
    }

    // ── Ataques (bloqueados enquanto defendendo) ──
    if (!this.bloqueando) {
      if (Controls.justPressed(this.player, 'b0')) {
        // b0 = Bolinha gamepad / J teclado — ataque rápido
        this._iniciarAtaque('ATTACK', this.def.dano.leve, 800);
      }
      else if (Controls.justPressed(this.player, 'b1')) {
        // b1 = Quadrado gamepad / K teclado — ataque forte
        this._iniciarAtaque('ATTACK2', this.def.dano.forte, 650);
      }
      else if (Controls.justPressed(this.player, 'b3') && this.especialCharge >= 100) {
        // b3 = Triângulo gamepad / I teclado — especial (requer carga completa)
        this._ativarEspecial(inimigo);
      }
      else if (Controls.justPressed(this.player, 'b4')) {
        // b4 = R1 gamepad / U teclado — abre janela de counter por 300ms
        this.counterWindow = 300;
      }
    }

    // ── Física ──
    this.vy += GRAVIDADE;
    this.x  += this.vx;
    this.y  += this.vy;

    // Aterrissagem
    if (this.y >= CHAO) {
      this.y      = CHAO;
      this.vy     = 0;
      this.noChao = true;
    }

    // Limita às bordas do canvas
    this.x = Math.max(0, Math.min(W - this.w, this.x));

    // ── Seleção de animação ──
    // Só troca se não estiver atacando ou defendendo (esses já definem animState)
    if (!this.atacando && !this.bloqueando) {
      if (!this.noChao) {
        spriteManager.setAnim(this.animState, 'JUMP');
      } else if (movendo) {
        spriteManager.setAnim(this.animState, 'WALK');
      } else {
        spriteManager.setAnim(this.animState, 'IDLE');
      }
    }

    // Avança o frame da animação atual (spriteManager controla fps por animação)
    const done = spriteManager.tickAnim(this.animState, deltaMs, this.personagem);
    // Ao terminar animação de HIT, volta para IDLE
    if (done && this.state === 'HIT') {
      this.state = 'IDLE';
      spriteManager.setAnim(this.animState, 'IDLE');
    }
  }

  // Inicia um ataque: define tipo, dano, duração e dispara a animação no SpriteManager.
  // tipo: 'ATTACK' | 'ATTACK2' | 'SPECIAL'  (nomes de chave em ANIM_MAP de sprites.js)
  _iniciarAtaque(tipo, dano, durMs) {
    this.atacando    = true;
    this.ataqueTick  = durMs;
    this.hitboxAtiva = true;
    this.state       = tipo;
    this._danoAtual  = dano;
    spriteManager.setAnim(this.animState, tipo);
    // Efeito sonoro: attack1 para ATTACK, attack2 para ATTACK2.
    // SPECIAL é tratado em _ativarEspecial (evita dupla execução).
    if (tipo === 'ATTACK')  SFXManager.play(this.personagem, 'attack1');
    if (tipo === 'ATTACK2') SFXManager.play(this.personagem, 'attack2');
  }

  // Ativa o especial do personagem. Cada personagem tem comportamento único.
  // Zera especialCharge antes de executar.
  _ativarEspecial(inimigo) {
    this.especialCharge = 0;
    SFXManager.play(this.personagem, 'especial'); // toca antes do switch para todos os personagens

    switch (this.personagem) {
      case 0: // Espadachim — Lâmina Veloz: investida com corte em área
        this._iniciarAtaque('SPECIAL', this.def.dano.especial, 700);
        break;

      case 1: // Lutador — Impacto Sísmico: salta e causa dano em área ao pousar
        if (this.noChao) {
          this.vy = PULO_FORCA * 0.6;
          this.noChao = false;
          // _especial_pendente é verificado em updateFighting quando noChao volta a true
          this._especial_pendente = 'sismico';
          this.atacando    = true;
          this.ataqueTick  = 900;
          this.hitboxAtiva = false; // dano aplicado no pouso, não durante o voo
          this.state       = 'SPECIAL';
          spriteManager.setAnim(this.animState, 'SPECIAL');
        }
        break;

      case 2: // Mago — Tempestade Arcana: dispara 3 projéteis com velocidades diferentes
        for (let i = 0; i < 3; i++) {
          projeteis.push({
            x:    this.x + this.w / 2,
            y:    this.y - this.h * 0.7,
            vx:   this.virado ? -(5 + i * 2) : (5 + i * 2),
            vy:   -1 + i * 0.5,
            dano: 8,
            dono: this.player, // índice do player dono (para não se autoacertar)
            vida: 120          // frames de vida antes de desaparecer
          });
        }
        this.atacando    = true;
        this.ataqueTick  = 650;
        this.hitboxAtiva = false; // dano está nos projéteis, não na hitbox do corpo
        this.state       = 'SPECIAL';
        spriteManager.setAnim(this.animState, 'SPECIAL');
        break;

      case 3: // Vampira — Véu de Sangue: 2s de invencibilidade total
        this.invencivel      = true;
        this.invincivelTimer = 2000;
        this.atacando        = true;
        this.ataqueTick      = 550;
        this.hitboxAtiva     = false;
        this.state           = 'SPECIAL';
        spriteManager.setAnim(this.animState, 'SPECIAL');
        break;

      case 4: // Vampiro — Sombra Veloz: teleporta para trás do inimigo e ataca
        if (inimigo) {
          const offset = inimigo.virado ? 100 : -100;
          this.x = Math.max(0, Math.min(W - this.w, inimigo.x + offset));
          this._iniciarAtaque('SPECIAL', this.def.dano.especial, 700);
        }
        break;
    }
  }

  // Aplica dano recebido. Retorna o dano real causado (0 se counter ou invencível).
  // atacante: Fighter que causou o dano (pode ser null para dano ambiental)
  receberDano(dano, atacante) {
    if (this.morreu || this.invencivel) return 0;

    // Janela de counter ativa: reverte o golpe para o atacante com 1.5× de dano
    if (this.counterWindow > 0) {
      atacante && atacante._iniciarAtaque('ATTACK2', atacante.def.dano.forte * 1.5, 300);
      this.counterWindow = 0;
      return 0;
    }

    // Bloqueio reduz o dano para 30%
    const dmgReal = this.bloqueando ? Math.ceil(dano * 0.3) : dano;

    this.hp = Math.max(0, this.hp - dmgReal);
    this.stunTimer = this.bloqueando ? 80 : 200;
    spriteManager.setAnim(this.animState, 'HIT');

    if (this.hp <= 0) {
      this.morreu = true;
      spriteManager.setAnim(this.animState, 'DEATH');
      SFXManager.play(this.personagem, 'death');
    } else if (!this.bloqueando) {
      // Hurt só toca sem bloqueio (bloquear absorve sem som de dano)
      SFXManager.play(this.personagem, 'hurt');
    }

    if (atacante) {
      atacante.pontos += dmgReal;
      // Carga especial: causar 25% do próprio HP máximo em dano enche a barra
      atacante.especialCharge = Math.min(100,
        atacante.especialCharge + dmgReal * 400 / atacante.maxHp);
    }

    return dmgReal;
  }

  // Renderiza o personagem no canvas.
  // Delega ao SpriteManager.draw() que busca o frame correto em animState.
  // Efeito de piscar (globalAlpha) aplicado enquanto invencível.
  draw() {
    if (!spriteManager) return;
    const hb = this.hitbox;

    // spriteManager.draw lê sprites/{personagem}/{animacao}/{frame}.png
    spriteManager.draw(ctx, this.personagem, this.animState,
      hb.x, hb.y, this.w, this.h, this.virado);

    // Brilho branco piscando durante invencibilidade (Vampira)
    if (this.invencivel && Math.floor(Date.now() / 100) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#fff';
      ctx.fillRect(hb.x, hb.y, this.w, this.h);
      ctx.restore();
    }

    // Nome do jogador acima do personagem
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.nome, hb.x + this.w / 2, hb.y - 10);
  }
}

// =============================================================================
// Classe IA — controla o Fighter do CPU em modo single player
// =============================================================================
class IA {
  // fighter: o Fighter que a IA controla (sempre P2)
  // dificuldade: 'facil' | 'medio' | 'dificil'
  constructor(fighter, dificuldade) {
    this.f     = fighter;
    this.nivel = dificuldade;
    this.timer = 0;   // tempo até reavaliação da próxima ação
    this.acao  = null; // 'atacar' | 'aproximar'
  }

  // Executado a cada frame por updateFighting().
  // Simula input humano escrevendo diretamente em Controls.state[player],
  // espelhando o estado anterior em Controls.prev para que justPressed() funcione.
  update(inimigo, deltaMs) {
    const f = this.f;
    if (f.morreu) return;

    this.timer -= deltaMs;

    // Parâmetros que variam por dificuldade
    const dist         = Math.abs(f.x - inimigo.x);
    const alcance      = { facil: 200, medio: 140,  dificil: 90  }[this.nivel];
    const react        = { facil: 600, medio: 350,  dificil: 150 }[this.nivel];
    const agressividade = { facil: 0.3, medio: 0.55, dificil: 0.8 }[this.nivel];

    const inp = { left: false, right: false, up: false, down: false,
                  btn: [false, false, false, false, false] };

    // Reavalia ação quando o timer expira (intervalo aleatorizado por dificuldade)
    if (this.timer <= 0) {
      this.timer = react + Math.random() * react;
      this.acao  = Math.random() < agressividade ? 'atacar' : 'aproximar';
    }

    // Movimento: aproxima se fora do alcance, recua se muito perto
    if (dist > alcance) {
      inp[f.x < inimigo.x ? 'right' : 'left'] = true;
    } else if (dist < 60 && Math.random() < 0.3) {
      inp[f.x < inimigo.x ? 'left' : 'right'] = true;
    }

    // Ataques aleatorizados quando dentro do alcance e em modo 'atacar'
    if (dist <= alcance && this.acao === 'atacar') {
      const r = Math.random();
      if      (r < 0.50) inp.btn[0] = true; // ataque rápido
      else if (r < 0.75) inp.btn[1] = true; // ataque forte
      else if (r < 0.85) inp.btn[3] = true; // especial
      else               inp.btn[2] = true; // defender
    }

    // Pulo ocasional (mais frequente em dificuldades maiores)
    if (Math.random() < 0.002 * ({ facil: 1, medio: 2, dificil: 3 }[this.nivel])) {
      inp.up = true;
    }

    // Escreve no Controls para que Fighter.update() leia normalmente
    Controls.prev[f.player]  = { ...Controls.state[f.player], btn: [...Controls.state[f.player].btn] };
    Controls.state[f.player] = { left: inp.left, right: inp.right, up: inp.up, down: inp.down, btn: [...inp.btn] };
  }
}

// =============================================================================
// Inicialização
// =============================================================================

// Configura canvas, carrega sprites e inicia o game loop.
// Chamado por Game.init() (exposto ao index.html).
async function init() {
  canvas        = document.getElementById('gameCanvas');
  ctx           = canvas.getContext('2d');
  canvas.width  = W;
  canvas.height = H;

  // Inicializa o sistema de controles (teclado + gamepad)
  Controls.init(); // controls.js

  // Carrega imagem de fundo para as partidas (não bloqueia se não encontrar)
  bgImage = new Image();
  bgImage.src = (() => {
    try { return require('path').join(SPRITES_PATH, 'imgFundoArcadeFight.png'); }
    catch { return SPRITES_PATH + '/imgFundoArcadeFight.png'; }
  })();

  // Carrega sprites e efeitos sonoros em paralelo para reduzir tempo de boot.
  spriteManager = new SpriteManager(SPRITES_PATH);
  await Promise.all([
    spriteManager.carregar(),
    SFXManager.init(SFX_PATH)
  ]);

  gameState = 'TELA_INICIAL';
  requestAnimationFrame(loop);
}

// =============================================================================
// Game Loop
// =============================================================================

let lastTime = 0;

// Loop principal: atualiza controles, lógica e renderização a cada frame.
// delta é limitado a 50ms para evitar saltos grandes em abas inativas.
function loop(ts) {
  const delta = Math.min(ts - lastTime, 50);
  lastTime = ts;

  Controls.update();
  if (!gamePausado) update(delta); // congela a lógica enquanto modal de saída está aberta
  render();

  requestAnimationFrame(loop);
}

// =============================================================================
// Update — despacha para a função correta conforme o estado atual
// =============================================================================
function update(delta) {
  switch (gameState) {
    case 'TELA_INICIAL': /* gerenciado pelo index.html */    break;
    case 'SELECT':       updateSelect();                     break;
    case 'COUNTDOWN':    updateCountdown(delta);             break;
    case 'FIGHTING':     updateFighting(delta);              break;
    case 'ROUND_END':    updateRoundEnd(delta);              break;
    case 'GAME_OVER':    /* aguarda interação no index.html */ break;
  }
}

// =============================================================================
// SELECT — tela de escolha de personagens
// =============================================================================

// Lê input dos jogadores para mover cursores e confirmar escolhas.
// CPU (single player) escolhe automaticamente um personagem diferente do P1.
function updateSelect() {
  const totalPersonagens = PERSONAGENS_DEF.length; // vem de sprites.js
  const numPlayers = (salaModo === 'single') ? 1 : 2;

  for (let p = 0; p < numPlayers; p++) {
    if (selecao.escolhido[p] !== null) continue;

    if (Controls.justPressed(p, 'left'))
      selecao.cursor[p] = Math.max(0, selecao.cursor[p] - 1);
    if (Controls.justPressed(p, 'right'))
      selecao.cursor[p] = Math.min(totalPersonagens - 1, selecao.cursor[p] + 1);

    // Confirmar com 'up' (W/Espaço teclado, Cruz gamepad, D-pad cima)
    if (Controls.justPressed(p, 'up')) {
      const escolha      = selecao.cursor[p];
      const outroPlayer  = p === 0 ? 1 : 0;
      // Impede dois jogadores escolherem o mesmo personagem
      if (numPlayers === 2 && selecao.escolhido[outroPlayer] === escolha) continue;
      selecao.escolhido[p] = escolha;
    }
  }

  // CPU escolhe aleatoriamente assim que P1 confirmar
  if (numPlayers === 1 && selecao.escolhido[0] !== null && selecao.escolhido[1] === null) {
    let escolhaCpu;
    do {
      escolhaCpu = Math.floor(Math.random() * totalPersonagens);
    } while (escolhaCpu === selecao.escolhido[0]);
    selecao.escolhido[1] = escolhaCpu;
    selecao.cursor[1]    = escolhaCpu;
  }

  if (selecao.escolhido[0] !== null && selecao.escolhido[1] !== null) {
    iniciarPartidaComEscolhas();
  }
}

// Instancia os dois Fighters com os personagens escolhidos e inicia o countdown.
function iniciarPartidaComEscolhas() {
  projeteis = [];

  const f1 = new Fighter(0, selecao.escolhido[0], 200);
  const f2 = new Fighter(1, selecao.escolhido[1], W - 280);
  f1.nome = nickP1;
  f2.nome = nickP2;

  fighters = [f1, f2];
  // IA controla P2 apenas em single player
  ia = (salaModo === 'single') ? new IA(f2, dificuldadeIA) : null;

  roundAtual     = 1;
  vitorias       = [0, 0];
  countdownVal   = 5;
  countdownTimer = 1000;
  gameState      = 'COUNTDOWN';
}

// =============================================================================
// COUNTDOWN — contagem regressiva antes da luta
// =============================================================================

// Decrementa o contador a cada segundo. Ao chegar em zero, inicia FIGHTING
// e dispara 'game:lutaIniciou' para o index.html exibir as legendas de controle.
function updateCountdown(delta) {
  countdownTimer -= delta;
  if (countdownTimer <= 0) {
    countdownVal--;
    countdownTimer = 1000;
    if (countdownVal <= 0) {
      gameState = 'FIGHTING';
      document.dispatchEvent(new CustomEvent('game:lutaIniciou'));
    }
  }
}

// =============================================================================
// FIGHTING — lógica principal de combate
// =============================================================================

let ia = null; // instância de IA ativa (null em multi)

function updateFighting(delta) {
  if (fighters.length < 2) return;

  const [f1, f2] = fighters;

  // IA escreve em Controls.state[1] antes de f2.update() ler
  if (ia) ia.update(f1, delta);

  // Atualiza física, input e animações de cada lutador
  f1.update(Controls.getInput(0), f2, delta);
  f2.update(Controls.getInput(1), f1, delta);

  // Verifica colisão de hitboxes de ataque
  _checarHit(f1, f2);
  _checarHit(f2, f1);

  // Move projéteis e verifica colisão com alvos
  _atualizarProjeteis(f1, f2);

  // Impacto sísmico do Lutador: dano em área ao pousar
  [f1, f2].forEach(f => {
    if (f._especial_pendente === 'sismico' && f.noChao) {
      const alvo = f === f1 ? f2 : f1;
      if (Math.abs(f.x - alvo.x) < 160) alvo.receberDano(f.def.dano.especial, f);
      f._especial_pendente = null;
    }
  });

  // Fim do round quando um dos lutadores morre
  if (f1.morreu || f2.morreu) {
    const venceuIdx = f1.morreu ? 1 : 0;
    vitorias[venceuIdx]++;
    gameState     = 'ROUND_END';
    roundEndTimer = 2500; // 2.5s para exibir o resultado antes de continuar
  }
}

// Verifica se a hitbox de ataque do atacante intercepta o corpo do alvo.
// Desativa hitboxAtiva após o primeiro acerto para evitar multi-hit.
function _checarHit(atacante, alvo) {
  if (!atacante.hitboxAtiva || atacante.morreu) return;

  const ha = atacante.hitboxAtaque;
  const hd = alvo.hitbox;

  if (ha.x < hd.x + hd.w && ha.x + ha.w > hd.x &&
      ha.y < hd.y + hd.h && ha.y + ha.h > hd.y) {
    alvo.receberDano(atacante._danoAtual || atacante.def.dano.leve, atacante);
    atacante.hitboxAtiva = false;
  }
}

// Move todos os projéteis, remove os que saíram da tela ou acertaram o alvo.
function _atualizarProjeteis(f1, f2) {
  projeteis = projeteis.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vida--;

    const alvo = p.dono === 0 ? f2 : f1;
    const hd   = alvo.hitbox;

    if (p.x > hd.x && p.x < hd.x + hd.w && p.y > hd.y && p.y < hd.y + hd.h) {
      alvo.receberDano(p.dano, fighters[p.dono]);
      return false; // remove o projétil ao acertar
    }

    return p.vida > 0 && p.x > 0 && p.x < W;
  });
}

// =============================================================================
// ROUND_END — intervalo entre rounds
// =============================================================================

// Aguarda roundEndTimer ms. Se alguém tiver 2 vitórias ou rodou maxRounds,
// encerra a partida (GAME_OVER + API). Caso contrário, inicia o próximo round.
function updateRoundEnd(delta) {
  roundEndTimer -= delta;
  if (roundEndTimer <= 0) {
    if (vitorias[0] >= 2 || vitorias[1] >= 2 || roundAtual >= maxRounds) {
      _encerrarPartida();
    } else {
      roundAtual++;
      _reiniciarRound();
    }
  }
}

// =============================================================================
// Render — despacha para as funções de desenho conforme o estado
// =============================================================================
function render() {
  ctx.clearRect(0, 0, W, H);
  _drawBg();

  switch (gameState) {
    case 'LOADING':      _drawLoading();                          break;
    case 'TELA_INICIAL': _drawTelaInicial();                      break;
    case 'SELECT':       _drawSelect();                           break;
    case 'COUNTDOWN':
    case 'FIGHTING':     _drawGame();                             break;
    case 'ROUND_END':    _drawGame(); _drawRoundEnd();            break;
    case 'GAME_OVER':    _drawGame(); _drawGameOver();            break;
  }
}

// Fundo: imagem de arena durante combate; gradiente escuro nos menus.
// Sempre sobrepõe piso semi-transparente + linha vermelha no combate.
function _drawBg() {
  const combate = gameState === 'COUNTDOWN' || gameState === 'FIGHTING' ||
                  gameState === 'ROUND_END'  || gameState === 'GAME_OVER';

  if (combate && bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
    ctx.drawImage(bgImage, 0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0f0f1a');
    grad.addColorStop(1, '#1a0a0a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  if (combate) {
    ctx.fillStyle = 'rgba(42,26,26,0.65)';
    ctx.fillRect(0, CHAO, W, H - CHAO);
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, CHAO);
    ctx.lineTo(W, CHAO);
    ctx.stroke();
  }
}

// Tela exibida enquanto os sprites ainda estão sendo carregados do disco.
function _drawLoading() {
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Carregando sprites...', W / 2, H / 2);
}

// Título animado na tela inicial (os botões de modo são HTML no index.html).
function _drawTelaInicial() {
  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 90px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ARCADE', W / 2, H / 2 - 60);
  ctx.fillText('FIGHT',  W / 2, H / 2 + 20);

  ctx.fillStyle = '#aaa';
  ctx.font = '18px monospace';
  ctx.fillText('Selecione um modo de jogo abaixo', W / 2, H / 2 + 90);
}

// Desenha HUD, personagens (via SpriteManager), projéteis e countdown (se ativo).
function _drawGame() {
  if (fighters.length < 2) return;

  _drawHUD();
  fighters.forEach(f => f.draw()); // cada Fighter chama spriteManager.draw()

  // Projéteis do Mago desenhados como círculos amarelos
  ctx.fillStyle = '#ffeb3b';
  projeteis.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  if (gameState === 'COUNTDOWN') _drawCountdown();

  // Dica de saída: visível durante combate, abaixo do piso, semi-transparente
  if (gameState !== 'GAME_OVER') {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle   = '#fff';
    ctx.font        = 'bold 11px monospace';
    ctx.textAlign   = 'center';
    ctx.fillText(
      'Para sair da partida, clique no botão de SinglePlayer ou MultiPlayer',
      W / 2, CHAO + 16
    );
    ctx.restore();
  }
}

// HUD: barras de HP, contadores de round e barras de carga especial de ambos os jogadores.
function _drawHUD() {
  const [f1, f2] = fighters;
  const barW = 480, barH = 28, barY = 20;

  // ── Barra HP P1 (esquerda → direita) ──
  const pct1 = f1.hp / f1.maxHp;
  ctx.fillStyle = '#333';
  ctx.fillRect(20, barY, barW, barH);
  ctx.fillStyle = pct1 > 0.5 ? '#4caf50' : pct1 > 0.25 ? '#ff9800' : '#e94560';
  ctx.fillRect(20, barY, barW * pct1, barH);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.strokeRect(20, barY, barW, barH);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`${f1.nome}  ${f1.hp}/${f1.maxHp}`, 24, barY + 20);

  // ── Barra HP P2 (direita → esquerda) ──
  const pct2 = f2.hp / f2.maxHp;
  ctx.fillStyle = '#333';
  ctx.fillRect(W - 20 - barW, barY, barW, barH);
  ctx.fillStyle = pct2 > 0.5 ? '#4caf50' : pct2 > 0.25 ? '#ff9800' : '#e94560';
  ctx.fillRect(W - 20 - barW + barW * (1 - pct2), barY, barW * pct2, barH);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.strokeRect(W - 20 - barW, barY, barW, barH);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
  ctx.fillText(`${f2.hp}/${f2.maxHp}  ${f2.nome}`, W - 24, barY + 20);

  // ── Indicador de round e vitórias ──
  ctx.textAlign = 'center'; ctx.font = 'bold 18px monospace'; ctx.fillStyle = '#e94560';
  ctx.fillText(`ROUND ${roundAtual}`, W / 2, 30);
  for (let i = 0; i < 2; i++) {
    const cx1 = W / 2 - 60 + i * 20;
    const cx2 = W / 2 + 60 - i * 20;
    ctx.beginPath(); ctx.arc(cx1, 46, 7, 0, Math.PI * 2);
    ctx.fillStyle = vitorias[0] > i ? '#e94560' : '#333'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx2, 46, 7, 0, Math.PI * 2);
    ctx.fillStyle = vitorias[1] > i ? '#1565c0' : '#333'; ctx.fill();
  }

  // ── Barra de carga especial P1 ──
  if (fighters[0]) {
    const pct   = Math.min((fighters[0].especialCharge || 0) / 100, 1);
    const pronto = pct >= 1;
    ctx.fillStyle = '#333';
    ctx.fillRect(20, barY + barH + 8, 120, 8);
    ctx.fillStyle = pronto ? '#ffd700' : '#ce93d8';
    ctx.fillRect(20, barY + barH + 8, 120 * pct, 8);
    ctx.fillStyle = pronto ? '#ffd700' : '#aaa';
    ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(pronto ? 'ESPECIAL!' : 'ESPECIAL', 24, barY + barH + 22);
  }

  // ── Barra de carga especial P2 ──
  if (fighters[1]) {
    const pct   = Math.min((fighters[1].especialCharge || 0) / 100, 1);
    const pronto = pct >= 1;
    ctx.fillStyle = '#333';
    ctx.fillRect(W - 140, barY + barH + 8, 120, 8);
    ctx.fillStyle = pronto ? '#ffd700' : '#ce93d8';
    ctx.fillRect(W - 140, barY + barH + 8, 120 * pct, 8);
    ctx.fillStyle = pronto ? '#ffd700' : '#aaa';
    ctx.font = '10px monospace'; ctx.textAlign = 'right';
    ctx.fillText(pronto ? 'ESPECIAL!' : 'ESPECIAL', W - 24, barY + barH + 22);
  }
}

// Sobreposição semitransparente com número da contagem (5…1 → "LUTA!").
function _drawCountdown() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 120px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(countdownVal > 0 ? countdownVal : 'LUTA!', W / 2, H / 2 + 40);
}

// Overlay "KO!" exibido entre rounds.
function _drawRoundEnd() {
  const venceuIdx = fighters[0] && fighters[0].morreu ? 1 : 0;
  const venceu    = fighters[venceuIdx];

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 60px monospace'; ctx.textAlign = 'center';
  ctx.fillText('KO!', W / 2, H / 2 - 20);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px monospace';
  ctx.fillText(`${venceu ? venceu.nome : 'Jogador'} vence o round!`, W / 2, H / 2 + 30);
}

// Overlay "GAME OVER" com nome do vencedor. O QR do placar é exibido pelo index.html.
function _drawGameOver() {
  const venceuIdx = vitorias[0] >= 2 ? 0 : 1;
  const venceu    = fighters[venceuIdx];

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e94560'; ctx.font = 'bold 80px monospace'; ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 60);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 36px monospace';
  ctx.fillText(`${venceu ? venceu.nome : 'Jogador'} VENCEU!`, W / 2, H / 2);
}

// =============================================================================
// Tela SELECT — desenho
// =============================================================================

// Desenha os slots de personagens, cursores dos jogadores, previews de sprites
// e caixas de informação (stats, especial em foco).
function _drawSelect() {
  const defs       = PERSONAGENS_DEF; // array vindo de sprites.js
  const numPlayers = salaModo === 'single' ? 1 : 2;

  // Título e subtítulo de instrução
  ctx.fillStyle = '#e94560'; ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
  ctx.fillText('ESCOLHA SEU PERSONAGEM', W / 2, 60);
  ctx.fillStyle = '#888'; ctx.font = '14px monospace';
  ctx.fillText(
    numPlayers === 2
      ? 'P1: ◄ ► mover  |  🟢 confirmar                    P2: ◄ ► mover  |  🟢 confirmar'
      : '◄ ► mover   |   🟢 confirmar',
    W / 2, 88
  );

  // Layout dos slots
  const slotW = 180, slotH = 240, gap = 20;
  const totalW = defs.length * slotW + (defs.length - 1) * gap;
  const startX = (W - totalW) / 2;
  const startY = 130;

  defs.forEach((def, i) => {
    const x = startX + i * (slotW + gap);
    const y = startY;

    const isCursorP1 = selecao.cursor[0] === i && selecao.escolhido[0] === null;
    const isCursorP2 = numPlayers === 2 && selecao.cursor[1] === i && selecao.escolhido[1] === null;
    const escolhidoP1 = selecao.escolhido[0] === i;
    const escolhidoP2 = selecao.escolhido[1] === i;
    const bloqueado   = escolhidoP1 || escolhidoP2;

    // Fundo do slot com cor conforme estado
    if      (bloqueado)              ctx.fillStyle = '#0a2530';
    else if (isCursorP1 && isCursorP2) ctx.fillStyle = '#3a1a3a';
    else if (isCursorP1)             ctx.fillStyle = '#2a1020';
    else if (isCursorP2)             ctx.fillStyle = '#10202a';
    else                             ctx.fillStyle = '#15151f';
    _roundRect(ctx, x, y, slotW, slotH, 14);
    ctx.fill();

    // Borda sólida para personagem já escolhido
    if (escolhidoP1) {
      ctx.strokeStyle = '#e94560'; ctx.lineWidth = 4;
      _roundRect(ctx, x, y, slotW, slotH, 14); ctx.stroke();
    } else if (escolhidoP2) {
      ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 4;
      _roundRect(ctx, x, y, slotW, slotH, 14); ctx.stroke();
    }

    // Borda tracejada animada para cursor (antes de confirmar)
    if (isCursorP1 && !escolhidoP1) {
      ctx.strokeStyle = '#e94560'; ctx.lineWidth = 3;
      ctx.setLineDash((Math.floor(Date.now() / 200) % 2) ? [6, 4] : [4, 6]);
      _roundRect(ctx, x - 2, y - 2, slotW + 4, slotH + 4, 16); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (isCursorP2 && !escolhidoP2) {
      ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 3;
      ctx.setLineDash((Math.floor(Date.now() / 200) % 2) ? [6, 4] : [4, 6]);
      _roundRect(ctx, x - 6, y - 6, slotW + 12, slotH + 12, 18); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Retrato do personagem — sprites/{pasta}/{pasta}.png (com cover + border-radius)
    const rpW = slotW - 16;
    const rpH = slotH - 64;
    if (spriteManager && spriteManager.loaded) {
      spriteManager.drawRetrato(ctx, def.id, x + 8, y + 8, rpW, rpH);
    } else {
      ctx.fillStyle = def.cor;
      ctx.fillRect(x + 8, y + 8, rpW, rpH);
    }

    // Overlay escuro com "P1/P2 ESCOLHEU" sobre personagens já confirmados
    if (bloqueado) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      _roundRect(ctx, x, y, slotW, slotH, 14); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
      ctx.fillText(escolhidoP1 ? 'P1 ESCOLHEU' : 'P2 ESCOLHEU', x + slotW / 2, y + slotH / 2);
    }

    // Nome e stats do personagem (dados de PERSONAGENS_DEF / sprites.js)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText(def.nome, x + slotW / 2, y + slotH - 36);
    ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
    ctx.fillText(`HP ${def.hp}  VEL ${def.velocidade}`, x + slotW / 2, y + slotH - 18);
  });

  // Caixas de info: P1 e P2 (ou CPU) com nick, personagem em foco e stats
  _drawSelectInfoBox(0, 30, 420);
  if (numPlayers === 2) {
    _drawSelectInfoBox(1, W - 280 - 30, 420);
  } else {
    _drawCPUInfoBox(W - 280 - 30, 420);
  }

  // Caixa de especial do personagem em foco pelo P1
  _drawSelectEspecialFocus();
}

// Caixa de informações de um jogador humano (nick, personagem em foco, stats).
// player: 0 = P1, 1 = P2
function _drawSelectInfoBox(player, x, y) {
  const w   = 280, h = 130;
  const cor = player === 0 ? '#e94560' : '#1565c0';
  const nick = player === 0 ? nickP1 : nickP2;
  const personagemFoco = (selecao.escolhido[player] !== null)
    ? selecao.escolhido[player]
    : selecao.cursor[player];
  const def = PERSONAGENS_DEF[personagemFoco]; // sprites.js

  ctx.fillStyle = 'rgba(20,20,30,0.85)';
  _roundRect(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = cor; ctx.lineWidth = 2;
  _roundRect(ctx, x, y, w, h, 12); ctx.stroke();

  ctx.fillStyle = cor; ctx.fillRect(x, y, w, 28);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';  ctx.fillText(`PLAYER ${player + 1}`, x + 12, y + 19);
  ctx.textAlign = 'right'; ctx.fillText(
    selecao.escolhido[player] !== null ? '✓ PRONTO' : 'ESCOLHENDO...', x + w - 12, y + 19);

  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
  ctx.fillText(nick, x + w / 2, y + 60);
  ctx.fillStyle = def.cor; ctx.font = 'bold 18px monospace';
  ctx.fillText(def.nome, x + w / 2, y + 88);
  ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
  ctx.fillText(`HP ${def.hp}  |  Velocidade ${def.velocidade}`, x + w / 2, y + 108);
  ctx.fillText(`Dano  ${def.dano.leve} / ${def.dano.forte} / ${def.dano.especial}`, x + w / 2, y + 122);
}

// Caixa de informações da CPU: mostra dificuldade e personagem sorteado (ou "aguardando").
function _drawCPUInfoBox(x, y) {
  const w   = 280, h = 130;
  const cor = '#1565c0';
  const def = selecao.escolhido[1] !== null ? PERSONAGENS_DEF[selecao.escolhido[1]] : null;

  ctx.fillStyle = 'rgba(20,20,30,0.85)';
  _roundRect(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = cor; ctx.lineWidth = 2;
  _roundRect(ctx, x, y, w, h, 12); ctx.stroke();

  ctx.fillStyle = cor; ctx.fillRect(x, y, w, 28);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';  ctx.fillText('CPU', x + 12, y + 19);
  ctx.textAlign = 'right'; ctx.fillText(`DIF: ${dificuldadeIA.toUpperCase()}`, x + w - 12, y + 19);

  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
  ctx.fillText('Computador', x + w / 2, y + 62);

  if (def) {
    ctx.fillStyle = def.cor; ctx.font = 'bold 16px monospace';
    ctx.fillText(`Vai usar: ${def.nome}`, x + w / 2, y + 92);
  } else {
    ctx.fillStyle = '#666'; ctx.font = '13px monospace';
    ctx.fillText('Aguardando P1 escolher...', x + w / 2, y + 92);
  }
}

// Caixa inferior com o nome e descrição do especial do personagem em foco pelo P1.
function _drawSelectEspecialFocus() {
  const idx = selecao.escolhido[0] !== null ? selecao.escolhido[0] : selecao.cursor[0];
  const def = PERSONAGENS_DEF[idx]; // sprites.js
  const x = W / 2 - 200, y = 575, w = 400, h = 60;

  ctx.fillStyle = 'rgba(206,147,216,0.12)';
  _roundRect(ctx, x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = '#ce93d8'; ctx.lineWidth = 1;
  _roundRect(ctx, x, y, w, h, 10); ctx.stroke();

  ctx.fillStyle = '#ce93d8'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`ESPECIAL: ${def.especial}`, W / 2, y + 22);
  ctx.fillStyle = '#aaa'; ctx.font = '12px monospace';
  ctx.fillText(def.descEspecial, W / 2, y + 42);
}

// Utilitário: desenha um retângulo com cantos arredondados no ctx.
// Não aplica fill/stroke — o chamador decide o estilo.
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// =============================================================================
// Funções de fluxo — chamadas pelo index.html via window.Game
// =============================================================================

// Inicia o fluxo de uma nova partida: guarda dados da sala, reseta seleção,
// limpa input residual e muda estado para SELECT.
// Chamado por index.html após QR/offline confirmar os jogadores.
// modo: 'single' | 'multi'
// id: sala_id do backend (null em modo offline)
// tokenP1: JWT do P1 para registrar resultado (null em modo offline)
function iniciarFluxo(modo, id, tokenP1, tokenP2 = null) {
  salaId      = id;
  salaToken   = tokenP1;
  salaTokenP2 = tokenP2;
  salaModo    = modo;

  selecao = { cursor: [0, 1], escolhido: [null, null] };

  // Limpa teclas pressionadas e espelha estado do gamepad em prev
  // para que justPressed() não dispare para inputs já mantidos
  Controls.resetInput(); // controls.js

  // Avisa index.html para ocultar menus e marcar _telaAtual = 'jogando'
  document.dispatchEvent(new CustomEvent('game:selectIniciado'));

  gameState = 'SELECT';
}

// Recebe os nicks dos jogadores vindos do index.html (após autenticação ou modo offline).
// Os nicks são aplicados nos Fighters em iniciarPartidaComEscolhas().
function jogadoresEntraramprontos(nicks) {
  nickP1 = nicks[0] || 'P1';
  nickP2 = nicks[1] || (salaModo === 'single' ? 'CPU' : 'P2');
}

// Recria os Fighters com os mesmos personagens do round 1 e reinicia o countdown.
// Usado entre rounds (não recria a seleção de personagens).
function _reiniciarRound() {
  projeteis = [];
  const f1 = new Fighter(0, selecao.escolhido[0], 200);
  const f2 = new Fighter(1, selecao.escolhido[1], W - 280);
  f1.nome  = nickP1;
  f2.nome  = nickP2;
  fighters = [f1, f2];
  if (salaModo === 'single') ia = new IA(f2, dificuldadeIA);

  countdownVal   = 3;
  countdownTimer = 1000;
  gameState      = 'COUNTDOWN';
}

// Marca GAME_OVER, notifica index.html para exibir o QR do placar e
// registra o resultado no backend via Api.registrarResultado().
// ► CHAMADA DE API: POST /partida/resultado (api.js → backend/main.py)
async function _encerrarPartida() {
  gameState = 'GAME_OVER';

  // index.html ouve este evento e exibe o QR do placar após 2.5s
  document.dispatchEvent(new CustomEvent('game:gameOver'));

  // Sem sala/token = modo offline; resultado não é enviado
  if (!salaId || !salaToken) return;

  const venceuIdx  = vitorias[0] > vitorias[1] ? 0 : 1;
  const tokenVenc  = venceuIdx === 0 ? salaToken : (salaTokenP2 || salaToken);
  const pontos_j1  = fighters[0] ? fighters[0].pontos : 0;
  const pontos_j2  = fighters[1] ? fighters[1].pontos : 0;

  console.log('[Game] Encerrando partida. Vencedor:', fighters[venceuIdx]?.nome || `P${venceuIdx + 1}`,
    `| Vitórias: ${vitorias[0]}x${vitorias[1]} | Pontos: ${pontos_j1}x${pontos_j2}`);

  try {
    const resultado = await Api.registrarResultado(salaId, tokenVenc, pontos_j1, pontos_j2);
    if (!resultado.ok) {
      console.warn('[Game] Falha ao registrar resultado:', resultado.erro);
    } else {
      console.log('[Game] Resultado registrado com sucesso:', resultado);
    }
  } catch (e) {
    console.error('[Game] Erro inesperado ao registrar resultado:', e);
  }
}

// Reseta todo o estado de partida e retorna ao menu principal.
// Chamado por Game.voltarInicio() (exposto ao index.html) e pelo listener 'game:telaInicial'.
function _voltarInicio() {
  salaId      = null;
  salaToken   = null;
  salaTokenP2 = null;
  fighters    = [];
  projeteis  = [];
  vitorias   = [0, 0];
  roundAtual = 1;
  gameState  = 'TELA_INICIAL';
}

// Define a dificuldade da IA. Chamado por index.html antes de iniciarFluxo.
function setDificuldade(d) { dificuldadeIA = d; }

// Ouve 'game:telaInicial' disparado pelo index.html (botão "Voltar ao Menu" no QR do placar).
// Só retorna ao início se o jogo estiver em GAME_OVER para não interromper partidas.
document.addEventListener('game:telaInicial', () => {
  if (gameState === 'GAME_OVER') _voltarInicio();
});

// =============================================================================
// API pública exposta ao index.html via window.Game
// =============================================================================
window.Game = {
  init,
  iniciarFluxo,
  jogadoresEntraramprontos,
  setDificuldade,
  getState:     () => gameState,
  voltarInicio: _voltarInicio,
  pausar:  () => { gamePausado = true;  },
  retomar: () => { gamePausado = false; },
  setSfxVolume: v => { SFXManager._volume = Math.max(0, Math.min(1, v)); },
};

window.SFXManager = SFXManager;
