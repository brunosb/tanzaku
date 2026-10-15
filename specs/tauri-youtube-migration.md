# Migração do YouTube para Tauri/Rust

## Situação atual

O Electron executa este pipeline:

1. `yt-dlp` obtém o título e baixa o áudio.
2. `ffmpeg` converte o áudio para WAV mono em 22050 Hz.
3. Python/Basic Pitch executa o modelo e grava o MIDI.
4. O Electron importa o MIDI produzido para a biblioteca.

O Tauri ainda não chama esse fluxo. O bundle Tauri não deve depender de Python,
uv, FFmpeg ou instalações globais do usuário.

## Estratégia escolhida

Migrar a transcrição para o backend Rust em três fatias:

1. **Inferência ONNX**: incluir o `nmp.onnx` do Basic Pitch como recurso do
   aplicativo e executar o modelo com um runtime ONNX nativo.
2. **Decodificação MIDI**: portar o pré-processamento de áudio e o algoritmo de
   `note_creation.py`, preservando thresholds, duração mínima e tempo usados
   atualmente.
3. **Aquisição de áudio**: substituir a chamada Python/FFmpeg por uma solução
   distribuível. A primeira alternativa é um componente de download empacotado;
   a transcrição não deve voltar a procurar Python no PATH.

## Critérios de aceitação

- O Electron continua usando o pipeline atual durante a migração.
- O Tauri recebe uma URL individual e retorna título, progresso e MIDI.
- Uma mesma entrada WAV produz notas equivalentes nos dois backends dentro de
  uma tolerância documentada de tempo e pitch.
- O instalador Tauri funciona sem Python, uv ou Rust instalados.
- O modelo e componentes nativos são versionados ou obtidos em uma etapa de
  build reproduzível, nunca baixados silenciosamente durante a execução.

## Próxima implementação

Criar um comando Rust de diagnóstico que carrega o modelo ONNX, informa seus
nomes/formas de entrada e saída e valida o recurso empacotado. Depois disso,
portar o pré-processamento e adicionar um teste dourado com um WAV curto.
