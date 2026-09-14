export interface GridItem {
  id: string | number;
  x: number;
  y: number;
  radius: number;
  data?: unknown;
}

export class SpatialGrid<T extends GridItem> {
  private cellSize: number;
  private cells: Map<number, T[]>;
  private pool: T[][] = [];
  private activeLists: T[][] = [];

  constructor(cellSize: number = 180) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  public clear(): void {
    for (let i = 0; i < this.activeLists.length; i++) {
      const list = this.activeLists[i];
      list.length = 0;
      if (this.pool.length < 500) {
        this.pool.push(list);
      }
    }
    this.activeLists.length = 0;
    this.cells.clear();
  }

  public getKey(cx: number, cy: number): number {
    return (((cx + 4000) & 0xffff) << 16) | ((cy + 4000) & 0xffff);
  }

  public insert(item: T): number {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = this.getKey(cx, cy);

    let list = this.cells.get(key);
    if (!list) {
      list = this.pool.pop() || [];
      this.cells.set(key, list);
      this.activeLists.push(list);
    }
    list.push(item);
    return key;
  }

  public remove(item: T, key?: number): void {
    const cellKey = key !== undefined ? key : this.getKey(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    const list = this.cells.get(cellKey);
    if (list) {
      const idx = list.indexOf(item);
      if (idx !== -1) {
        const last = list.pop()!;
        if (idx < list.length) {
          list[idx] = last;
        }
      }
    }
  }

  public hasObstacle(x: number, y: number, range: number, excludeSnakeId: string): boolean {
    const minCx = Math.floor((x - range) / this.cellSize);
    const maxCx = Math.floor((x + range) / this.cellSize);
    const minCy = Math.floor((y - range) / this.cellSize);
    const maxCy = Math.floor((y + range) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.getKey(cx, cy);
        const list = this.cells.get(key);
        if (list) {
          const len = list.length;
          for (let i = 0; i < len; i++) {
            const item = list[i] as unknown as { snakeId?: string; radius: number; x: number; y: number };
            if (item.snakeId !== excludeSnakeId) {
              const dx = item.x - x;
              const dy = item.y - y;
              const totalR = range + item.radius;
              if (dx * dx + dy * dy <= totalR * totalR) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }

  public query(x: number, y: number, range: number): T[] {
    const results: T[] = [];
    this.queryInto(x, y, range, results);
    return results;
  }

  public queryInto(x: number, y: number, range: number, outResults: T[]): void {
    const minCx = Math.floor((x - range) / this.cellSize);
    const maxCx = Math.floor((x + range) / this.cellSize);
    const minCy = Math.floor((y - range) / this.cellSize);
    const maxCy = Math.floor((y + range) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.getKey(cx, cy);
        const list = this.cells.get(key);
        if (list) {
          const len = list.length;
          for (let i = 0; i < len; i++) {
            const item = list[i];
            const dx = item.x - x;
            const dy = item.y - y;
            const totalR = range + item.radius;
            if (dx * dx + dy * dy <= totalR * totalR) {
              outResults.push(item);
            }
          }
        }
      }
    }
  }

  public queryRectInto(left: number, right: number, top: number, bottom: number, outResults: T[]): void {
    const minCx = Math.floor(left / this.cellSize);
    const maxCx = Math.floor(right / this.cellSize);
    const minCy = Math.floor(top / this.cellSize);
    const maxCy = Math.floor(bottom / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.getKey(cx, cy);
        const list = this.cells.get(key);
        if (list) {
          const len = list.length;
          for (let i = 0; i < len; i++) {
            const item = list[i];
            if (
              item.x >= left - item.radius &&
              item.x <= right + item.radius &&
              item.y >= top - item.radius &&
              item.y <= bottom + item.radius
            ) {
              outResults.push(item);
            }
          }
        }
      }
    }
  }
}
