# Auraxis CLI Development Guide

## Boundaries

- This project is pure Node.js.
- Do not add Electron, Chromium, IPC or desktop runtime dependencies.
- `@auraxis/core` contains all agent logic and must never import `ink`, React or CLI UI code.
- `@auraxis/cli` is the terminal surface and must not contain Agent engine logic.

## Commands

```bash
npm run typecheck
npm run test
npm run build
npm run e2e
npm run check
```

## Code Style

- TypeScript strict mode is enabled.
- Use `node:` prefixed builtin imports.
- Files use `.ts` / `.tsx`; imports use explicit `.js` extensions for NodeNext compatibility.
- Add tests for every engine or CLI behavior.
- Never print API keys or secrets to stdout.

## Tooling Rules

- The CLI build uses `esbuild`; `ink`, React and `fast-glob` stay external.
- Interactive mode requires a TTY; non-TTY must use `--run`.
- Permissions default to `ask`; do not silently auto-approve in interactive mode.
