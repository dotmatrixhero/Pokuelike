/** What the named map actually looks like — territory count, size spread, and a sample of names. */
import { generateMacroGrid } from "@pokuelike/engine";
for (const seed of [1, 42, 24757]) {
  const grid = generateMacroGrid(seed, 64, 64);
  const ts = grid.territories ?? [];
  const sizes = ts.map((t) => t.zoneIndices.length).sort((a, b) => b - a);
  const land = grid.zones.filter((z) => !z.isOcean).length;
  const named = sizes.reduce((s, v) => s + v, 0);
  console.log(`\nseed ${seed}: ${ts.length} named territories over ${land} land zones (${(100*named/Math.max(1,land)).toFixed(0)}% named)`);
  console.log(`  sizes: largest ${sizes.slice(0,5).join(", ")} ... smallest ${sizes.slice(-3).join(", ")}`);
  console.log(`  ${ts.slice().sort((a,b)=>b.zoneIndices.length-a.zoneIndices.length).slice(0,10).map(t=>`${t.name} (${t.biome}, ${t.zoneIndices.length})`).join("\n  ")}`);
}
