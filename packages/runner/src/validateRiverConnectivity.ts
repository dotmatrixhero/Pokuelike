/**
 * Measures whether generated rivers are 4-connected channels or a diagonal
 * lattice — direct report: "You have the shitty lattice rivers."
 *
 * Two numbers, both of which should be ~0 on a healthy map:
 *   * `diagonalOnlyWater` — water tiles with no orthogonal water neighbour.
 *     A swimmer cannot traverse these; they are a chain that only touches at
 *     its corners.
 *   * `enclosedLand` — land tiles with water on all four sides. These are the
 *     holes in the lattice, and each one is a tile a walker can be stranded on.
 *
 * Usage:
 *   pnpm --filter @pokuelike/runner exec tsx <path>/validateRiverConnectivity.ts [seeds...]
 */
import { createDemoWorld } from "@pokuelike/data";

const seeds = process.argv.slice(2).map(Number);
const useSeeds = seeds.length > 0 ? seeds : [1, 7, 42, 99, 123, 404, 777, 2024];

let totalDiag = 0;
let totalEnclosed = 0;
let totalWater = 0;

console.log("seed     water  diagonalOnlyWater  enclosedLand");
for (const seed of useSeeds) {
  const world = createDemoWorld(seed);
  const { width, height } = world;
  const tiles = world.tiles.surface;
  const isWater = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && tiles[y * width + x]!.terrain === "water";

  let water = 0;
  let diagonalOnly = 0;
  let enclosed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const orthogonal = [isWater(x, y - 1), isWater(x, y + 1), isWater(x - 1, y), isWater(x + 1, y)].filter(Boolean).length;
      if (isWater(x, y)) {
        water++;
        const diagonal = [isWater(x - 1, y - 1), isWater(x + 1, y - 1), isWater(x - 1, y + 1), isWater(x + 1, y + 1)].filter(Boolean).length;
        if (orthogonal === 0 && diagonal > 0) diagonalOnly++;
      } else if (orthogonal === 4) {
        enclosed++;
      }
    }
  }
  totalWater += water;
  totalDiag += diagonalOnly;
  totalEnclosed += enclosed;
  console.log(`${String(seed).padEnd(8)} ${String(water).padStart(5)}  ${String(diagonalOnly).padStart(17)}  ${String(enclosed).padStart(12)}`);
}

console.log(`\n${useSeeds.length} seeds: ${totalWater} water tiles, ${totalDiag} diagonal-only, ${totalEnclosed} enclosed land`);
