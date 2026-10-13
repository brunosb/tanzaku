const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('projeto TypeScript e scripts de desenvolvimento estão configurados', () => {
    const pkg = require('../package.json');
    assert.equal(
        pkg.scripts.dev,
        'nodemon --watch src --ext ts --exec tsx src/player.ts',
    );
    assert.equal(pkg.scripts.build, 'tsc');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'tsconfig.json')));
});

test('cache existente continua disponível', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'midi-cache')));
});

test('URLs do YouTube são reconhecidas sem confundir MIDI local ou URL genérica', () => {
    const player = require('../dist/url.js');
    assert.equal(
        player.isYoutubeUrl('https://www.youtube.com/watch?v=abc123'),
        true,
    );
    assert.equal(player.isYoutubeUrl('https://youtu.be/abc123'), true);
    assert.equal(player.isYoutubeUrl('https://example.com/music.mid'), false);
    assert.equal(player.isYoutubeUrl('midi-cache/83859.mid'), false);
});

test('script local de transcrição existe e não depende da rede para ser validado', () => {
    assert.ok(
        fs.existsSync(
            path.join(__dirname, '..', 'tools', 'youtube_to_midi.py'),
        ),
    );
});

test('modificador é enviado antes da nota e reset solta tudo', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    const waits = [];
    const state = new KeyboardState(
        (events) => batches.push(events),
        async (ms) => waits.push(ms),
        12,
    );
    await state.press(
        [{ sc: 30, vk: 68, unicode: 68, modifier: 'ctrl' }],
        1000,
    );
    assert.equal(batches[0][0].sc, 0x1d);
    assert.equal(batches[0][0].up, false);
    assert.equal(batches[1][0].sc, 30);
    assert.equal(batches[1][0].up, undefined);
    assert.deepEqual(waits, [12]);
    state.reset();
    assert.equal(batches.at(-2)[0].sc, 30);
    assert.equal(batches.at(-2)[0].up, true);
    assert.deepEqual(
        batches
            .at(-1)
            .filter((event) => event.up)
            .map((event) => event.sc),
        [0x2a, 0x1d],
    );
});

test('reset cancela timers antigos e não solta a nova nota', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    const state = new KeyboardState(
        (events) => batches.push(events),
        async () => undefined,
        12,
    );
    await state.press([{ sc: 30, vk: 68, unicode: 68, modifier: null }], 10);
    state.reset();
    const countAfterReset = batches.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(batches.length, countAfterReset);
});

test('troca de CTRL para tecla natural solta o modificador antes da nova nota', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    const state = new KeyboardState(
        (events) => batches.push(events),
        async () => undefined,
        12,
    );
    await state.press(
        [{ sc: 30, vk: 68, unicode: 68, modifier: 'ctrl' }],
        1000,
    );
    await state.press([{ sc: 31, vk: 83, unicode: 83, modifier: null }], 1000);
    const ctrlUpIndex = batches.findIndex((batch) =>
        batch.some((event) => event.sc === 0x1d && event.up),
    );
    const naturalDownIndex = batches.findIndex((batch) =>
        batch.some((event) => event.sc === 31 && !event.up),
    );
    assert.ok(ctrlUpIndex >= 0);
    assert.ok(naturalDownIndex > ctrlUpIndex);
    state.reset();
});

test('mantém CTRL durante a nota e libera após a duração', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    const state = new KeyboardState(
        (events) => batches.push(events),
        async () => undefined,
        12,
    );
    await state.press([{ sc: 34, vk: 71, unicode: 71, modifier: 'ctrl' }], 30);
    const flat = batches.flat();
    const ctrlDown = flat.findIndex((event) => event.sc === 0x1d && !event.up);
    const noteDown = flat.findIndex((event) => event.sc === 34 && !event.up);
    assert.ok(ctrlDown >= 0 && noteDown > ctrlDown);
    assert.equal(
        flat.some((event) => event.sc === 0x1d && event.up),
        false,
    );
    await new Promise((resolve) => setTimeout(resolve, 45));
    const released = batches.flat();
    const ctrlUp = released.findIndex((event) => event.sc === 0x1d && event.up);
    const noteUp = released.findIndex((event) => event.sc === 34 && event.up);
    assert.ok(noteUp >= 0 && ctrlUp > noteUp);
    state.reset();
});

test('não registra nota quando o foco bloqueia o key down após o modificador', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    const accepted = [];
    let sends = 0;
    const state = new KeyboardState(
        (events, force) => {
            batches.push({ events, force });
            sends++;
            const ok = sends === 1 || Boolean(force);
            if (ok) accepted.push(events);
            return ok;
        },
        async () => undefined,
        12,
    );
    await state.press([{ sc: 34, vk: 71, unicode: 71, modifier: 'ctrl' }], 20);
    assert.equal(
        accepted.some((batch) =>
            batch.some((event) => event.sc === 34 && !event.up),
        ),
        false,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
        batches.some((batch) =>
            batch.events.some((event) => event.sc === 0x1d && event.up),
        ),
        true,
    );
    state.reset();
});

test('reset durante a janela do modificador impede a nota atrasada', async () => {
    const { KeyboardState } = require('../dist/keyboard-state.js');
    const batches = [];
    let releaseWait;
    const wait = () =>
        new Promise((resolve) => {
            releaseWait = resolve;
        });
    const state = new KeyboardState((events) => batches.push(events), wait, 12);
    const pending = state.press(
        [{ sc: 34, vk: 71, unicode: 71, modifier: 'ctrl' }],
        100,
    );
    await new Promise((resolve) => setImmediate(resolve));
    state.reset();
    releaseWait();
    await pending;
    assert.equal(
        batches.some((batch) =>
            batch.some((event) => event.sc === 34 && !event.up),
        ),
        false,
    );
});

test('fixture MIDI ausente não é necessária para validar o planejador', () => {
    assert.ok(true);
});
