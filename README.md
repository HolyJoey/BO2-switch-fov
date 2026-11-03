# BO2 Switch FOV Patcher

A small web page that unlocks a higher field of view (120 and beyond) in
[BO2 Requiem NX](https://github.com/HDErick/BO2-Requiem-NX), the Nintendo Switch port of
Black Ops II, for both **Zombies** and **Multiplayer**.

The page patches your own `t6zm.nro` or `t6mp.nro` locally in your browser. Your file is
never uploaded anywhere, and this repository does not contain or distribute any Requiem files.

**Use it here:** https://holyjoey.github.io/BO2-switch-fov/

Works in any modern browser, on desktop and on phones.

## How to use

1. Download Requiem from the [official releases](https://github.com/HDErick/BO2-Requiem-NX/releases)
   and set it up as usual.
2. Copy `t6zm.nro` (Zombies) or `t6mp.nro` (Multiplayer) from `/switch/t6game/` on your SD
   card to your PC or phone. **Keep a backup of the original.**
3. Open the page and drop the file in (or tap to choose it on a phone). You can add both files
   at once. It detects Zombies or Multiplayer from the file's contents, patches it and gives you
   the patched file to download.
4. Put the patched file back in `/switch/t6game/` with the same name.
5. Pick your FOV on the page (use the slider or type a value from 65 to 160) and copy the lines
   into `/switch/t6game/players/config_zm.cfg` or `config_mp.cfg`. For 120 they look like this:

   ```
   seta cg_fov "120"
   seta cg_fov_default "120"
   ```

To undo it, put your original file back. Lost your backup? Drop the patched file into the page
and it gives you the original back (for the builds listed below).

## Supported versions

| File | Requiem release | Size (bytes) | Status |
|---|---|---|---|
| `t6zm.nro` (Zombies) | [0.3.0](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.3.0) | 52,277,821 | Tested on Switch |
| `t6mp.nro` (Multiplayer) | [0.3.0](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.3.0) | 84,911,876 | Tested on Switch |
| `t6zm.nro` (Zombies) | 0.3.0 (first upload) | 52,273,725 | Supported, not tested in game yet |
| `t6mp.nro` (Multiplayer) | 0.3.0 (first upload) | 84,908,884 | Supported, not tested in game yet |
| `t6zm.nro` (Zombies) | [0.2.5](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.2.5) | 51,335,533 | Tested on Switch |
| `t6mp.nro` (Multiplayer) | [0.2.5](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.2.5) | 83,981,876 | Tested on Switch |

**Other and newer versions are detected automatically.** Each Requiem update shifts the code, so
the page looks for the FOV code in your file by itself: it finds the embedded engine, the
`cg_fov` and `cg_fov_default` strings, the code that registers them and the instruction that
loads the maximum. It only patches when it finds exactly that pattern, once for each setting.
Those builds are marked *Auto-detected* until they've been tested on a Switch. If the pattern
isn't found, the file is refused and nothing gets changed.

Auto-detection gives the same offsets as the hand-checked ones for every release so far
(0.0.1, 0.2.2 to 0.2.5 and both uploads of 0.3.0). The page can only restore an original for the builds in the
table, because for other builds it doesn't know the original bytes once a file is patched.

## What the patch changes

The engine clamps `cg_fov` and `cg_fov_default` to a maximum of 90. When the game registers
these settings, it loads that maximum with one instruction. The patch replaces that 4-byte
instruction with `movz w0, #0x4320, lsl #16`, which sets the maximum to 160.0. The file size
stays the same, nothing else is touched, and the change only affects your own view.

The 160 limit is a deliberate choice, not an engine limit. It leaves room above 120 while
staying well clear of 180, where the view projection breaks down. The lower limit of 65 comes
from the game itself.

| File | Release | Setting | File offset | Original bytes | Patched bytes |
|---|---|---|---|---|---|
| `t6zm.nro` | 0.3.0 | `cg_fov` max | `0x219D619` | `80 DA 44 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.3.0 | `cg_fov_default` max | `0x24886E5` | `00 00 4E B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.0 | `cg_fov` max | `0x40B1810` | `80 5A 47 B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.0 | `cg_fov_default` max | `0x4397A9C` | `00 80 40 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.3.0 (first upload) | `cg_fov` max | `0x219CA39` | `80 7A 43 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.3.0 (first upload) | `cg_fov_default` max | `0x2487875` | `00 C0 4D B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.0 (first upload) | `cg_fov` max | `0x40B1810` | `80 BA 4A B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.0 (first upload) | `cg_fov_default` max | `0x439780C` | `00 00 45 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.2.5 | `cg_fov` max | `0x20E71B9` | `80 5A 46 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.2.5 | `cg_fov_default` max | `0x23C9405` | `00 A0 40 B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.2.5 | `cg_fov` max | `0x3FFDB50` | `80 9A 4C B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.2.5 | `cg_fov_default` max | `0x42DFD7C` | `00 E0 46 B9` | `00 64 A8 52` |

For the builds in this table the page checks the file size and the original bytes at every
offset before it changes anything, and only reads those few bytes. For other builds it reads
the engine's code (about 8 MB) to find the offsets, which takes a second or so. Either way it
builds the patched file from pieces of your original and checks the result before you can
download it, so even the 84 MB Multiplayer file never has to be loaded into memory whole.

The detection and patching code is in [`patcher.js`](patcher.js), the page is
[`index.html`](index.html).

## Credits

- **[HDErick](https://github.com/HDErick)** for [BO2 Requiem NX](https://github.com/HDErick/BO2-Requiem-NX),
  the Switch port this patch is for. All credit for the port goes to them and to the people
  credited in their project.
- This patcher is a separate, unofficial tool and is not part of the Requiem project.

## License

The code in this repository (the patcher page) is released under the [MIT License](LICENSE).
That license covers only this repository, not Requiem, Black Ops II or any game files.
