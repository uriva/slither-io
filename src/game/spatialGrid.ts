export interface GridItem {
  id: string | number;
  x: number;
  y: number;
  radius: number;
  data?: unknown;
}

export class SpatialGrid<T extends GridItem> {
  private cellSize: number;
  private cells: Map<string, T[]>;

  constructor(cellSize: number = 180) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  public clear(): void {
    this.cells.clear();
  }

  private getKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  public insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = this.getKey(cx, cy);

    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(item);
  }

  public query(x: number, y: number, range: number): T[] {
    const results: T[] = [];
    const minCx = Math.floor((x - range) / this.cellSize);
    const maxCx = Math.floor((x + range) / this.cellSize);
    const minCy = Math.floor((y - range) / this.cellSize);
    const maxCy = Math.floor((y + range) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.getKey(cx, cy);
        const list = this.cells.get(key);
        if (list) {
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const dx = item.x - x;
            const dy = item.y - y;
            if (dx * dx + dy * dy <= (range + item.radius) * (range + item.radius)) {
              results.push(item);
            }
          }
        }
      }
    }
    return results;
  }
}
