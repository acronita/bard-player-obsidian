# Bard Player — project instructions

Obsidian plugin that embeds YouTube Music (reference: Pear Desktop). See `docs/PLAN.md` and `docs/SPIKE.md`.

## Testing

- **Never create test vaults or launch separate Obsidian instances** (`--user-data-dir`, custom
  `APPDATA`, `--remote-debugging-port`, CDP harnesses). Verify with `npm run build`, `npm run lint`
  and `npm test`, then give Lucas a short manual checklist; he tests in his own Obsidian
  (`npm run build` copies to the vault set in `.env.local` → `OBSIDIAN_PLUGIN_DIR`).
- Lucas keeps one test vault of his own for sign-in testing (`npm run build:test` →
  `OBSIDIAN_TEST_PLUGIN_DIR`; it signs in through the `persist:bard-player-test` partition). He opens
  it himself; never launch it.

## Git

- Git Flow: `main` (releases) and `develop` (integration); work on `feature/*`, `fix/*`, `chore/*`
  off `develop`.
