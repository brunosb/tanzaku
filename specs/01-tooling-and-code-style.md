# Ferramentas e estilo

Node 22.12+ serve ao TypeScript, Vite, Vitest, Biome e CLI Tauri durante o desenvolvimento. O renderer usa React/TSX, shadcn/ui e Tailwind CSS 4. Vite gera ES modules e assets locais diretamente em `dist-tauri`, com base relativa; não utiliza APIs Node na interface. `tsconfig.renderer.json` verifica os tipos sem emitir arquivos.

`npm test` executa Biome, verificação TypeScript, Vitest/Testing Library e testes Rust. `npm run build:ui` verifica os tipos e gera o bundle. Verificações adicionais: `node tools/run-cargo.cjs fmt --manifest-path src-tauri/Cargo.toml --check` e `node tools/run-cargo.cjs clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

O Rust está fixado em `rust-toolchain.toml`. Não incluir biblioteca pessoal, MIDIs ou outputs de build no Git.
