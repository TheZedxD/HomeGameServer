export class CheckersScene extends Phaser.Scene {
  constructor(config) {
    super({ key: 'CheckersScene' });
    this.socket = config.socket;
    this.myColor = config.myColor;
    this.gameState = config.gameState;
    this.pieceSprites = null;
    this.selectedPiece = null;
    this.BOARD_SIZE = 8;
    this.CELL_SIZE = 80;
    this.pendingAnnouncement = config.roundMessage || null;
  }

  create() {
    this.pieceSprites = this.add.group();
    this.drawBoard();
    this.renderPieces();
    this.input.on('pointerdown', this.handleBoardClick, this);
    if (this.pendingAnnouncement) {
      this.showAnnouncement(this.pendingAnnouncement);
      this.pendingAnnouncement = null;
    }
  }

  drawBoard() {
    const lightSquareColor = 0xc9d6a3;
    const darkSquareColor = 0x0a4f0a;
    for (let y = 0; y < this.BOARD_SIZE; y++) {
      for (let x = 0; x < this.BOARD_SIZE; x++) {
        const color = (x + y) % 2 === 0 ? lightSquareColor : darkSquareColor;
        this.add
          .rectangle(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE, color)
          .setOrigin(0, 0);
      }
    }
  }

  updateGameState(newGameState) {
    this.gameState = newGameState;
    this.renderPieces();
  }

  renderPieces() {
    this.pieceSprites.clear(true, true);
    if (!this.gameState || !this.gameState.board) return;
    for (let y = 0; y < this.BOARD_SIZE; y++) {
      for (let x = 0; x < this.BOARD_SIZE; x++) {
        const pieceType = this.gameState.board[y][x];
        if (pieceType !== 0) {
          const isKing = pieceType === 3 || pieceType === 4;
          const isRedPiece = [1, 3].includes(pieceType);
          const pieceColor = isRedPiece ? 0xc0392b : 0x1e1b1b;
          const strokeColor = isRedPiece ? 0xffa07a : 0xd4af37;
          const pieceSprite = this.add.container(
            x * this.CELL_SIZE + this.CELL_SIZE / 2,
            y * this.CELL_SIZE + this.CELL_SIZE / 2
          );
          const circle = this.add
            .circle(0, 0, this.CELL_SIZE / 2 - 8, pieceColor)
            .setStrokeStyle(4, strokeColor);
          pieceSprite.add(circle);
          if (isKing) {
            pieceSprite.add(this.add.text(0, 0, '👑', { fontSize: '24px', color: '#ffe066' }).setOrigin(0.5));
          }
          pieceSprite.setData({ gridX: x, gridY: y });
          this.pieceSprites.add(pieceSprite);
        }
      }
    }
  }

  handleBoardClick(pointer) {
    const gridX = Math.floor(pointer.x / this.CELL_SIZE);
    const gridY = Math.floor(pointer.y / this.CELL_SIZE);

    if (gridX < 0 || gridY < 0 || gridX >= this.BOARD_SIZE || gridY >= this.BOARD_SIZE) {
      return;
    }

    if (!this.gameState || this.gameState.turn !== this.myColor) return;

    const pieceAtClick = this.gameState.board[gridY][gridX];
    const isMyPiece =
      (this.myColor === 'red' && [1, 3].includes(pieceAtClick)) ||
      (this.myColor === 'black' && [2, 4].includes(pieceAtClick));

    if (this.selectedPiece) {
      const from = { x: this.selectedPiece.x, y: this.selectedPiece.y };
      const to = { x: gridX, y: gridY };
      this.socket.emit('movePiece', { from, to });
      this.selectedPiece.sprite.list[0].setStrokeStyle(4, this.selectedPiece.originalStroke);
      this.selectedPiece = null;
    } else if (isMyPiece) {
      const sprite = this.pieceSprites
        .getChildren()
        .find((p) => p.data.get('gridX') === gridX && p.data.get('gridY') === gridY);
      if (sprite) {
        const circle = sprite.list[0];
        this.selectedPiece = { x: gridX, y: gridY, sprite, originalStroke: circle.strokeColor };
        circle.setStrokeStyle(6, 0xffd700);
      }
    }
  }

  showAnnouncement(message) {
    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;
    const announceText = this.add
      .text(centerX, centerY, message, {
        fontSize: '48px',
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center'
      })
      .setOrigin(0.5);
    announceText.setStroke('#000000', 8);
    this.tweens.add({
      targets: announceText,
      alpha: 0,
      duration: 1500,
      delay: 1000,
      onComplete: () => announceText.destroy()
    });
  }
}
