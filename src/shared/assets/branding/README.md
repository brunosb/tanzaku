# Marca do Tanzaku

`tanzaku.png` é a arte original, com transparência, preservada sem alterações.
`tanzaku-512.png` é a versão usada na interface e `favicon.png` é a versão de 32 px.
O ícone do Windows fica em `src-tauri/icons/icon.ico`, com resoluções de 16, 24, 32, 48, 64 e 256 px. A configuração Tauri usa esse arquivo para o aplicativo, o instalador e o desinstalador NSIS.

Para regenerar os arquivos a partir da raiz do projeto, usando PowerShell e a CLI já instalada:

```powershell
node node_modules/@tauri-apps/cli/tauri.js icon src/shared/assets/branding/tanzaku.png --output src-tauri/target/branding-icons
Copy-Item -LiteralPath src-tauri/target/branding-icons/icon.png -Destination src/shared/assets/branding/tanzaku-512.png
Copy-Item -LiteralPath src-tauri/target/branding-icons/32x32.png -Destination src/shared/assets/branding/favicon.png
Copy-Item -LiteralPath src-tauri/target/branding-icons/icon.ico -Destination src-tauri/icons/icon.ico
```

As versões menores mantêm a arte completa e o canal alfa do original. Os demais arquivos gerados pela CLI permanecem na pasta de build e não são distribuídos.
