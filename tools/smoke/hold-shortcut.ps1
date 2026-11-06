$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmokeShortcut {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr window, int id);
    public static void Hold() {
        for (uint key = 0x86; key <= 0x87; key++) {
            if (!RegisterHotKey(IntPtr.Zero, 291, 0x4007, key)) continue;
            try {
                Console.WriteLine("READY:F" + (key - 0x70 + 1));
                Console.ReadLine();
            } finally { UnregisterHotKey(IntPtr.Zero, 291); }
            return;
        }
        throw new InvalidOperationException("No isolated smoke shortcut is available.");
    }
}
'@
[SmokeShortcut]::Hold()
