# Pokuelike

A Pokémon-flavored roguelike: living ecosystems of need-driven Pokémon
(herding, hunting, foraging) plus a grid-tactical combat system where moves
are spec'able area shapes. See [DESIGN.md](./DESIGN.md) for the full pitch
and architecture, [TODO.md](./TODO.md) for open design questions.

The original C++/libtcod prototype is archived at
[`legacy-cpp/`](./legacy-cpp/) — this is a from-scratch rewrite in
TypeScript.

## Development

pnpm workspace monorepo:

- `packages/engine` — headless simulation core
- `packages/data` — species/move definitions
- `packages/web` — Vite browser app (canvas renderer)

```sh
pnpm install
pnpm dev          # runs packages/web on http://localhost:5173
pnpm test         # runs engine tests
pnpm typecheck    # typechecks all packages
```

Sprite art isn't checked in (bring your own into
`packages/web/public/sprites/<spriteKey>.png`) — agents render as colored
placeholders until then.
