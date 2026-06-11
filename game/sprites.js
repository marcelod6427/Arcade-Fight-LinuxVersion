// =============================================================================
// sprites.js — Sistema de sprites por frames individuais
//
// Responsabilidades:
//   1. Definir as fichas de todos os personagens (PERSONAGENS_DEF)
//   2. Mapear nomes de animação do código para pastas de disco (ANIM_MAP)
//   3. Carregar todos os frames em memória como objetos Image (SpriteManager.carregar)
//   4. Desenhar o frame correto no canvas a cada chamada de draw/drawPreview
//   5. Avançar a animação frame a frame respeitando fps e modo loop/one-shot
//
// Estrutura de pastas esperada em sprites/:
//   sprites/
//     {personagem}/          ← pasta definida em PERSONAGENS_DEF[].pasta
//       idle/   0.png 1.png ...
//       walk/   0.png 1.png ...
//       run/    0.png 1.png ...
//       jump/   0.png 1.png ...
//       attack1/ attack2/ attack3/
//       hurt/   death/   shield/
//
// Exporta para window (consumido por game.js):
//   window.SpriteManager   — classe principal
//   window.PERSONAGENS_DEF — array de fichas dos personagens
//   window.ANIM_MAP        — mapeamento animação → pasta/fps/loop
// =============================================================================

// Node.js/Electron: necessário para leitura de arquivos do disco
const path = require('path');
const fs   = require('fs');

// =============================================================================
// PERSONAGENS_DEF — fichas de todos os personagens jogáveis
//
// Cada entrada define:
//   id          → índice usado pelo SpriteManager e pela classe Fighter (game.js)
//   pasta       → subpasta dentro de sprites/ com os frames
//   cor         → cor de fallback quando o sprite não carrega
//   hp          → pontos de vida iniciais
//   velocidade  → pixels por frame de movimento horizontal
//   dano        → { leve, forte, especial } — usado por Fighter._iniciarAtaque e receberDano
//   alcance     → { normal, especial } — raio da hitbox de ataque em pixels
//   especial    → nome do especial (exibido na tela SELECT)
//   descEspecial → descrição do especial (exibida na tela SELECT)
//
// Lógica de balanceamento: menor alcance → mais dano; maior alcance → menos dano
// =============================================================================
const PERSONAGENS_DEF = [
  {
    id: 0,
    nome: 'Espadachim',
    pasta: 'espadachim',
    cor: '#4fc3f7',
    hp: 100,
    especial: 'Lâmina Veloz',
    descEspecial: 'Investida rápida com corte em área',
    velocidade: 4.5,
    dano: { leve: 7, forte: 17, especial: 25 },
    alcance: { normal: 130, especial: 155 }
  },
  {
    id: 1,
    nome: 'Lutador',
    pasta: 'lutador',
    cor: '#ef9a9a',
    hp: 130,
    especial: 'Impacto Sísmico',
    descEspecial: 'Salta e abala o chão causando dano em área',
    velocidade: 3.5,
    dano: { leve: 11, forte: 20, especial: 28 },
    alcance: { normal: 110, especial: 135 }
  },
  {
    id: 2,
    nome: 'Mago',
    pasta: 'mago',
    cor: '#ce93d8',
    hp: 90,
    especial: 'Tempestade Arcana',
    descEspecial: 'Conjura três projéteis mágicos',
    velocidade: 4.0,
    dano: { leve: 8, forte: 15, especial: 22 },
    alcance: { normal: 240, especial: 270 }
  },
  {
    id: 3,
    nome: 'Vampira',
    pasta: 'vampira',
    cor: '#f48fb1',
    hp: 110,
    especial: 'Véu de Sangue',
    descEspecial: 'Manto sombrio concede invencibilidade por 2s',
    velocidade: 4.2,
    dano: { leve: 8, forte: 16, especial: 0 }, // especial = invencibilidade, sem dano direto
    alcance: { normal: 240, especial: 270 }
  },
  {
    id: 4,
    nome: 'Vampiro',
    pasta: 'vampiro',
    cor: '#80cbc4',
    hp: 95,
    especial: 'Sombra Veloz',
    descEspecial: 'Desmaterializa e reaparece atrás do inimigo',
    velocidade: 5.0,
    dano: { leve: 10, forte: 18, especial: 24 },
    alcance: { normal: 130, especial: 155 }
  }
];

// =============================================================================
// ANIM_MAP — mapeia o nome interno da animação para a pasta de frames no disco
//
// Chave  → nome usado no código (animState.nome, Fighter.state, etc.)
// pasta  → subpasta dentro de sprites/{personagem}/
// fps    → frames por segundo da animação (todos em 12 fps atualmente)
// loop   → true = reinicia ao acabar | false = congela no último frame (one-shot)
//
// Convenção de pastas no disco:
//   attack1 = ataque rápido (ATTACK)
//   attack2 = ataque forte  (ATTACK2)
//   attack3 = especial      (SPECIAL)
//   hurt    = animação de hit (HIT)
//   shield  = bloquear (DEFEND)
// =============================================================================
const ANIM_MAP = {
  IDLE:    { pasta: 'idle',    fps: 12, loop: true  },
  WALK:    { pasta: 'walk',    fps: 12, loop: true  },
  RUN:     { pasta: 'run',     fps: 12, loop: true  },
  JUMP:    { pasta: 'jump',    fps: 12, loop: false },
  ATTACK:  { pasta: 'attack1', fps: 12, loop: false },
  ATTACK2: { pasta: 'attack2', fps: 12, loop: false },
  HIT:     { pasta: 'hurt',    fps: 12, loop: false },
  DEATH:   { pasta: 'death',   fps: 12, loop: false },
  SPECIAL: { pasta: 'attack3', fps: 12, loop: false },
  DEFEND:  { pasta: 'shield',  fps: 12, loop: false }
};

// =============================================================================
// SpriteManager — gerencia carregamento e renderização de todos os sprites
// =============================================================================
class SpriteManager {
  // spritesPath: caminho absoluto para a pasta sprites/ (definido em game.js via SPRITES_PATH)
  constructor(spritesPath) {
    this.spritesPath = spritesPath;
    this.personagens = []; // array de objetos { ...def, animacoes: { IDLE: [Image...], ... } }
    this.loaded      = false; // true após carregar() concluir
  }

  // Carrega todos os frames de todos os personagens e animações em paralelo.
  // Para cada personagem em PERSONAGENS_DEF, lê cada pasta definida em ANIM_MAP
  // e cria objetos Image com src = file:///caminho/absoluto/frame.png (protocolo Electron).
  // Aguarda todos os onload/onerror antes de marcar loaded = true.
  async carregar() {
    const tarefas = []; // promessas de carregamento individuais de cada Image

    for (const def of PERSONAGENS_DEF) {
      // Copia a ficha do personagem e adiciona o mapa de animações
      const p = { ...def, animacoes: {} };

      for (const [animKey, animInfo] of Object.entries(ANIM_MAP)) {
        // Caminho: sprites/{personagem}/{animacao}/
        const pastaAnim = path.join(this.spritesPath, def.pasta, animInfo.pasta);
        const frames    = this._listarFrames(pastaAnim); // lista 0.png, 1.png, ...

        if (frames.length === 0) {
          console.warn(`[Sprites] ${def.nome}/${animInfo.pasta}: nenhum frame encontrado`);
          p.animacoes[animKey] = [];
          continue;
        }

        // Cria um Image para cada frame e inicia o carregamento via file:///
        const imagens = frames.map(arq => {
          const img    = new Image();
          const caminho = path.join(pastaAnim, arq).replace(/\\/g, '/');
          img.src = `file:///${caminho}`; // protocolo necessário no Electron
          tarefas.push(new Promise(resolve => {
            img.onload  = () => resolve();
            img.onerror = () => {
              console.warn('[Sprites] Falha ao carregar:', caminho);
              resolve(); // não rejeita — continua mesmo com frames faltando
            };
          }));
          return img;
        });

        p.animacoes[animKey] = imagens;
      }

      // Retrato estático: sprites/{pasta}/{pasta}.png (ex: espadachim/espadachim.png)
      const retratoCaminho = path.join(this.spritesPath, def.pasta, def.pasta + '.png')
                                  .replace(/\\/g, '/');
      const retrato = new Image();
      retrato.src   = `file:///${retratoCaminho}`;
      p.retrato     = null; // preenchido no onload
      tarefas.push(new Promise(resolve => {
        retrato.onload  = () => { p.retrato = retrato; resolve(); };
        retrato.onerror = () => {
          console.warn('[Sprites] Retrato não encontrado:', retratoCaminho);
          resolve();
        };
      }));

      this.personagens.push(p);
    }

    await Promise.all(tarefas); // aguarda todos os frames e retratos carregarem
    this._logResumo();
    this.loaded = true;
  }

  // Lista os arquivos de frame de uma pasta em ordem numérica (0.png, 1.png, ...).
  // Retorna array vazio se a pasta não existir ou ocorrer erro de I/O.
  _listarFrames(pasta) {
    try {
      if (!fs.existsSync(pasta)) return [];
      return fs.readdirSync(pasta)
        .filter(f => /^\d+\.png$/i.test(f))
        .sort((a, b) => parseInt(a) - parseInt(b));
    } catch (e) {
      console.warn('[Sprites] Erro lendo pasta', pasta, e.message);
      return [];
    }
  }

  // Imprime no console quantos frames foram carregados por animação/personagem.
  // Útil para diagnosticar sprites faltando em tempo de desenvolvimento.
  _logResumo() {
    console.log('[Sprites] === Resumo de carregamento ===');
    for (const p of this.personagens) {
      const partes = Object.entries(p.animacoes)
        .map(([k, frames]) => `${k}:${frames.length}`);
      console.log(`  ${p.nome}: ${partes.join(' ')}`);
    }
  }

  // Retorna quantos frames a animação animNome possui para o personagem personagemId.
  // Fallback para IDLE se a animação não existir. Mínimo de 1 para evitar divisão por zero.
  // Usado por tickAnim() para saber quando reiniciar/parar a animação.
  getNumFrames(personagemId, animNome) {
    const p = this.personagens[personagemId];
    if (!p) return 1;
    const frames = p.animacoes[animNome] || p.animacoes['IDLE'] || [];
    return Math.max(frames.length, 1);
  }

  // Renderiza o frame atual de animState para o personagem personagemId no ctx.
  //
  // Parâmetros:
  //   ctx             → CanvasRenderingContext2D
  //   personagemId    → índice em PERSONAGENS_DEF / this.personagens
  //   animState       → { nome, frame, timer } — mutado por tickAnim/setAnim
  //   x, y            → canto superior-esquerdo da hitbox do Fighter
  //   largura, altura → dimensões da hitbox
  //   viradoEsquerda  → true = espelha horizontalmente
  //
  // Escala visual: 2.5× sobre o tamanho natural do PNG (hitbox não é afetada).
  //
  // Âncora:
  //   Animações normais  → centro-base da hitbox (pé do personagem)
  //   ATTACK / ATTACK2   → borda do corpo (o sprite se expande para fora livremente)
  //
  // Fallback: se o sprite não carregou, preenche a hitbox com a cor do personagem.
  draw(ctx, personagemId, animState, x, y, largura, altura, viradoEsquerda = false) {
    const p = this.personagens[personagemId];
    if (!p) return;

    // Usa IDLE como fallback se a animação pedida não tiver frames
    let frames = p.animacoes[animState.nome];
    if (!frames || frames.length === 0) frames = p.animacoes['IDLE'];

    if (!frames || frames.length === 0) {
      // Fallback visual: retângulo colorido + inicial do nome
      ctx.fillStyle = p.cor;
      ctx.fillRect(x, y, largura, altura);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(altura * 0.25)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(p.nome[0], x + largura / 2, y + altura * 0.6);
      return;
    }

    const idx = animState.frame % frames.length;
    const img = frames[idx];

    if (!img || img.naturalWidth === 0) {
      // Imagem ainda não carregou ou falhou: fallback colorido
      ctx.fillStyle = p.cor;
      ctx.fillRect(x, y, largura, altura);
      return;
    }

    const ESCALA = 2.5;
    const drawW  = img.naturalWidth  * ESCALA;
    const drawH  = img.naturalHeight * ESCALA;

    // Ponto de âncora padrão: centro horizontal, base da hitbox (pé do personagem)
    const feetX = x + largura / 2;
    const feetY = y + altura;

    // Ataques expandem para o lado de ataque sem afetar a posição do corpo
    const isAtaque = (animState.nome === 'ATTACK' || animState.nome === 'ATTACK2');

    ctx.save();
    if (isAtaque) {
      if (viradoEsquerda) {
        // Corpo à direita: âncora na borda direita da hitbox, espelha horizontalmente
        ctx.translate(x + largura, feetY);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, -drawH, drawW, drawH);
      } else {
        // Corpo à esquerda: âncora na borda esquerda da hitbox
        ctx.drawImage(img, x, feetY - drawH, drawW, drawH);
      }
    } else {
      if (viradoEsquerda) {
        ctx.translate(feetX, feetY);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -drawW / 2, -drawH, drawW, drawH);
      } else {
        ctx.drawImage(img, feetX - drawW / 2, feetY - drawH, drawW, drawH);
      }
    }
    ctx.restore();
  }

  // Renderiza o retrato estático do personagem (sprites/{pasta}/{pasta}.png).
  // Aplica object-fit:contain (mantém proporção, sem corte) e
  // clip com border-radius de 20px em todos os cantos.
  // Fallback automático para drawPreview() se o retrato não carregou.
  drawRetrato(ctx, personagemId, x, y, w, h) {
    const p = this.personagens[personagemId];
    if (!p) return;
    const img = p.retrato;
    if (!img || img.naturalWidth === 0) {
      this.drawPreview(ctx, personagemId, x, y, w, h);
      return;
    }
    ctx.save();
    // Clip arredondado (border-radius 20px)
    const r = 20;
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
    ctx.clip();
    // Object-fit: contain — escala para caber no box mantendo proporção (sem corte)
    const imgAR = img.naturalWidth / img.naturalHeight;
    const boxAR = w / h;
    let dw, dh, dx, dy;
    if (imgAR > boxAR) {
      dw = w; dh = w / imgAR;
      dx = x; dy = y + (h - dh) / 2;
    } else {
      dh = h; dw = h * imgAR;
      dx = x + (w - dw) / 2; dy = y;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  // Renderiza o primeiro frame IDLE do personagem em um retângulo arbitrário.
  // Usado nos slots da tela SELECT (game.js → _drawSelect).
  // Se o sprite não carregou, exibe fallback colorido com a inicial do nome.
  drawPreview(ctx, personagemId, x, y, largura, altura) {
    const p = this.personagens[personagemId];
    if (!p) return;

    const frames = p.animacoes['IDLE'] || [];
    const img    = frames[0];

    if (!img || img.naturalWidth === 0) {
      ctx.fillStyle = p.cor;
      ctx.fillRect(x, y, largura, altura);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(altura * 0.4)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.nome[0], x + largura / 2, y + altura / 2);
      ctx.textBaseline = 'alphabetic';
      return;
    }

    ctx.drawImage(img, x, y, largura, altura);
  }

  // Avança o contador de tempo de animState e troca de frame quando necessário.
  //
  // Retorna true apenas quando uma animação one-shot (loop: false) chega ao último frame.
  // game.js usa esse retorno para detectar fim de HIT e voltar ao IDLE.
  //
  // animState  → objeto { nome, frame, timer } do Fighter (mutado in-place)
  // deltaMs    → milissegundos desde o último frame (vem do game loop)
  // personagemId → necessário para saber o total de frames via getNumFrames
  tickAnim(animState, deltaMs, personagemId) {
    const anim        = ANIM_MAP[animState.nome] || ANIM_MAP.IDLE;
    const totalFrames = personagemId !== undefined
      ? this.getNumFrames(personagemId, animState.nome)
      : 1;

    animState.timer = (animState.timer || 0) + deltaMs;
    const msPerFrame = 1000 / anim.fps;

    if (animState.timer >= msPerFrame) {
      animState.timer -= msPerFrame;
      animState.frame++;

      if (animState.frame >= totalFrames) {
        if (anim.loop) {
          animState.frame = 0; // reinicia animação em loop
        } else {
          animState.frame = totalFrames - 1; // congela no último frame
          return true; // sinaliza conclusão da animação one-shot
        }
      }
    }
    return false;
  }

  // Troca a animação corrente de animState para novaAnim, reiniciando frame e timer.
  // Só faz algo se o nome realmente mudou (evita reiniciar a mesma animação).
  // Chamado por Fighter.update(), _iniciarAtaque() e receberDano() em game.js.
  setAnim(animState, novaAnim) {
    if (animState.nome !== novaAnim) {
      animState.nome  = novaAnim;
      animState.frame = 0;
      animState.timer = 0;
    }
  }
}

// =============================================================================
// Exportações globais — consumidas por game.js (carregado após este arquivo)
// =============================================================================
window.SpriteManager   = SpriteManager;
window.PERSONAGENS_DEF = PERSONAGENS_DEF;
window.ANIM_MAP        = ANIM_MAP;
