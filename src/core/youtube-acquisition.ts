import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Midi } from '@tonejs/midi';

export type YoutubeProgress = {
    stage: string;
    percent?: number;
};

export type YoutubeMidi = {
    title: string;
    sourceUrl: string;
    buffer: Buffer;
};

type CommandResult = { stdout: string; stderr: string };

const installCommand =
    'uv venv --python 3.11 .venv; uv pip install --python .venv\\Scripts\\python.exe yt-dlp basic-pitch "setuptools<81"';

function projectRoot(): string {
    return path.resolve(__dirname, '..', '..');
}

function runCommand(
    command: string,
    args: string[],
    onOutput?: (chunk: string) => void,
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            onOutput?.(text);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            onOutput?.(text);
        });
        child.once('error', (error) =>
            reject(
                Object.assign(new Error(`${command}: ${error.message}`), {
                    code: (error as NodeJS.ErrnoException).code,
                }),
            ),
        );
        child.once('close', (code) =>
            code === 0
                ? resolve({ stdout, stderr })
                : reject(
                      new Error(
                          `${command} terminou com código ${code}. ${stderr.trim() || stdout.trim()}`,
                      ),
                  ),
        );
    });
}

async function pythonCommand(
    args: string[],
    onOutput?: (chunk: string) => void,
): Promise<CommandResult> {
    const virtualEnvPython = path.join(
        projectRoot(),
        '.venv',
        'Scripts',
        'python.exe',
    );
    const candidates = [virtualEnvPython, 'python', 'python3'].filter(
        (command, index) => (index === 0 ? fs.existsSync(command) : true),
    );
    let lastError: unknown;
    for (const command of candidates) {
        try {
            return await runCommand(command, args, onOutput);
        } catch (error) {
            lastError = error;
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error('Python não encontrado.');
}

function isPlaylistUrl(source: string): boolean {
    try {
        const url = new URL(source);
        return (
            /\/playlist$/i.test(url.pathname) || url.searchParams.has('list')
        );
    } catch {
        return false;
    }
}

function dependencyError(error: unknown, dependency: string): Error {
    const message = error instanceof Error ? error.message : String(error);
    const missingBasicPitch =
        dependency === 'Basic Pitch' &&
        /Basic Pitch não está instalado|No module named.*basic_pitch/i.test(
            message,
        );
    if (missingBasicPitch || /No module named|not found|ENOENT/i.test(message))
        return new Error(
            `${dependency} não está instalado. Execute: ${installCommand}`,
        );
    return new Error(message);
}

async function findAudio(directory: string): Promise<string | null> {
    const files = await readdir(directory);
    const audio = files.find((file) =>
        ['.webm', '.m4a', '.mp4', '.opus', '.wav'].some((extension) =>
            file.toLowerCase().endsWith(extension),
        ),
    );
    return audio ? path.join(directory, audio) : null;
}

export async function transcribeYoutube(
    sourceUrl: string,
    onProgress?: (progress: YoutubeProgress) => void,
): Promise<YoutubeMidi> {
    if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(sourceUrl))
        throw new Error('Informe uma URL válida do YouTube.');
    if (isPlaylistUrl(sourceUrl))
        throw new Error(
            'URLs de playlist não são suportadas; informe a URL de um vídeo individual.',
        );

    const script = path.join(projectRoot(), 'tools', 'youtube_to_midi.py');
    if (!fs.existsSync(script))
        throw new Error(`Script de transcrição não encontrado: ${script}`);
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'tanzaku-'));
    try {
        onProgress?.({ stage: 'Obtendo informações do vídeo', percent: 0 });
        let title = 'Música do YouTube';
        try {
            const metadata = await pythonCommand([
                '-m',
                'yt_dlp',
                '--no-playlist',
                '--print',
                '%(title)s',
                '--skip-download',
                sourceUrl,
            ]);
            title =
                metadata.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
                title;
        } catch (error) {
            throw dependencyError(error, 'yt-dlp');
        }

        onProgress?.({ stage: 'Baixando áudio', percent: 0 });
        try {
            await pythonCommand(
                [
                    '-m',
                    'yt_dlp',
                    '--no-playlist',
                    '--no-warnings',
                    '--newline',
                    '-f',
                    'bestaudio/best',
                    '-o',
                    path.join(temporary, 'audio.%(ext)s'),
                    sourceUrl,
                ],
                (chunk) => {
                    const match = chunk.match(
                        /\[download\]\s+(\d+(?:\.\d+)?)%/,
                    );
                    if (match)
                        onProgress?.({
                            stage: 'Baixando áudio',
                            percent: Math.min(100, Number(match[1])),
                        });
                },
            );
        } catch (error) {
            throw dependencyError(error, 'yt-dlp');
        }

        const sourceAudio = await findAudio(temporary);
        if (!sourceAudio)
            throw new Error(
                'O vídeo não forneceu uma faixa de áudio compatível.',
            );

        const wav = path.join(temporary, 'audio.wav');
        onProgress?.({ stage: 'Convertendo para WAV', percent: 0 });
        try {
            await runCommand('ffmpeg', [
                '-y',
                '-i',
                sourceAudio,
                '-vn',
                '-ac',
                '1',
                '-ar',
                '22050',
                wav,
            ]);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            if (/ENOENT|not found/i.test(message))
                throw new Error(
                    'FFmpeg não está instalado ou não está no PATH.',
                );
            throw new Error(`Falha ao converter o áudio para WAV: ${message}`);
        }

        const midi = path.join(temporary, 'transcribed.mid');
        onProgress?.({ stage: 'Transcrevendo para MIDI', percent: 0 });
        try {
            await pythonCommand([script, wav, midi]);
        } catch (error) {
            throw dependencyError(error, 'Basic Pitch');
        }
        if (!fs.existsSync(midi) || fs.statSync(midi).size === 0)
            throw new Error('A transcrição não produziu um arquivo MIDI.');
        const buffer = fs.readFileSync(midi);
        const parsed = new Midi(buffer);
        if (!parsed.tracks.some((track) => track.notes.length))
            throw new Error(
                'A transcrição não encontrou notas musicais no áudio.',
            );
        onProgress?.({ stage: 'Concluído', percent: 100 });
        return { title, sourceUrl, buffer };
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
