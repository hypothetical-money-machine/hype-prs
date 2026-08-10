# Responsive UI sweep

Captured on 2026-08-10 in Chrome at DPR 1. Each filename records the exact CSS viewport used for the capture. Physical high-density displays may expose a smaller CSS viewport depending on operating-system scaling.

## Major captures

| Aspect ratio | Viewport | Capture |
| --- | ---: | --- |
| 16:9 | 1280×720 | [16x9-1280x720.jpg](./16x9-1280x720.jpg) |
| 16:9 | 1920×1080 | [16x9-1920x1080.jpg](./16x9-1920x1080.jpg) |
| 16:9 | 2560×1440 | [16x9-2560x1440.jpg](./16x9-2560x1440.jpg) |
| 16:9 | 3840×2160 | [16x9-3840x2160.jpg](./16x9-3840x2160.jpg) |
| 16:9 | 7680×4320 | [16x9-7680x4320.jpg](./16x9-7680x4320.jpg) |
| 16:10 | 1280×800 | [16x10-1280x800.jpg](./16x10-1280x800.jpg) |
| 16:10 | 1920×1200 | [16x10-1920x1200.jpg](./16x10-1920x1200.jpg) |
| 16:10 | 2560×1600 | [16x10-2560x1600.jpg](./16x10-2560x1600.jpg) |
| 16:10 | 3840×2400 | [16x10-3840x2400.jpg](./16x10-3840x2400.jpg) |
| 3:2 | 1440×960 | [3x2-1440x960.jpg](./3x2-1440x960.jpg) |
| 3:2 | 2160×1440 | [3x2-2160x1440.jpg](./3x2-2160x1440.jpg) |
| 3:2 | 3000×2000 | [3x2-3000x2000.jpg](./3x2-3000x2000.jpg) |
| Ultrawide | 2560×1080 | [ultrawide-2560x1080.jpg](./ultrawide-2560x1080.jpg) |
| Ultrawide | 2880×1200 | [ultrawide-2880x1200.jpg](./ultrawide-2880x1200.jpg) |
| Ultrawide | 3440×1440 | [ultrawide-3440x1440.jpg](./ultrawide-3440x1440.jpg) |
| Ultrawide | 3840×1600 | [ultrawide-3840x1600.jpg](./ultrawide-3840x1600.jpg) |
| Ultrawide | 5120×2160 | [ultrawide-5120x2160.jpg](./ultrawide-5120x2160.jpg) |

## Additional regression viewports

The rendered sweep also covered 1600×900, 1680×1050, 2256×1504, 2880×1920, and exact 22:9 at 5120×2095. Across all 23 viewports, the document stayed within the viewport, the sidebar controls remained reachable, and the selected queue row stayed visible. The diff automatically uses unified mode when its viewer is narrower than 1000 CSS pixels and restores the user's split preference when enough room returns.
