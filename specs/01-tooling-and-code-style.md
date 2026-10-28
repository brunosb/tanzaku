# Ferramentas e estilo

Node serve ao TypeScript, Biome e CLI Tauri durante o desenvolvimento. O renderer usa ES2022 modules, compilado por `tsconfig.renderer.json`; não utiliza CommonJS, APIs Node ou transformação por expressões regulares.

`npm test` executa check, build, testes do renderer e testes Rust. Verificações adicionais: `node tools/run-cargo.cjs fmt --manifest-path src-tauri/Cargo.toml --check` e `node tools/run-cargo.cjs clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

O Rust está fixado em `rust-toolchain.toml`. Não incluir biblioteca pessoal, MIDIs ou outputs de build no Git.
