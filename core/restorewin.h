#ifndef RESTOREWIN_H
#define RESTOREWIN_H

#include <stddef.h>
#include <stdint.h>

/* Research image engine, NOT a Windows storage driver. All operations must be
 * serialized by the caller. Request buffers must not alias scratch or map.
 * The adapter must supply an immutable baseline and verify its identity.
 * No callback may target a physical disk in this prototype. */

typedef enum {
    RW_OK = 0,
    RW_INVALID,
    RW_IO,
    RW_CORRUPT,
    RW_LIMIT,
    RW_NOT_READY,
    RW_EXISTS,
    RW_BASE_MISMATCH
} rw_status;

typedef struct {
    void *user;
    int (*read)(void *, uint64_t, void *, size_t);
    int (*size)(void *, uint64_t *);
} rw_source;

typedef struct {
    void *user;
    int (*read)(void *, uint64_t, void *, size_t);
    int (*write)(void *, uint64_t, const void *, size_t);
    int (*size)(void *, uint64_t *);
    int (*flush)(void *);
} rw_overlay;

typedef struct {
    uint32_t block_size;       /* 512 or 4096 bytes */
    uint64_t block_count;
    uint8_t baseline_id[32];   /* digest verified by the image adapter */
    uint64_t overlay_limit;   /* includes header and append-only frames */
} rw_geometry;

typedef struct {
    rw_source base;
    rw_overlay overlay;
    rw_geometry geometry;
    uint64_t *map;             /* caller-owned, one entry per baseline block */
    uint8_t *scratch;          /* caller-owned, at least 2 * block_size bytes */
    uint64_t end;
    uint64_t next_sequence;
    int ready;
} rw_context;

/* Formatting requires an EMPTY overlay; it never erases an existing image.
 * It does not change the baseline. A failed format requires inspection. */
rw_status rw_format(const rw_source *base, const rw_overlay *overlay,
                    const rw_geometry *geometry, void *scratch,
                    size_t scratch_bytes);

/* Mount replays and validates every complete record. Corrupt or partial tails
 * are rejected; there is no automatic truncation or baseline fallback. */
rw_status rw_mount(rw_context *context, const rw_source *base,
                   const rw_overlay *overlay, const rw_geometry *geometry,
                   uint64_t *map, size_t map_entries, void *scratch,
                   size_t scratch_bytes);

rw_status rw_read(rw_context *context, uint64_t block, void *data);
rw_status rw_write(rw_context *context, uint64_t block, const void *data);

/* Closes the engine only; callbacks/resources remain owned by the caller.
 * Restoring a baseline requires a NEW overlay while the image is offline.
 * There is deliberately no live-reset operation. */
void rw_close(rw_context *context);

#endif
