# Rust engine and graphics card (version 1.1.1)

October 10, 2026

Version 1.1.1 begins rewriting the core of Poulpe Design in Rust (chosen option: the engine in Rust, the current interface kept). This page diagnoses performance, describes the new engine and its settings, gives the measured gains, the next steps of the overhaul and the test plan on the four typical configurations.

## Diagnosis

What was checked before changing anything (same machine as [performances.md](performances.md): Linux without a graphics card, 4 cores).

| Item                        | Measurement before 1.1.1                                                    | Verdict                                   |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Startup (window ready)      | 0.9 to 1.1 s in Chromium, 6 MB of JavaScript memory                         | Good; to be confirmed in the app on Linux |
| Zoom, scrolling, hover      | 1 to 4 ms per frame (over 250 fps), 15 to 17 ms on a machine 4 times slower | Good since 1.1.0 (image cache)            |
| Gaussian blur, 12 MP photo  | 4.5 s, interface frozen                                                     | **Main bottleneck**                       |
| Clarity, sharpening (12 MP) | 4.4 to 5 s, interface frozen                                                | **Main bottleneck**                       |
| Hue / saturation (12 MP)    | 0.95 s, interface frozen                                                    | Slow                                      |
| Opening a large `.poulpe`   | Decompression and image conversion on the interface thread                  | Freezes for several seconds beyond 100 MB |
| Image processing            | A single core, no graphics card                                             | Wastes the machine                        |
| Graphics card choice        | Only "preferred" for the web view, at next launch                           | No choice of processor or graphics API    |

Conclusion: everyday display is already smooth; what freezes the app is heavy pixel computation (filters, adjustments, large files), done in JavaScript on a single core on the interface thread. So that is where the Rust engine starts.

## The engine

```
crates/poulpe-engine        Rust engine (library), tested on its own: cargo test --features gpu
  adjust.rs                 25 adjustments and filters, exact port of packages/core/src/adjust.ts
  blur.rs                   Gaussian blur (three box blurs), rows and columns in parallel
  gpu.rs                    graphics card via wgpu: choice, API, video memory, fallback
  tiles.rs                  splits large images into tiles, memory-bounded tile cache
  stats.rs                  profiling: duration of the latest computations by kind
crates/poulpe-engine-wasm   the same engine compiled to WebAssembly (270 KB, 80 KB compressed)
packages/engine             loads the WebAssembly in the page, plugged into @poulpe/core
apps/desktop/src-tauri/src/engine.rs   native engine in the desktop app (Tauri commands)
apps/editor/src/engine.ts   link with the editor (filters, Preferences, Diagnostics)
```

The same Rust code runs in two ways:

- **In the page, as WebAssembly** (browser and desktop app). Canvas rendering calls it directly, frame by frame, for the filters where it is clearly faster than JavaScript: Gaussian blur, sharpening, clarity, hue/saturation, threshold. For simple adjustments (one table per channel: levels, curves, exposure…), the browser's JavaScript is just as fast and copying the pixels would cost more than it gains: they stay in TypeScript.
- **Natively, in the desktop app.** Applying a filter to an image of more than one million pixels goes to the native engine, on a separate thread: the interface no longer freezes. The computation runs on the graphics card when it can handle it (per-channel tables, Gaussian blur), otherwise on all processor cores.

**Same pixels everywhere.** The port reproduces the TypeScript formulas down to the rounding (the `Uint8ClampedArray` rounding rule, 32-bit floats where the TypeScript uses them). The tests (`packages/engine/test/engine.test.ts`) compare the engine and the TypeScript on each of the 25 adjustments, with and without document guides: 0 pixels of difference. On the graphics card, per-channel tables give exactly the same result; the blur, computed in 32-bit floats, can differ by one level (out of 255) on a few pixels.

**Fallback.** If the WebAssembly fails to load or fails (out of memory), it is disconnected and TypeScript takes over. If the graphics card fails (driver, video memory), the computation is redone on the processor. A software card (llvmpipe, WARP) is never chosen: the processor alone is faster.

### Graphics card (wgpu)

- Graphics APIs: Vulkan (Linux, Windows), Metal (macOS), DirectX 12 (Windows), OpenGL as a last resort. NVIDIA, AMD, Intel and Apple Silicon cards.
- Automatic choice: the dedicated card if there is one, otherwise the integrated card. "Integrated card" reverses the order; "Processor only" opens no card.
- The card is only opened at the first computation that needs it: startup is not slowed down and the idle app uses no video memory.
- Video memory: an image too large for the chosen limit (or for the card's limits) is processed in tiles, read with a margin for filters that look at neighboring pixels.

```rust
// crates/poulpe-engine/src/gpu.rs: the graphics card if it can do the job and the image is large
// enough for the round trip to pay off, otherwise (or if it fails) all CPU cores.
pub fn apply(gpu: Option<&Gpu>, data: &mut [u8], w: usize, h: usize, adj: &Adjustment, opts: &Options) -> (Where, f64) {
    let t0 = Instant::now();
    if let Some(gpu) = gpu {
        if w * h >= 1 << 20 && Gpu::supports(adj) && gpu.apply(data, w, h, adj, opts) {
            return (Where::Gpu, t0.elapsed().as_secs_f64() * 1000.0);
        }
    }
    adjust::apply(data, w, h, adj, opts);
    (Where::Cpu, t0.elapsed().as_secs_f64() * 1000.0)
}
```

## Settings (Preferences > Performance)

| Setting                             | Values                                                                 | Effect                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Graphics card                       | Automatic, Dedicated card, Integrated card, Processor only             | Rust engine: right away. Display: at next launch (Windows and Linux; macOS chooses on its own).                               |
| Graphics API                        | Automatic, Vulkan, Metal, DirectX 12, OpenGL (depending on the system) | Rust engine: right away. On Windows, the display also switches to Vulkan or OpenGL at next launch.                            |
| Engine video memory                 | 256 MB to 8 GB (1 GB by default)                                       | Size of the tiles sent to the graphics card.                                                                                  |
| Preview quality                     | Fast, Balanced, High                                                   | Unchanged (see [performances.md](performances.md)).                                                                           |
| Memory budget, image cache          | As before                                                              | Main memory (RAM) limit.                                                                                                      |
| Saver / Balanced / Power profile    | Buttons                                                                | Saver mode (integrated card, 512 MB of video memory, fast preview) or performance mode (dedicated card, 4 GB, sharp preview). |
| Frames per second in the status bar | Checkbox                                                               | Display statistics (also in Interface).                                                                                       |

The section also shows the engine status: WebAssembly active, card used by the native engine, and cards found. The Diagnostics tab adds the number of computations and their average duration (profiling), by kind and by location (`gpu:gaussianBlur`, `cpu:hsl`…), and copies them into the report.

These settings are saved in `lancement.json` (the app's configuration folder) and read at startup by Rust (`apps/desktop/src-tauri/src/launch.rs`). The former "Hardware acceleration" checkbox becomes the "Processor only" choice; a setting already saved is kept as is.

## The 5 quick wins of 1.1.1

1. **Heavy filters in Rust in the page** (WebAssembly): blurs and sharpening 3 times faster, hue and threshold 2 times, in the browser as well as in the app.
2. **Filters on large images off the interface** (desktop app): on all cores or the graphics card, up to 15 times faster, and the app no longer freezes during the computation.
3. **Large `.poulpe` files opened and saved off the interface** (above 4 MB, in a Web Worker: `apps/editor/src/file.worker.ts`).
4. **Choice of graphics card, graphics API and video memory**, applied right away to the Rust engine.
5. **Nothing more at startup**: the WebAssembly loads when the app is idle, the graphics card opens at the first computation (measured startup: 1.1 s, as before; 6 MB of JavaScript memory at idle).

## Measured gains

4000 × 3000 pixel photo (12 MP), Linux without a graphics card, 4 cores. Commands: `pnpm --filter @poulpe/engine test` (comparison) and `cargo run --release --features gpu --example bench` in `crates/poulpe-engine`.

| Computation            | Before (TypeScript) | In the page (WebAssembly) | Desktop app (native Rust, 4 cores) |
| ---------------------- | ------------------- | ------------------------- | ---------------------------------- |
| Gaussian blur (r = 20) | 4,500 ms            | 1,540 ms                  | **290 ms**                         |
| Clarity                | 4,600 ms            | 2,200 ms                  | **300 ms**                         |
| Sharpening             | 5,000 ms            | 1,500 ms                  | **300 ms**                         |
| Hue / saturation       | 950 ms              | 540 ms                    | **170 ms**                         |
| Noise                  | 340 ms              | (TypeScript)              | 86 ms                              |
| Vibrance               | 140 ms              | (TypeScript)              | 68 ms                              |
| Levels                 | 40 ms               | (TypeScript)              | 9 ms                               |

With 8 cores or a real graphics card, native times drop further; they are to be recorded on the four configurations below. On the measurement machine, the only "card" is a software one (llvmpipe): it is used to check the graphics card computations, not to time them.

## Next steps of the overhaul

1.1.1 is the first of the four announced stages. Each stage is a published release, and `.poulpe` files, automatic updates and the browser version keep working.

1. **Pixel computations** (1.1.1, this release): adjustments, filters, graphics card, performance settings.
2. **Files**: reading and writing `.poulpe` files in Rust in the desktop app, streamed and without loading everything (files of 500 MB and more), images kept in memory by the engine rather than as base64 text in the page.

   ```rust
   // Reads one image from a .poulpe without loading the whole archive (zip crate).
   pub fn read_asset(path: &Path, name: &str) -> zip::result::ZipResult<Vec<u8>> {
       let mut archive = zip::ZipArchive::new(BufReader::new(File::open(path)?))?;
       let mut entry = archive.by_name(name)?;
       let mut bytes = Vec::with_capacity(entry.size() as usize);
       std::io::copy(&mut entry, &mut bytes)?;
       Ok(bytes)
   }
   ```

3. **Rendering**: drawing artboards (shapes, gradients, text, effects, blend modes) in Rust on the graphics card (vello on wgpu), in cached tiles; full-resolution PNG, JPEG and PDF export by the same engine, without going through the page.

   ```rust
   // A document tile, drawn by vello on the graphics card and then kept in the cache.
   let mut scene = vello::Scene::new();
   for node in artboard.visible_nodes(tile.bounds()) {
       draw_node(&mut scene, node, tile.transform());
   }
   renderer.render_to_texture(&device, &queue, &scene, &tile.texture_view(), &params)?;
   ```

4. **Layers and history**: the document model and undo in Rust; the React interface only displays and sends gestures.

## Test plan on the four typical configurations

To be done on each machine with the 1.1.1 desktop app, after an automatic update from 1.1.0.

| Step                                                           | Expected                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Launch the app, time it until the welcome screen            | Under 3 s                                                                        |
| 2. Task manager after 1 min of doing nothing                   | Under 500 MB for all the app's processes                                         |
| 3. Preferences > Performance                                   | Rust engine active; the right graphics card and its API displayed                |
| 4. Open a 24 MP photo, Filters > Gaussian blur, radius 40      | The app stays responsive during the computation; Diagnostics: `gpu:gaussianBlur` |
| 5. Graphics card: Processor only, redo step 4                  | Same image; Diagnostics: `cpu:gaussianBlur`                                      |
| 6. Open a `.poulpe` larger than 200 MB                         | No freeze; the document opens                                                    |
| 7. Turn on frames per second, zoom and scroll on this document | 60 fps or more                                                                   |
| 8. Export to PNG at 300 dpi                                    | No freeze longer than one second                                                 |
| 9. `POULPE_BENCH=1` on the command line                        | Benchmark report on standard output (to attach)                                  |
| 10. Diagnostics > Copy Report                                  | To attach to the ticket, with the engine durations                               |

| Configuration                       | Expected API           | Result |
| ----------------------------------- | ---------------------- | ------ |
| Linux + NVIDIA (proprietary driver) | Vulkan                 | to do  |
| Windows + AMD                       | DirectX 12 (or Vulkan) | to do  |
| Intel Mac                           | Metal                  | to do  |
| Apple Silicon Mac                   | Metal                  | to do  |

What is already checked automatically on every change (CI): the 25 adjustments identical between Rust and TypeScript, computation on a graphics card (software, Vulkan llvmpipe) identical to the processor, tiling, card selection and settings loading, the WebAssembly build, and the editor's end-to-end tests.
