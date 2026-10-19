# Performance: measuring and optimizing the canvas

October 6, 2026

This page says where Poulpe Design was slowing down, what was changed and what we gain, backed by before and after figures. It also describes the performance settings shown in the Preferences window.

## How we measure

Measurement is built into the app: `?bench` in the editor's address, or `POULPE_BENCH=1 poulpe` for the desktop app, which writes its report to standard output (see [moteur-v0.1.md](moteur-v0.1.md#desktop-app-performance-under-linux)).

The test document contains 1,000 objects (solid shapes, gradients, strokes, rotations, 40 text blocks) on a 1920 × 1080 artboard. Each scenario replays a real gesture frame by frame, 60 times. The time of a frame counts everything the gesture triggers: the gesture itself, the panel updates, the drawing of the next frame (canvas, rulers) and the browser finishing the drawing. Below 16 ms, the image keeps up with the screen at 60 frames per second.

Measurement machine: Linux virtual machine without a graphics card, 4 Xeon cores, Chromium 141, 721 × 718 px canvas. The "slow machine" column slows the processor down 4 times (a Chromium setting), which gives an idea of an old computer or of the desktop app on Linux, whose web view is about 4 times slower without a graphics card.

## Results

Average time of a frame, in milliseconds (frames per second in parentheses).

| Scenario                        | Before  | After     | Slow machine, before | Slow machine, after |
| ------------------------------- | ------- | --------- | -------------------- | ------------------- |
| Hovering objects with the mouse | 30 (34) | 1 (1,000) | 141 (7)              | 5 (189)             |
| Scrolling                       | 24 (42) | 1.4 (713) | 113 (9)              | 6 (166)             |
| Zoom                            | 69 (15) | 3.6 (279) | 337 (3)              | 15 (66)             |
| Scrolling at high zoom (× 4)    | 54 (18) | 3.3 (307) | 270 (4)              | 17 (60)             |
| Moving 50 objects               | 54 (18) | 15 (66)   | 247 (4)              | 68 (15)             |
| Adjusting an object's color     | 49 (20) | 11 (90)   | 223 (4)              | 48 (21)             |
| First display of the document   | 24 (41) | 17 (59)   | 113 (9)              | 117 (9)             |

No memory leak: with the full measurement replayed 4 times in a row in the same window, JavaScript memory stays stable (47, 49, 49, 49 MB after garbage collection). The images kept by the cache are capped by the "Render cache" setting (256 MB at most by default); for a screen of this size, they take a few MB.

What we take away:

- **Moving the mouse, scrolling and zooming no longer lag**, even on a slow machine: from 3 to 9 frames per second before, more than 60 after.
- **Moving or editing objects is 3 to 4 times faster**, thanks to this change and to the virtualized layer list (PR #22), which no longer rebuilds its 1,000 rows on every frame.
- The first display of a document does not change: everything has to be drawn once.

## What was slowing things down, and what changed

1. **Every mouse movement redrew the whole document.** The pointer position (shown in the status bar) went through the interface state, and the canvas redrew on every change of that state, including that one. It also read the theme colors (a page style computation) every time. Now the canvas ignores what does not concern it (pointer, messages, dialogs) and only rereads the colors when the theme changes.
2. **Canvas image cache** (`packages/render/src/cache.ts`). The content of each artboard is kept as an image and simply copied as long as it does not change. When objects are selected, what is below and what is above are kept as two images, and only the selected objects (the ones being edited) are drawn on each frame. An image stays valid as long as its objects are the same: documents are immutable and an unchanged object keeps its identity, so the check is instant. Blend modes, adjustment layers, linked text frames, page numbers, symbols and images being retouched are taken into account; when in doubt, drawing happens live as before.
3. **Zoom and scrolling.** During the gesture, the already computed image is moved or stretched; it is redrawn sharp as soon as the gesture stops (140 ms). The "Preview quality" setting lets you redraw sharp on every frame.
4. **Off-screen objects skipped.** At high zoom, only visible objects are drawn.
5. **Rulers** redrawn at most once per frame and only when the view changes, without reallocating their canvas.
6. **Transparency checkerboard** drawn with a single pattern instead of thousands of small squares.
7. **Text size**: on every command, the size of every text was recomputed (measuring each word). It is now kept as long as the text does not change.
8. **History**: the list of steps is no longer copied on every frame of a gesture, and the number of steps kept is capped (500 by default, adjustable) so that memory does not grow endlessly during large photo retouching.
9. **Text input field**: it no longer updates on every document change when no text is being edited.

End-to-end tests check that the image displayed with the cache is the same as a full drawing without the cache, during a move and after an edit (`apps/editor/e2e/performance.spec.ts`).

## Performance settings

They are applied by `apps/editor/src/perf.ts`; the Preferences > Performance window shows them, saves them and calls `setPerformanceSettings` at startup with the saved values.

| Setting               | Field                  | Default             | Effect                                                                                                                                                                                |
| --------------------- | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render cache          | `cacheMb`              | 256 MB              | Maximum memory for the canvas images kept. 0 disables the cache (everything is redrawn on every frame).                                                                               |
| Undo steps kept       | `historyLimit`         | 500                 | Older steps are forgotten. 0: unlimited.                                                                                                                                              |
| Preview quality       | `previewQuality`       | balanced            | `fast`: image stretched during zoom even if it does not cover the whole screen; `balanced`: stretched as long as it covers the screen; `full`: redrawn sharp on every frame (slower). |
| Hardware acceleration | `hardwareAcceleration` | yes                 | Cache images handed to the graphics card (offscreen canvases). No: kept in main memory, useful if a graphics driver causes problems.                                                  |
| Computing threads     | `workerThreads`        | number of cores − 1 | Threads used by AI background removal.                                                                                                                                                |

`renderStats()` provides the figures of the Diagnostics window: memory used by the cache, number of images kept, average and maximum duration of the last 60 frames, JavaScript memory (Chromium).

## Linux: artboard shadow (1.1.2)

First feedback from a real Linux machine (i7, RTX 4060, 2560 × 1440 screen): 45 ms per frame in the desktop app. When WebKitGTK draws the canvas without the graphics card (a common case with some drivers), blurring the artboards' drop shadow (`shadowBlur`) alone cost 22 ms per frame. The shadow is now blurred once on a small square, then its corners are copied and its edges stretched (`drawArtboardShadow`): same rendering to within 1 color level.

Measured in WebKitGTK 2.52 without canvas acceleration, 1,000 objects, 2560 × 1440 window, in ms per frame:

| Scenario                    | Before | After |
| --------------------------- | -----: | ----: |
| Mouse hover                 |   18.7 |   5.2 |
| Scrolling                   |   28.7 |   6.1 |
| Zoom                        |   34.7 |  16.4 |
| Adjusting an object's color |   44.4 |  23.2 |
| Moving 50 objects           |   51.5 |  33.1 |

Other findings from the same report:

- WebKit hides the graphics card's name ("Apple GPU") and reports at most 8 cores: Diagnostics now shows the processor model, its real execution threads and the memory used by all the app's processes, read by the desktop app.
- WebKitGTK only enables cross-origin isolation (`crossOriginIsolated`, shared threads in the page) for pages served over HTTP, not for the app's protocol: heavy computations therefore go through the native Rust engine, which uses all cores.

## Drawing on several cores (1.1.3)

A large redraw (300 objects or more: opening, end of a zoom) is split into bands drawn at the same
time by several drawing threads (`apps/editor/src/canvas/parallel.ts`), with the same drawing code.
The interface no longer freezes in the meantime; the old image stays displayed until the new one
is ready. Setting `parallelDrawing` (enabled by default). `?bench` measurement, 1000 objects, 4-core test
machine without a graphics card (interface blocked / image finished):

| Scenario                    | Chromium before | Chromium after | WebKitGTK before | WebKitGTK after |
| --------------------------- | --------------- | -------------- | ---------------- | --------------- |
| First display, solid shapes | 14.9 ms         | 1.6 / 11.9 ms  | 89.6 ms          | 4.5 / 78.7 ms   |
| First display, document     | 22.4 ms         | 1.8 / 17.0 ms  | 97.5 ms          | 3.7 / 146 ms    |

With only 3 threads, WebKitGTK takes longer to finish the image, but the interface stays smooth;
processors with 8 cores or more use up to 8 threads.

## Next steps

- Adjustment layers and photo filters computed in a Web Worker, off the interface thread.
- Redo the measurement in the desktop app on a real Linux machine (`POULPE_BENCH=1 poulpe`).
