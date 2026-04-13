# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working with this repository.

## Repository Overview

**Repository:** `ianlin0126/playground`
**Status:** Freshly initialized — no source files committed yet.

> Update this section as the project takes shape: describe the purpose, tech stack, and architecture here.

---

## Development Workflow

### Branching Strategy

- Work on feature branches: `claude/<feature-name>` or `feature/<feature-name>`
- Never push directly to `main` without explicit permission
- Always use `git push -u origin <branch-name>` when pushing a new branch

### Commit Guidelines

- Write clear, descriptive commit messages focused on *why*, not just *what*
- Keep commits atomic — one logical change per commit
- Include the session URL as a footer in Claude-authored commits:
  ```
  https://claude.ai/code/session_<id>
  ```

### Git Operations

- Stage specific files by name — avoid `git add -A` or `git add .`
- Never skip hooks (`--no-verify`) unless the user explicitly requests it
- Never force-push to `main`/`master`
- Prefer creating new commits over amending existing ones

---

## Code Conventions

> Fill in this section once a language/framework is chosen. Examples to document:
> - Language version and toolchain
> - Formatting rules (indentation, line length, trailing commas)
> - Naming conventions (files, variables, functions, classes)
> - Import ordering
> - Error handling patterns
> - Logging conventions

---

## Project Structure

> Document the directory layout here once the project is scaffolded. Example:
> ```
> src/          # Application source code
> tests/        # Test files, mirroring src/ structure
> docs/         # Documentation
> scripts/      # Build/deploy scripts
> ```

---

## Build, Test, and Run Commands

> Add commands here as the project is set up. Common examples:
>
> ```bash
> # Install dependencies
> npm install          # Node.js
> pip install -r requirements.txt  # Python
>
> # Run the application
> npm start
> python main.py
>
> # Run tests
> npm test
> pytest
>
> # Lint / format
> npm run lint
> ruff check .
> ```

---

## Key Conventions for AI Assistants

### Before Making Changes

- Always read files before editing them
- Understand existing patterns before adding new ones
- Do not introduce new dependencies without discussing them first

### Scope Discipline

- Make only the changes requested — do not refactor surrounding code
- Do not add comments, docstrings, or type annotations to code you didn't change
- Do not add error handling, fallbacks, or validation for scenarios that cannot happen
- Do not create helpers or abstractions for one-time operations

### Security

- Never commit secrets, API keys, or credentials
- Validate input only at system boundaries (user input, external APIs)
- Avoid command injection, SQL injection, XSS, and other OWASP Top 10 vulnerabilities

### Risky Operations — Confirm Before Proceeding

- Deleting files or branches
- Force-pushing
- Modifying CI/CD pipelines
- Pushing to remote repositories
- Any action visible to others or that affects shared state

---

## GitHub Integration

- Repository scope: `ianlin0126/playground` only
- Use MCP GitHub tools (`mcp__github__*`) for all GitHub interactions
- Do NOT create pull requests unless explicitly asked
- Be frugal with comments — only comment when a reply is genuinely necessary

---

## Updating This File

Keep this file current as the project evolves:
- Add the tech stack and architecture description once chosen
- Document build/test/run commands once configured
- Add code conventions once patterns are established
- Record any project-specific gotchas or pitfalls discovered along the way
