# git-stash-manager

> Interactive TUI for browsing, previewing, and managing git stashes. Zero external dependencies.

```
╭─ Stashes ────────────────────────────╮╭─ Preview: stash@{0} ─────────────────────────╮
│ [0] main    2f  wip: auth refactor   ││ diff --git a/src/auth.ts b/src/auth.ts        │
│ [1] feat    5f  wip: dashboard UI    ││ index 3f4a1b2..8c9d0e1 100644                 │
│ [2] main    1f  quick fix attempt    ││ --- a/src/auth.ts                              │
│                                      ││ +++ b/src/auth.ts                              │
│                                      ││ @@ -14,7 +14,12 @@ export class AuthService {  │
│                                      ││ -  async login(user: string) {                 │
│                                      ││ +  async login(user: string, opts = {}) {      │
│                                      ││ +    const token = await this.issueToken(user) │
│                                      ││ +    return token                              │
│                                      ││                                                │
╰──────────────────────────────────────╯╰────────────────────────────────────────────────╯
 ↑↓  navigate   p  preview   a  apply   d  drop   s  save   b  branch   ?  help   q  quit
```

## Features

- **Interactive TUI** — full-screen split-pane interface
- **Stash list** — index, branch, file count, relative time, message
- **Live diff preview** — colorized additions/deletions/hunks, scrollable
- **File status overlay** — A/M/D/R file list per stash
- **Apply** — apply stash and keep it in the list
- **Drop** — delete stash with confirmation prompt
- **Save** — create new stash with optional message
- **Branch** — apply stash to a new branch (checkout -b)
- **Non-interactive CLI** — `list`, `show`, `apply`, `drop`, `push` subcommands
- **Zero external dependencies** — built-in Node.js modules only
- **Graceful fallback** — clear error message if not in a git repo

## Install

```bash
# Global install via npm
npm install -g git-stash-manager

# Or run directly with npx
npx git-stash-manager
```

**Requirements:** Node.js >= 18, Git

## Usage

### Interactive TUI

```bash
gsm
# or
git-stash-manager
```

### Non-interactive Commands

```bash
# List all stashes
gsm list

# Show diff for stash n
gsm show 0

# Apply stash n (keep it)
gsm apply 2

# Drop stash n
gsm drop 1

# Create a new stash
gsm push
gsm push --message "WIP: auth refactor"
gsm push -m "WIP: auth refactor"
```

## TUI Key Bindings

| Key | Action |
|-----|--------|
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `PgUp` | Scroll diff preview up |
| `PgDn` | Scroll diff preview down |
| `p` | Reset diff scroll / preview focus |
| `a` | Apply selected stash (keep it) |
| `d` | Drop / delete selected stash (with confirmation) |
| `s` | Save new stash (prompts for message) |
| `b` | Apply stash to a new branch (prompts for branch name) |
| `?` | Toggle help overlay |
| `q` | Quit |
| `Ctrl+C` | Force quit |

## Diff Color Coding

| Color | Meaning |
|-------|---------|
| Green | Added lines (`+`) |
| Red | Removed lines (`-`) |
| Cyan | Hunk headers (`@@`) |
| Blue | File diff headers |
| Dim | Context lines |

## File Status Indicators

| Symbol | Meaning |
|--------|---------|
| `A` | Added |
| `M` | Modified |
| `D` | Deleted |
| `R` | Renamed |

## Security

- Zero external dependencies — no supply chain risk
- Uses `execFileSync` / `spawnSync` only — no shell injection surface
- No network access — 100% local git operations

## License

MIT
