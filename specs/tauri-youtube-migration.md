# Pipeline nativo de YouTube e transcrição

O fluxo distribuído é yt-dlp → FFmpeg mono 22050 Hz → ONNX Runtime/Basic Pitch → decoder Rust → MIDI → biblioteca. Não há backend Python em produção.

Uma operação ativa por processo, identificada por jobId, possui flag de cancelamento e diretório temporário exclusivo. Subprocessos têm saída drenada em paralelo; cancelar encerra a árvore do processo no Windows e aguarda sua saída. A inferência verifica cancelamento entre janelas. Antes da importação, a transação verifica cancelamento e a raiz original.

O ambiente ONNX é único e compartilhado; sessões são criadas por operação. O decoder congela as regras do Basic Pitch 0.4.0: thresholds 0.5/0.3, limiar mínimo de 11 frames, desempate da primeira ativação, corte de frames a 86 FPS e a correção temporal da versão de referência. Bends saturam antes de converter para i16.

As fixtures em test/fixtures são geradas pela versão Python somente no desenvolvimento e são testadas sem Python. O script `tools/fixtures/generate-reference-fixtures.py` exige Basic Pitch 0.4.0. A equivalência dos tensores controlados não substitui uma avaliação musical com gravações reais.
