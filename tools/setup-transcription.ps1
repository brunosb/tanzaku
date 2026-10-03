$ErrorActionPreference = 'Stop'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv não foi encontrado. Instale o uv antes de executar este script.'
}

uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe yt-dlp basic-pitch 'setuptools<81'
Write-Host 'Dependências de transcrição instaladas em .venv.'
Write-Host 'Valide com: node player.js --check-deps'
