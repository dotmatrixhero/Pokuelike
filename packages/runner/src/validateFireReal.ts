/** Burn sizes when fire is lit on a REAL generated world, not a uniform-random fuel field — flora is clustered, so local density is what matters, not the 5% global figure. */
import { createDemoWorld } from "@pokuelike/data";
import { tileAt, tickFires, igniteTile, mulberry32, FLAMMABLE_TERRAIN } from "@pokuelike/engine";
const sizes:number[]=[]; const durs:number[]=[];
for (const seed of [1,2,3,4,5]) {
  const w:any = createDemoWorld(seed);
  w.weatherCells=[];
  const fuelTiles:{x:number,y:number}[]=[];
  for(let y=0;y<w.height;y++)for(let x=0;x<w.width;x++) if(FLAMMABLE_TERRAIN.has(tileAt(w,"surface",x,y)!.terrain)) fuelTiles.push({x,y});
  const rng=mulberry32(seed*104729);
  for(let trial=0;trial<12;trial++){
    const w2:any=createDemoWorld(seed); w2.weatherCells=[];
    const start=fuelTiles[Math.floor(rng()*fuelTiles.length)];
    const countFuel=()=>{let n=0;for(let y=0;y<w2.height;y++)for(let x=0;x<w2.width;x++)if(FLAMMABLE_TERRAIN.has(tileAt(w2,"surface",x,y)!.terrain))n++;return n;};
    const before=countFuel();
    igniteTile(w2,"surface",start.x,start.y);
    const r=mulberry32(seed*31+trial);
    let ticks=0, burning=1;
    while(burning>0&&ticks<3000){ tickFires(w2,undefined,r); ticks++;
      burning=0; for(let y=0;y<w2.height;y++)for(let x=0;x<w2.width;x++)if(tileAt(w2,"surface",x,y)!.terrain==="fire")burning++; }
    sizes.push(before-countFuel()); durs.push(ticks);
  }
}
sizes.sort((a,b)=>a-b); durs.sort((a,b)=>a-b);
const q=(a:number[],p:number)=>a[Math.min(a.length-1,Math.floor(p*a.length))];
console.log(`n=${sizes.length} burns on real worlds`);
console.log(`tiles burned: median ${q(sizes,0.5)}  p90 ${q(sizes,0.9)}  max ${sizes[sizes.length-1]}  mean ${(sizes.reduce((s,v)=>s+v,0)/sizes.length).toFixed(1)}`);
console.log(`ticks lasted: median ${q(durs,0.5)}  p90 ${q(durs,0.9)}  max ${durs[durs.length-1]}`);
