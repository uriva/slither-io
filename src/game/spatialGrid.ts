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
    // Return arrays to pool to avoid GC thrashing
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

  private getKey(cx: number, cy: number): number {
    return (((cx + 4000) & 0xffff) << 16) | ((cy + 4000) & 0xffff);
  }

  public insert(item: T): void {
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
    const rSq = range * range;

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
}
