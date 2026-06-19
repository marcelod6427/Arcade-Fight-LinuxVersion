// =============================================================================
// controls.js — Sistema unificado de input: teclado + gamepad
//
// Responsabilidades:
//   1. Capturar eventos de teclado de forma assíncrona (listeners Globais).
//   2. Ler o estado dos gamepads conectados via Web Gamepad API a cada frame.
//   3. Mapear botões físicos (gamepad e teclado) para ações lógicas abstratas:
//      'left', 'right', 'up', 'down', 'jump', e botões de ação 'b0' a 'b4'.
//   4. Manter o estado do input atual (state) e do frame anterior (prev) para
//      permitir a detecção de cliques únicos (justPressed).
//   5. Disparar eventos customizados para navegação de menu (L2 / R2 para voltar/sair).
// =============================================================================

const DEBUG_GAMEPAD = false;

const Controls = {
  // Estado atual dos inputs de ambos os jogadores (0 = P1, 1 = P2)
  state: [
    { left: false, right: false, up: false, down: false, jump: false, btn: [false, false, false, false, false] },
    { left: false, right: false, up: false, down: false, jump: false, btn: [false, false, false, false, false] }
  ],
  // Estado dos inputs no frame anterior (útil para detectar clique inicial)
  prev: [
    { left: false, right: false, up: false, down: false, jump: false, btn: [false, false, false, false, false] },
    { left: false, right: false, up: false, down: false, jump: false, btn: [false, false, false, false, false] }
  ],
  // Mapeamento físico dos controles Arcade (Web Gamepad API):
  //   up: índice do botão de pulo (verde)
  //   buttons: índices dos botões físicos correspondentes às ações lógicas [b0, b1, b2, b3, b4]
  //   l2, r2: botões de controle de menu/atalhos
  //   axes: índices dos eixos horizontal e vertical do joystick analógico
  //   deadzone: limite de sensibilidade do analógico para evitar drift
  mappings: [
    { up: 3, buttons: [0, 4, 1, 2, -1], l2: 5, r2: -1, axes: [0,1], deadzone: 0.3 },
    { up: 3, buttons: [0, 1, 4, 2, -1], l2: -1, r2: 5, axes: [0,1], deadzone: 0.3 }
  ],
  // Estado anterior dos botões L2/R2 para evitar múltiplos disparos rápidos em menus
  _menuPrev: [ { l2: false, r2: false }, { l2: false, r2: false } ],

  // Mapeamento padrão do Teclado para o Player 1 (Teclas WASD + J/K/L/I/U)
  keymapP1: {
    'KeyA':  'left', 'KeyD':  'right', 'KeyW':  'up', 'KeyS':  'down',
    'Space': 'jump', // Pulo (Botão Verde ou Barra de Espaço)
    'KeyJ':  'b0',   // Ataque Rápido (Botão Amarelo)
    'KeyK':  'b1',   // Ataque Forte (Botão Preto)
    'KeyL':  'b2',   // Bloquear (Botão Vermelho)
    'KeyI':  'b3',   // Especial (Botão Azul)
    'KeyU':  'b4',   // Janela de Counter
    'F1':    'l2',   // Atalho para voltar ao menu
    'F2':    'r2'
  },

  // Mapeamento padrão do Teclado para o Player 2 (Setas direcionais + Numpad)
  keymapP2: {
    'ArrowLeft': 'left', 'ArrowRight': 'right', 'ArrowUp': 'up', 'ArrowDown': 'down',
    'Numpad0':   'jump', // Pulo P2
    'Numpad1':   'b0',   // Ataque Rápido P2
    'Numpad2':   'b1',   // Ataque Forte P2
    'Numpad3':   'b2',   // Bloquear P2
    'Numpad5':   'b3',   // Especial P2
    'Numpad4':   'b4',   // Janela de Counter P2
    'F3':        'l2',   // Atalho para voltar ao menu P2
    'F4':        'r2'
  },

  _keysDown: new Set(),
  _ignoreInputFrames: 0,

  init() {
    window.addEventListener('keydown', e => {
      this._keysDown.add(e.code);
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this._keysDown.delete(e.code); });
  },

  update() {
    if (this._ignoreInputFrames > 0) this._ignoreInputFrames--;

    for (let p = 0; p < 2; p++) {
      this.prev[p].left  = this.state[p].left;
      this.prev[p].right = this.state[p].right;
      this.prev[p].up    = this.state[p].up;
      this.prev[p].down  = this.state[p].down;
      this.prev[p].jump  = this.state[p].jump;
      for (let b = 0; b < 5; b++) this.prev[p].btn[b] = this.state[p].btn[b];
    }

    for (let p = 0; p < 2; p++) {
      this.state[p].left = this.state[p].right = this.state[p].up = this.state[p].down = this.state[p].jump = false;
      for (let b = 0; b < 5; b++) this.state[p].btn[b] = false;
    }

    for (const code of this._keysDown) {
      if (this.keymapP1[code]) this._applyKey(0, this.keymapP1[code]);
      if (this.keymapP2[code]) this._applyKey(1, this.keymapP2[code]);
    }

    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();

    for (let p = 0; p < 2; p++) {
      const pad = pads[p];
      if (!pad || !pad.connected) continue;

      const m  = this.mappings[p];
      const dz = m.deadzone;
      const h = pad.axes[m.axes[0]] || 0;
      const v = pad.axes[m.axes[1]] || 0;

      if (h < -dz) this.state[p].left  = true;
      if (h >  dz) this.state[p].right = true;
      if (v < -dz) this.state[p].up    = true; // Agora o joystick pra cima registra 'up' direcional!
      if (v >  dz) this.state[p].down  = true;

      const upBtn = pad.buttons[m.up];
      if (upBtn && (typeof upBtn === 'object' ? upBtn.pressed : upBtn > 0)) {
        this.state[p].jump = true; // Botão físico verde registra a ação 'jump'
      }

      for (let b = 0; b < 5; b++) {
        if (m.buttons[b] < 0) continue;
        const btn = pad.buttons[m.buttons[b]];
        if (btn && (typeof btn === 'object' ? btn.pressed : btn > 0)) {
          this.state[p].btn[b] = true;
        }
      }
    }

    // Callbacks do L2/R2...
    for (let p = 0; p < 2; p++) {
      const pad = pads[p];
      if (!pad || !pad.connected) { this._menuPrev[p].l2 = this._menuPrev[p].r2 = false; continue; }
      const m = this.mappings[p];
      const _b = idx => {
        if (idx < 0) return false;
        const b = pad.buttons[idx]; return b ? (typeof b === 'object' ? b.pressed : b > 0) : false;
      };
      const l2Cur = _b(m.l2), r2Cur = _b(m.r2);
      if (this._ignoreInputFrames <= 0) {
        if (l2Cur && !this._menuPrev[p].l2) document.dispatchEvent(new CustomEvent('controls:menuBtn', { detail: { player: p, btn: 'l2' } }));
        if (r2Cur && !this._menuPrev[p].r2) document.dispatchEvent(new CustomEvent('controls:menuBtn', { detail: { player: p, btn: 'r2' } }));
      }
      this._menuPrev[p].l2 = l2Cur; this._menuPrev[p].r2 = r2Cur;
    }
  },

  _applyKey(player, action) {
    if (action === 'left')  this.state[player].left  = true;
    if (action === 'right') this.state[player].right = true;
    if (action === 'up')    this.state[player].up    = true;
    if (action === 'down')  this.state[player].down  = true;
    if (action === 'jump')  this.state[player].jump  = true;
    if (action.startsWith('b')) {
      const idx = parseInt(action[1]);
      if (idx >= 0 && idx < 5) this.state[player].btn[idx] = true;
    }
  },

  justPressed(player, action) {
    if (this._ignoreInputFrames > 0) return false;
    return this._getVal(this.state[player], action) && !this._getVal(this.prev[player], action);
  },

  _getVal(s, action) {
    if (action === 'left')  return s.left;  if (action === 'right') return s.right;
    if (action === 'up')    return s.up;    if (action === 'down')  return s.down;
    if (action === 'jump')  return s.jump;
    if (action.startsWith('b')) return s.btn[parseInt(action[1])];
    return false;
  },

  getInput(player) { return this.state[player]; },

  resetInput() {
    this._ignoreInputFrames = 8;
    this._keysDown.clear();
    for (let p = 0; p < 2; p++) {
      this.state[p].left = this.state[p].right = this.state[p].up = this.state[p].down = this.state[p].jump = false;
      for (let b = 0; b < 5; b++) this.state[p].btn[b] = false;

      if (navigator.getGamepads) {
        const pad = navigator.getGamepads()[p];
        if (pad && pad.connected) {
          const m  = this.mappings[p];
          const dz = m.deadzone;
          const h  = pad.axes[m.axes[0]] || 0;
          const v  = pad.axes[m.axes[1]] || 0;
          if (h < -dz) this.state[p].left  = true;
          if (h >  dz) this.state[p].right = true;
          if (v < -dz) this.state[p].up    = true;
          if (v >  dz) this.state[p].down  = true;
          const upBtn = pad.buttons[m.up];
          if (upBtn && (typeof upBtn === 'object' ? upBtn.pressed : upBtn > 0)) {
            this.state[p].jump = true;
          }
          for (let b = 0; b < 5; b++) {
            if (m.buttons[b] < 0) continue;
            const btn = pad.buttons[m.buttons[b]];
            if (btn && (typeof btn === 'object' ? btn.pressed : btn > 0)) this.state[p].btn[b] = true;
          }
        }
      }
      this.prev[p].left  = this.state[p].left; this.prev[p].right = this.state[p].right;
      this.prev[p].up    = this.state[p].up;   this.prev[p].down  = this.state[p].down;
      this.prev[p].jump  = this.state[p].jump;
      for (let b = 0; b < 5; b++) this.prev[p].btn[b] = this.state[p].btn[b];

      const padSnap = navigator.getGamepads ? navigator.getGamepads()[p] : null;
      const mSnap = this.mappings[p];
      const _bSnap = idx => {
        if (idx < 0 || !padSnap || !padSnap.connected) return false;
        const b = padSnap.buttons[idx]; return b ? (typeof b === 'object' ? b.pressed : b > 0) : false;
      };
      this._menuPrev[p].l2 = _bSnap(mSnap.l2); this._menuPrev[p].r2 = _bSnap(mSnap.r2);
    }
  }
};
window.Controls = Controls;