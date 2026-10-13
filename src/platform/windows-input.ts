import type { KeyboardEvent } from '../core/keyboard-state';

export type WindowsKeyboard = {
    dry: boolean;
    arm(): boolean;
    send(events: KeyboardEvent[], force?: boolean): boolean;
    reset(): void;
};

const SCAN: Record<string, number> = {
    Q: 0x10,
    W: 0x11,
    E: 0x12,
    R: 0x13,
    T: 0x14,
    Y: 0x15,
    U: 0x16,
    A: 0x1e,
    S: 0x1f,
    D: 0x20,
    F: 0x21,
    G: 0x22,
    H: 0x23,
    J: 0x24,
    Z: 0x2c,
    X: 0x2d,
    C: 0x2e,
    V: 0x2f,
    B: 0x30,
    N: 0x31,
    M: 0x32,
};

export function createWindowsKeyboard(dry = false): WindowsKeyboard {
    if (dry || process.platform !== 'win32')
        return {
            dry: true,
            arm: () => true,
            send: () => true,
            reset: () => undefined,
        };
    if (process.arch !== 'x64')
        throw new Error('O player Windows requer Node x64.');

    // koffi é carregado somente no Windows para permitir testes e desenvolvimento
    // em outros sistemas sem inicializar DLLs nativas.
    const koffi = require('koffi') as any;
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const SendInput = user32.func(
        'uint32 __stdcall SendInput(uint32, void *, int)',
    );
    const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
    const GetForegroundWindow = user32.func(
        'void * __stdcall GetForegroundWindow()',
    );
    const GetWindowThreadProcessId = user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void *, uint32 *)',
    );
    const INPUT_SIZE = 40;
    let targetPid: number | null = null;
    let targetWindow: any = null;
    let warned = false;

    const foreground = () => {
        const hwnd = GetForegroundWindow();
        if (!hwnd) return { hwnd: null, pid: 0 };
        const pid = Buffer.alloc(4);
        GetWindowThreadProcessId(hwnd, pid);
        return { hwnd, pid: pid.readUInt32LE(0) };
    };

    const lockTarget = (force: boolean) => {
        const current = foreground();
        if (targetPid === null && current.pid) {
            targetPid = current.pid;
            targetWindow = current.hwnd;
        }
        if (force && targetWindow) return true;
        if (targetPid !== null && current.pid !== targetPid) {
            if (!warned) {
                warned = true;
                console.warn('⚠ Foco mudou; novos eventos foram bloqueados.');
            }
            return false;
        }
        return Boolean(targetWindow);
    };

    const arm = () => {
        const current = foreground();
        if (!current.pid || !current.hwnd) return false;
        targetPid = current.pid;
        targetWindow = current.hwnd;
        warned = false;
        return true;
    };

    const send = (events: KeyboardEvent[], force = false) => {
        if (!events.length || !lockTarget(force)) return false;
        const buffer = Buffer.alloc(INPUT_SIZE * events.length);
        events.forEach((event, index) => {
            const offset = index * INPUT_SIZE;
            buffer.writeUInt32LE(1, offset);
            buffer.writeUInt16LE(event.vk ?? 0, offset + 8);
            buffer.writeUInt16LE(event.sc ?? 0, offset + 10);
            buffer.writeUInt32LE((event.up ? 0x0002 : 0) | 0x0008, offset + 12);
        });
        const count = Number(SendInput(events.length, buffer, INPUT_SIZE));
        if (count !== events.length)
            console.warn(
                `⚠ SendInput enviou ${count}/${events.length} eventos (erro ${Number(GetLastError())}).`,
            );
        return count === events.length;
    };

    return {
        dry: false,
        arm,
        send,
        reset: () => {
            send(
                [
                    { sc: 0x1d, vk: 0xa2, up: true },
                    { sc: 0x2a, vk: 0xa0, up: true },
                ],
                true,
            );
            targetPid = null;
            targetWindow = null;
            warned = false;
        },
    };
}

export function keyboardStroke(
    name: string,
    modifier: 'shift' | 'ctrl' | null,
) {
    return {
        sc: SCAN[name],
        vk: name.charCodeAt(0),
        unicode: name.charCodeAt(0),
        modifier,
    };
}
