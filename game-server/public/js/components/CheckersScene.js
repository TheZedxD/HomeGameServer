const RED_PIECES = new Set([1, 3]);
const BLACK_PIECES = new Set([2, 4]);

export class CheckersScene {
  constructor(config = {}) {
    const { socket, myColor, gameState, roundMessage, containerId = 'game-container' } = config;
    this.socket = socket;
    this.myColor = myColor;
    this.gameState = gameState || null;
    this.pendingAnnouncement = roundMessage || null;
    this.containerId = containerId;

    this.BOARD_SIZE = 8;
    this.CELL_SIZE = 80;

    this.rootElement = null;
    this.canvas = null;
    this.ctx = null;
    this.selectedPiece = null;
    this.announcementElement = null;
    this.announcementTimeout = null;

    this.handleBoardClick = this.handleBoardClick.bind(this);
  }

  init() {
    const host = document.getElementById(this.containerId);
    if (!host) {
      throw new Error('Unable to locate game container element.');
    }

    host.innerHTML = '';
    this.rootElement = document.createElement('div');
    this.rootElement.className = 'checkers-board';

    const canvasSize = this.BOARD_SIZE * this.CELL_SIZE;
    const pixelRatio = window.devicePixelRatio || 1;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'checkers-canvas';
    this.canvas.width = canvasSize * pixelRatio;
    this.canvas.height = canvasSize * pixelRatio;
    this.canvas.style.width = `${canvasSize}px`;
    this.canvas.style.maxWidth = '100%';
    this.canvas.style.height = 'auto';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Interactive checkers board');

    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.scale(pixelRatio, pixelRatio);
      this.ctx.imageSmoothingEnabled = true;
    }

    this.rootElement.appendChild(this.canvas);
    host.appendChild(this.rootElement);

    this.canvas.addEventListener('click', this.handleBoardClick);

    this.render();

    if (this.pendingAnnouncement) {
      this.showAnnouncement(this.pendingAnnouncement);
      this.pendingAnnouncement = null;
    }
  }

  render() {
    if (!this.ctx) return;
    this.drawBoard();
    this.drawPieces();
  }

  drawBoard() {
    if (!this.ctx) return;
    const lightSquareColor = '#c9d6a3';
    const darkSquareColor = '#0a4f0a';

    for (let y = 0; y < this.BOARD_SIZE; y++) {
      for (let x = 0; x < this.BOARD_SIZE; x++) {
        const color = (x + y) % 2 === 0 ? lightSquareColor : darkSquareColor;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
      }
    }
  }

  drawPieces() {
    if (!this.ctx || !this.gameState?.board) return;
    const radius = this.CELL_SIZE / 2 - 8;

    this.ctx.save();
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (let y = 0; y < this.BOARD_SIZE; y++) {
      for (let x = 0; x < this.BOARD_SIZE; x++) {
        const pieceType = this.gameState.board[y]?.[x] ?? 0;
        if (!pieceType) continue;

        const isKing = pieceType === 3 || pieceType === 4;
        const isRedPiece = RED_PIECES.has(pieceType);
        const centerX = x * this.CELL_SIZE + this.CELL_SIZE / 2;
        const centerY = y * this.CELL_SIZE + this.CELL_SIZE / 2;
        const fillColor = isRedPiece ? '#c0392b' : '#1e1b1b';
        const strokeColor = isRedPiece ? '#ffa07a' : '#d4af37';
        const isSelected = this.selectedPiece?.x === x && this.selectedPiece?.y === y;

        this.ctx.beginPath();
        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = isSelected ? '#ffd700' : strokeColor;
        this.ctx.lineWidth = isSelected ? 6 : 4;
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        if (isKing) {
          this.ctx.fillStyle = '#ffe066';
          this.ctx.font = '24px sans-serif';
          this.ctx.fillText('👑', centerX, centerY);
        }
      }
    }

    this.ctx.restore();
  }

  handleBoardClick(event) {
    if (!this.canvas || !this.gameState || !this.gameState.board) {
      console.warn('Board click ignored: game state not ready');
      return;
    }

    if (!this.gameState.turnColor || !this.myColor) {
      console.warn('Board click ignored: turn state invalid');
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const pixelRatio = window.devicePixelRatio || 1;

    const localX = (event.clientX - rect.left) * scaleX;
    const localY = (event.clientY - rect.top) * (this.canvas.height / rect.height);

    const normalizedX = localX / pixelRatio;
    const normalizedY = localY / pixelRatio;

    const gridX = Math.floor(normalizedX / this.CELL_SIZE);
    const gridY = Math.floor(normalizedY / this.CELL_SIZE);

    if (gridX < 0 || gridY < 0 || gridX >= this.BOARD_SIZE || gridY >= this.BOARD_SIZE) {
      return;
    }

    if (this.gameState.turnColor !== this.myColor) {
      return;
    }

    const pieceAtClick = this.gameState.board[gridY]?.[gridX] ?? 0;
    const isMyPiece =
      (this.myColor === 'red' && RED_PIECES.has(pieceAtClick)) ||
      (this.myColor === 'black' && BLACK_PIECES.has(pieceAtClick));

    if (this.selectedPiece) {
      if (this.selectedPiece.x === gridX && this.selectedPiece.y === gridY) {
        this.selectedPiece = null;
        this.render();
        return;
      }

      const from = {
        row: this.selectedPiece.y,
        col: this.selectedPiece.x,
      };
      const destination = {
        row: gridY,
        col: gridX,
      };

      this.socket?.emit('submitMove', {
        type: 'movePiece',
        payload: {
          from,
          to: destination,
          sequence: [destination],
        },
      });
      this.selectedPiece = null;
      this.render();
      return;
    }

    if (isMyPiece) {
      this.selectedPiece = { x: gridX, y: gridY };
      this.render();
    }
  }

  updateGameState(newGameState) {
    if (!newGameState || typeof newGameState !== 'object') {
      console.error('Invalid game state update received');
      return;
    }

    this.gameState = newGameState;

    if (!this.gameState?.board) {
      this.selectedPiece = null;
    } else if (this.selectedPiece) {
      const { x, y } = this.selectedPiece;
      const piece = this.gameState.board[y]?.[x] ?? 0;
      const stillMyPiece =
        (this.myColor === 'red' && RED_PIECES.has(piece)) ||
        (this.myColor === 'black' && BLACK_PIECES.has(piece));
      if (!stillMyPiece) {
        this.selectedPiece = null;
      }
    }
    this.render();
  }

  showAnnouncement(message) {
    if (!message) return;

    if (!this.rootElement) {
      this.pendingAnnouncement = message;
      return;
    }

    if (!this.announcementElement) {
      this.announcementElement = document.createElement('div');
      this.announcementElement.className = 'checkers-announcement';
      this.rootElement.appendChild(this.announcementElement);
    }

    this.announcementElement.textContent = message;
    this.announcementElement.classList.add('visible');

    if (this.announcementTimeout) {
      clearTimeout(this.announcementTimeout);
    }

    this.announcementTimeout = setTimeout(() => {
      if (this.announcementElement && this.announcementElement.classList) {
        this.announcementElement.classList.remove('visible');
      }
      this.announcementTimeout = null;
    }, 2500);
  }

  destroy() {
    if (this.announcementTimeout) {
      clearTimeout(this.announcementTimeout);
      this.announcementTimeout = null;
    }

    if (this.canvas) {
      this.canvas.removeEventListener('click', this.handleBoardClick);
    }

    if (this.announcementElement?.parentNode) {
      try {
        this.announcementElement.parentNode.removeChild(this.announcementElement);
      } catch (error) {
        console.warn('Failed to remove announcement element:', error);
      }
    }

    if (this.rootElement?.parentNode) {
      try {
        this.rootElement.parentNode.removeChild(this.rootElement);
      } catch (error) {
        console.warn('Failed to remove root element:', error);
      }
    }

    this.rootElement = null;
    this.canvas = null;
    this.ctx = null;
    this.selectedPiece = null;
    this.announcementElement = null;
  }
}
