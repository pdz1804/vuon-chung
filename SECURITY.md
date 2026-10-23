# Security policy

## Supported versions

Vườn Chung is pre-1.0. Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub private reporting instead:
[Report a vulnerability](https://github.com/pdz1804/vuon-chung/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. You can expect an
acknowledgement within a few days and a fix or mitigation plan once the report is confirmed.

## Scope notes

- The game currently runs entirely in the browser and stores its save in `localStorage`; there is no
  server and no account system yet.
- When Firebase sync lands (see the roadmap in the README), access rules, invite codes and
  authentication will be in scope.
- Never commit secrets. A gitleaks scan runs on every push and pull request.
