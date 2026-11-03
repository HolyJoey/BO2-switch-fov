# BO2 Switch FOV Patcher

A small web page that unlocks a higher field of view (up to 160) in
[BO2 Requiem NX](https://github.com/HDErick/BO2-Requiem-NX), the Nintendo Switch port of
Black Ops II, for both **Zombies** and **Multiplayer**, and makes the FOV slider in the game's
options menu go just as high.

The page patches your own `t6zm.nro` / `t6mp.nro` (the game) and `patch_zm.ff` / `patch_mp.ff`
(the menu) locally in your browser. Your files are never uploaded anywhere, and this repository
does not contain or distribute any Requiem or game files.

**Use it here:** https://holyjoey.github.io/BO2-switch-fov/

Works in any modern browser, on desktop and on phones.

## How to use

1. Download Requiem from the [official releases](https://github.com/HDErick/BO2-Requiem-NX/releases)
   and set it up as usual. **Updating?** Copy the whole new release to the SD card first,
   including `t6game.nro` (the launcher), otherwise the game says it's out of date.
2. Copy these files from your SD card to your PC or phone. **Keep a backup of the originals.**
   - `t6zm.nro` (Zombies) and/or `t6mp.nro` (Multiplayer) from `/switch/t6game/` (needed).
   - `patch_zm.ff` and/or `patch_mp.ff` from `/switch/t6game/zone/all/` (recommended: without
     them the FOV slider in the game's menu stops at 90).
3. Open the page, pick your FOV (use the slider or type a value from 65 to 160) and drop the
   files in (or tap to choose them on a phone). You can add up to 4 files at once. The page
   recognises each file from its contents, patches it and gives you the patched file to
   download. The FOV you pick is also the highest value of the slider in the menu files; change
   it and their download is updated. Open *Technical details* under a result to see exactly
   what changes.
4. Put each patched file back where it came from, with the same name, replacing the one there:

   | File | Folder on the SD card |
   |---|---|
   | `t6zm.nro`, `t6mp.nro` | `/switch/t6game/` |
   | `patch_zm.ff`, `patch_mp.ff` | `/switch/t6game/zone/all/` |

5. Copy the config lines from the page into `/switch/t6game/players/config_zm.cfg` or
   `config_mp.cfg`. For 120 they look like this:

   ```
   seta cg_fov "120"
   seta cg_fov_default "120"
   ```

To undo it, put your original files back. Lost your backup? Drop the patched file into the page:
for a `.nro` it gives you the original back (for the builds listed below), for a `.ff` a copy
with the normal slider (up to 90).

## Supported versions

| File | Requiem release | Size (bytes) | Status |
|---|---|---|---|
| `t6zm.nro` (Zombies) | [0.3.1](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.3.1) | 52,290,109 | Tested on Switch |
| `t6mp.nro` (Multiplayer) | [0.3.1](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.3.1) | 84,924,164 | Tested on Switch |
| `t6zm.nro` (Zombies) | 0.3.0 | 52,277,821 | Tested on Switch |
| `t6mp.nro` (Multiplayer) | 0.3.0 | 84,911,876 | Tested on Switch |
| `t6zm.nro` (Zombies) | [0.2.5](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.2.5) | 51,335,533 | Tested on Switch |
| `t6mp.nro` (Multiplayer) | [0.2.5](https://github.com/HDErick/BO2-Requiem-NX/releases/tag/0.2.5) | 83,981,876 | Tested on Switch |
| `patch_zm.ff`, `patch_mp.ff` (the menu) | BO2 PC game data (not part of Requiem) | any | Tested on Switch |

**Other and newer versions are detected automatically.** Each Requiem update shifts the code, so
the page looks for the FOV code in your file by itself: it finds the embedded engine, the
`cg_fov` and `cg_fov_default` strings, the code that registers them and the instruction that
loads the maximum. It only patches when it finds exactly that pattern, once for each setting.
Those builds are marked *Auto-detected* until they've been tested on a Switch. If the pattern
isn't found, the file is refused and nothing gets changed.

Auto-detection gives the same offsets as the hand-checked ones for every release so far
(0.0.1, 0.2.2 to 0.2.5, both uploads of 0.3.0 and 0.3.1). The page can only restore an original for
the builds in the table (and the first upload of 0.3.0, which was replaced under the same tag),
because for other builds it doesn't know the original bytes once a file is patched.

Is your file refused? Use *Copy details* or *Report on GitHub* on the page, which opens an
issue with the file size, the Requiem version found in it and the reason.

### New releases

A [GitHub Action](.github/workflows/check-requiem.yml) checks the latest Requiem release every
hour. It reads only the table of contents of the release zip and recognises known builds by
size and CRC-32. For a new build it runs the same detection code as the page on the two files
and opens one issue saying whether the page already handles it, with the offsets ready to add.
Runs that found nothing are cleaned up automatically.

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
| `t6zm.nro` | 0.3.1 | `cg_fov` max | `0x219F9B9` | `80 5A 49 B9` | `00 64 A8 52` |
| `t6zm.nro` | 0.3.1 | `cg_fov_default` max | `0x248AAA5` | `00 80 42 B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.1 | `cg_fov` max | `0x40B3BB0` | `80 DA 4B B9` | `00 64 A8 52` |
| `t6mp.nro` | 0.3.1 | `cg_fov_default` max | `0x4399E5C` | `00 00 45 B9` | `00 64 A8 52` |
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

### The menu slider (`patch_zm.ff` / `patch_mp.ff`)

The NRO patch raises the engine limit, but the options menu has its own range for the slider.
The menu is Lua code compiled into `patch_zm.ff` and `patch_mp.ff`, which come from your own BO2
PC game data (Requiem doesn't ship them). It creates the slider with
`addHardwareProfileLeftRightSlider(..., "cg_fov_default", 65, 90, ...)`, and the patch changes that
90 into the FOV you pick (a 32-bit float, at most 160).

These fastfiles are split into chunks of at most 32 KB over 4 streams. Each chunk is
deflate-compressed and then Salsa20-encrypted, with an IV that depends on the zone name and on
the SHA-1 of the earlier chunks of the same stream (the scheme
[OpenAssetTools](https://github.com/Laupetin/OpenAssetTools) documents). The page decrypts and
unpacks the file, requires exactly one match of the slider's constants
(`"cg_fov_default"`, 65, then the max), changes the max, compresses that one chunk again and
encrypts the whole chain again. It then reads its own output back to check the result.

The stock files are signed by Treyarch (`TAff0100`). A changed file can't keep that signature,
so it's written as an unsigned zone (`TAffu100`), the format mod fastfiles use, which the game
loads without a signature check. Tested on a Switch with Requiem 0.3.1, in Zombies and
Multiplayer.

The detection and patching code is in [`patcher.js`](patcher.js) (the `.nro`) and
[`fastfile.js`](fastfile.js) (the menu), the page is [`index.html`](index.html).

## Credits

- **[HDErick](https://github.com/HDErick)** for [BO2 Requiem NX](https://github.com/HDErick/BO2-Requiem-NX),
  the Switch port this patch is for. All credit for the port goes to them and to the people
  credited in their project.
- This patcher is a separate, unofficial tool and is not part of the Requiem project.

## License

The code in this repository (the patcher page) is released under the [MIT License](LICENSE).
That license covers only this repository, not Requiem, Black Ops II or any game files.
