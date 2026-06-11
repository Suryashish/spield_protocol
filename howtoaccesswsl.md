# How to access WSL (for Stellar CLI work)

The Stellar CLI, Rust, and `cargo` are installed **inside WSL** (Ubuntu 22.04), not on
Windows. So all Soroban/Stellar commands have to be run through WSL. This file documents
exactly how that's done in this project.

## The setup

| Thing | Value |
| --- | --- |
| WSL distro | Ubuntu 22.04 (default) |
| Stellar CLI | `stellar 26.1.0` |
| Rust / cargo | `rustc 1.93.0` / `cargo 1.93.0` |
| Wasm target | `wasm32v1-none` (installed) |

## Path mapping: Windows ⇄ WSL

The Windows `F:` drive is mounted inside WSL at `/mnt/f`. So this project:

```
Windows:  F:\Projects Tech\My own thoughts\spield_revamped\v1
WSL:      /mnt/f/Projects Tech/My own thoughts/spield_revamped/v1
```

The contract project lives at:

```
WSL: /mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract/spield
```

> The path has spaces, so **always quote it** in WSL commands.

## Running commands in WSL

From a Windows shell (PowerShell / cmd / Claude Code), prefix the command with
`wsl -e bash -lic "..."`:

- `wsl` — runs in the default distro (Ubuntu)
- `-e bash` — use bash as the shell
- `-lic` — **l**ogin + **i**nteractive shell, so the user's `~/.bashrc`/profile is sourced
  (this is what puts `stellar`, `cargo`, `rustup` on the `PATH`)

### Pattern

```powershell
wsl -e bash -lic "cd '/mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract/spield' && <command>"
```

### Examples actually used here

Check tooling is present:

```powershell
wsl -e bash -lic "stellar --version && cargo --version"
```

Scaffold the project (run once, from the `contract` folder):

```powershell
wsl -e bash -lic "cd '/mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract' && stellar contract init spield"
```

Build + run the contract tests:

```powershell
wsl -e bash -lic "cd '/mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract/spield' && cargo test"
```

## Common next commands (all run the same way, from inside `contract/spield`)

```powershell
# Compile the contract to WASM
wsl -e bash -lic "cd '/mnt/f/.../contract/spield' && stellar contract build"

# Create a testnet identity (one time)
wsl -e bash -lic "stellar keys generate --global alice --network testnet --fund"

# Deploy to testnet
wsl -e bash -lic "cd '/mnt/f/.../contract/spield' && stellar contract deploy \
  --wasm target/wasm32v1-none/release/hello_world.wasm \
  --source alice --network testnet"
```

## Gotchas

- **Quote the project path** — it contains spaces.
- **Use `-lic`** (login shell) so the Rust/Stellar toolchain is on `PATH`. A plain
  `wsl <cmd>` may not find `stellar` or `cargo`.
- **First build is slow** (~10 min) because the whole Soroban SDK compiles from scratch.
  Later builds are cached and fast. The `target/` dir is gitignored.
- Edit files from **either** side — Windows tools and WSL see the same files via `/mnt/f`.
  (File I/O across `/mnt/f` is a bit slower than native Linux paths, but fine here.)
