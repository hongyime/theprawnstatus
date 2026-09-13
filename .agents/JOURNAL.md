# Journal

2026-09-13 — Revalidated delayed GitHub schedule creation. Separate scheduling reliability from successful job execution; do not increase writes until storage and failure-recovery contracts are measured. Preserve all prior records and owner choices.

2026-09-13 — Implemented immutable batches, deduplicated target configurations, atomic current projection and the original status_runs compatibility API. Real SQL fixtures reproduced and fixed a configuration race and UTC-window mismatch; streaming fixtures reproduced and fixed two response-cancellation leaks. Added a 400 MB collection guard and a Node manual recovery path sharing the Edge collector's lease contract. Original observations and summaries are retained. Local contracts, app checks and capacity fixtures pass; hosted CI and production cutover remain pending. See SCHEDULER.md for exact release order and recovery constraints.
