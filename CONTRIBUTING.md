# Contributing to Vườn Chung

Thanks for helping out. This guide gets you from clone to pull request.

## Setup

Requirements: Node 24 (see `.nvmrc`) and npm 11.

```bash
git clone https://github.com/pdz1804/vuon-chung.git
cd vuon-chung
npm ci          # also installs the git hooks via the "prepare" script
npm run dev     # http://localhost:5240
```

Playwright uses your installed Chrome locally. Without Chrome, run `npx playwright install chromium`
and set `CI=true` so the bundled Chromium is used instead.

## Scripts

| Script                  | What it does                                               |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Vite dev server on port 5240                               |
| `npm run build`         | Typecheck, then production build into `dist/`              |
| `npm run lint`          | ESLint (type-aware for `src/`)                             |
| `npm run format`        | Prettier, write                                            |
| `npm run format:check`  | Prettier, check only                                       |
| `npm run typecheck`     | `tsc --noEmit`                                             |
| `npm test`              | Vitest unit tests                                          |
| `npm run test:coverage` | Vitest with a V8 coverage report                           |
| `npm run test:e2e`      | Playwright end-to-end tests (desktop and phone viewports)  |
| `npm run check`         | format:check, lint, typecheck, unit tests and build in one |

Run `npm run check` before opening a pull request, and `npm run test:e2e` when you touched gameplay or UI.

## Git hooks

Husky installs three hooks on `npm ci`:

- `pre-commit`: lint-staged runs `eslint --fix` and `prettier --write` on staged files.
- `commit-msg`: commitlint enforces the commit convention below.
- `pre-push`: typecheck and unit tests.

Please do not bypass them with `--no-verify`; CI runs the same gates.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, with types such as
`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`. Keep the subject short and imperative, and wrap
body lines at 100 characters.

```text
feat(sim): regrow strawberries after the first harvest
```

## Testing the slow-growing parts

Crops take real hours to grow. Two dev hooks make that testable:

- **Dev clock**: add `?speed=3600` to the URL (`http://localhost:5240/?speed=3600`) and one real second
  counts as one game hour. The dev clock uses its own save slot, so your real farm is untouched.
- **`#qa` hook**: with `#qa` in the URL (for example `/?speed=3600#qa`) the game exposes
  `window.__qa = { scene, farm() }` so tests can teleport the farmer and read the farm state. The
  Playwright specs in `tests/e2e` use it.

## Where to put code

- Game rules go in `src/sim` as pure functions that take `now` as an argument, with unit tests next to them.
- Phaser rendering and input go in `src/game`; the DOM overlay in `src/ui`; user-facing strings in
  `src/i18n.ts` (add both `vi` and `en`).
- See [docs/architecture.md](docs/architecture.md) for the full picture.

## Pull requests

Fork, branch from `main`, keep the change focused, and fill in the pull request template. CI must be green.
By contributing you agree your work is released under the [MIT license](LICENSE), and you agree to follow
the [Code of Conduct](CODE_OF_CONDUCT.md).
