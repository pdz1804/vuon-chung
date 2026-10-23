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

| Script                  | What it does                                                              |
| ----------------------- | ------------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server on port 5240                                              |
| `npm run build`         | Typecheck, then production build into `dist/`                             |
| `npm run lint`          | ESLint (type-aware for `src/`)                                            |
| `npm run format`        | Prettier, write                                                           |
| `npm run format:check`  | Prettier, check only                                                      |
| `npm run typecheck`     | `tsc --noEmit`                                                            |
| `npm test`              | Vitest unit tests                                                         |
| `npm run test:coverage` | Vitest with a V8 coverage report                                          |
| `npm run test:e2e`      | Playwright end-to-end tests (desktop, phone and shared)                   |
| `npm run test:rules`    | Firestore security rules on the emulator (needs Java)                     |
| `npm run test:shared`   | Two-player e2e on the Auth, Firestore and Database emulators (needs Java) |
| `npm run check`         | format:check, lint, typecheck, unit tests and build in one                |

Run `npm run check` before opening a pull request, and the Playwright suites when you touched gameplay or UI.
`npm run test:e2e` also runs the `shared` project, which expects the Firebase emulators; without Java use
`npx playwright test --project desktop --project phone`, which is what the CI `e2e` job runs. Changes to
`firestore.rules` or `database.rules.json` need `npm run test:rules` (and `npm run test:shared` for presence).

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

Crops take real hours to grow, and the default dev server opens the sign-in lobby. Dev hooks for solo play:

- **Solo farm**: `?local=1` runs a solo farm in `localStorage` on the real clock, with no Firebase.
- **Dev clock**: add `?speed=3600` (`http://localhost:5240/?speed=3600`) and one real second counts as one
  game hour. Any speed other than 1 is solo mode and uses its own save slot, so your real farm is untouched.
- **`#qa` hook**: with `#qa` in the URL (for example `/?speed=3600#qa`) the game exposes
  `window.__qa = { scene, farm(), partners }` so tests can teleport the farmer and read or edit the farm state.
  The Playwright specs in `tests/e2e` use it.
- **Emulators**: `?emu=1` points the shared mode at the local Auth, Firestore and Database emulators and shows a
  test login. `npm run test:shared` starts them for you.

## Where to put code

- Game rules go in `src/sim` as pure functions that take `now` (and the acting `uid`) as arguments, with unit tests
  next to them. Never read the clock or touch Firebase there.
- Anything that talks to Firebase goes in `src/net`. Rule changes need a matching test in `tests/rules`.
- Phaser rendering and input go in `src/game`; the DOM overlay in `src/ui`; user-facing strings in
  `src/i18n.ts` (add both `vi` and `en`).
- See [docs/architecture.md](docs/architecture.md) for the full picture and [docs/game-design.md](docs/game-design.md)
  for the rules and numbers.

## Pull requests

Fork, branch from `main`, keep the change focused, and fill in the pull request template. CI must be green.
By contributing you agree your work is released under the [MIT license](LICENSE), and you agree to follow
the [Code of Conduct](CODE_OF_CONDUCT.md).
