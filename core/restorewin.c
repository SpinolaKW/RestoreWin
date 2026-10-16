#include "restorewin.h"

static void bytes_zero(uint8_t *data, size_t size)
{
    size_t i;
    for (i = 0; i < size; ++i) data[i] = 0;
}

static void bytes_copy(uint8_t *to, const uint8_t *from, size_t size)
{
    size_t i;
    for (i = 0; i < size; ++i) to[i] = from[i];
}

static int bytes_equal(const uint8_t *a, const uint8_t *b, size_t size)
{
    size_t i;
    for (i = 0; i < size; ++i) if (a[i] != b[i]) return 0;
    return 1;
}

static uint32_t get32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint64_t get64(const uint8_t *p)
{
    return (uint64_t)get32(p) | ((uint64_t)get32(p + 4) << 32);
}

static void put32(uint8_t *p, uint32_t value)
{
    unsigned i;
    for (i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (i * 8));
}

static void put64(uint8_t *p, uint64_t value)
{
    put32(p, (uint32_t)value);
    put32(p + 4, (uint32_t)(value >> 32));
}

/* IEEE CRC32 detects accidental damage; it is not an authenticator. */
static uint32_t crc32(const uint8_t *data, size_t size)
{
    uint32_t crc = UINT32_MAX;
    size_t i;
    unsigned bit;
    for (i = 0; i < size; ++i) {
        crc ^= data[i];
        for (bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ ((0U - (crc & 1U)) & 0xEDB88320U);
    }
    return ~crc;
}

static int header_crc_valid(uint8_t *header, uint32_t size, size_t offset)
{
    uint32_t expected = get32(header + offset);
    uint32_t actual;
    put32(header + offset, 0);
    actual = crc32(header, size);
    put32(header + offset, expected);
    return expected == actual;
}

static rw_status validate(const rw_source *base, const rw_overlay *overlay,
                          const rw_geometry *g, void *scratch, size_t length)
{
    uint64_t base_size;
    if (!base || !overlay || !g || !scratch || !base->read || !base->size ||
        !overlay->read || !overlay->write || !overlay->size || !overlay->flush)
        return RW_INVALID;
    if ((g->block_size != 512 && g->block_size != 4096) ||
        !g->block_count || g->block_count > UINT64_MAX / g->block_size ||
        length < (size_t)g->block_size * 2 ||
        g->overlay_limit < (uint64_t)g->block_size * 3)
        return RW_INVALID;
    if (base->size(base->user, &base_size)) return RW_IO;
    if (base_size != g->block_count * g->block_size) return RW_BASE_MISMATCH;
    return RW_OK;
}

rw_status rw_format(const rw_source *base, const rw_overlay *overlay,
                    const rw_geometry *g, void *scratch, size_t scratch_bytes)
{
    uint64_t length;
    uint8_t *header = scratch;
    rw_status status = validate(base, overlay, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    if (overlay->size(overlay->user, &length)) return RW_IO;
    if (length) return RW_EXISTS;
    bytes_zero(header, g->block_size);
    bytes_copy(header, (const uint8_t *)"RWINCOW1", 8);
    put32(header + 8, 1);
    put32(header + 12, g->block_size);
    put64(header + 16, g->block_count);
    bytes_copy(header + 24, g->baseline_id, 32);
    put32(header + 56, crc32(header, g->block_size));
    if (overlay->write(overlay->user, 0, header, g->block_size) ||
        overlay->flush(overlay->user)) return RW_IO;
    return RW_OK;
}

static int frame_valid(uint8_t *header, uint32_t size, uint64_t blocks)
{
    return bytes_equal(header, (const uint8_t *)"RWFRAME1", 8) &&
           header_crc_valid(header, size, 28) &&
           get64(header + 8) != 0 && get64(header + 16) < blocks;
}

rw_status rw_mount(rw_context *ctx, const rw_source *base,
                   const rw_overlay *overlay, const rw_geometry *g,
                   uint64_t *map, size_t map_entries, void *scratch,
                   size_t scratch_bytes)
{
    uint64_t length, offset, sequence, block;
    uint32_t bs;
    uint8_t *header = scratch;
    uint8_t *data;
    size_t i;
    rw_status status;
    if (!ctx) return RW_INVALID;
    ctx->ready = 0;
    status = validate(base, overlay, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    if (!map || g->block_count > SIZE_MAX / sizeof(*map) ||
        map_entries < g->block_count) return RW_INVALID;
    bs = g->block_size;
    data = header + bs;
    if (overlay->size(overlay->user, &length)) return RW_IO;
    if (length > g->overlay_limit) return RW_LIMIT;
    if (length < bs || (length - bs) % ((uint64_t)bs * 2)) return RW_CORRUPT;
    if (overlay->read(overlay->user, 0, header, bs)) return RW_IO;
    if (!bytes_equal(header, (const uint8_t *)"RWINCOW1", 8) ||
        get32(header + 8) != 1 || !header_crc_valid(header, bs, 56))
        return RW_CORRUPT;
    if (get32(header + 12) != bs || get64(header + 16) != g->block_count ||
        !bytes_equal(header + 24, g->baseline_id, 32)) return RW_BASE_MISMATCH;
    for (i = 0; i < (size_t)g->block_count; ++i) map[i] = 0;
    offset = bs;
    sequence = 1;
    while (offset < length) {
        if (overlay->read(overlay->user, offset, header, bs) ||
            overlay->read(overlay->user, offset + bs, data, bs)) return RW_IO;
        if (!frame_valid(header, bs, g->block_count) ||
            get64(header + 8) != sequence ||
            get32(header + 24) != crc32(data, bs)) return RW_CORRUPT;
        block = get64(header + 16);
        map[block] = offset + bs;
        offset += (uint64_t)bs * 2;
        ++sequence;
    }
    ctx->base = *base;
    ctx->overlay = *overlay;
    ctx->geometry = *g;
    ctx->map = map;
    ctx->scratch = scratch;
    ctx->end = length;
    ctx->next_sequence = sequence;
    ctx->ready = 1;
    return RW_OK;
}

static rw_status poison(rw_context *ctx, rw_status status)
{
    ctx->ready = 0;
    return status;
}

rw_status rw_read(rw_context *ctx, uint64_t block, void *output)
{
    uint64_t offset;
    uint32_t bs;
    uint8_t *header, *data;
    if (!ctx || !ctx->ready) return RW_NOT_READY;
    if (!output || block >= ctx->geometry.block_count) return RW_INVALID;
    bs = ctx->geometry.block_size;
    header = ctx->scratch;
    data = header + bs;
    offset = ctx->map[block];
    if (!offset) {
        if (ctx->base.read(ctx->base.user, block * bs, data, bs))
            return poison(ctx, RW_IO);
    } else {
        if (ctx->overlay.read(ctx->overlay.user, offset - bs, header, bs) ||
            ctx->overlay.read(ctx->overlay.user, offset, data, bs))
            return poison(ctx, RW_IO);
        if (!frame_valid(header, bs, ctx->geometry.block_count) ||
            get64(header + 16) != block ||
            get64(header + 8) >= ctx->next_sequence ||
            get32(header + 24) != crc32(data, bs)) return poison(ctx, RW_CORRUPT);
    }
    bytes_copy(output, data, bs);
    return RW_OK;
}

rw_status rw_write(rw_context *ctx, uint64_t block, const void *input)
{
    uint32_t bs;
    uint8_t *header, *data;
    if (!ctx || !ctx->ready) return RW_NOT_READY;
    if (!input || block >= ctx->geometry.block_count) return RW_INVALID;
    bs = ctx->geometry.block_size;
    if ((uint64_t)bs * 2 > ctx->geometry.overlay_limit - ctx->end ||
        ctx->next_sequence == UINT64_MAX) return RW_LIMIT;
    header = ctx->scratch;
    data = header + bs;
    /* Own the bytes used for both checksum and backend I/O. The adapter must
     * still keep the source buffer readable for this initial copy. */
    bytes_copy(data, input, bs);
    bytes_zero(header, bs);
    bytes_copy(header, (const uint8_t *)"RWFRAME1", 8);
    put64(header + 8, ctx->next_sequence);
    put64(header + 16, block);
    put32(header + 24, crc32(data, bs));
    put32(header + 28, crc32(header, bs));
    if (ctx->overlay.write(ctx->overlay.user, ctx->end, header, bs) ||
        ctx->overlay.write(ctx->overlay.user, ctx->end + bs, data, bs) ||
        ctx->overlay.flush(ctx->overlay.user)) return poison(ctx, RW_IO);
    ctx->map[block] = ctx->end + bs;
    ctx->end += (uint64_t)bs * 2;
    ++ctx->next_sequence;
    return RW_OK;
}

void rw_close(rw_context *ctx)
{
    if (ctx) ctx->ready = 0;
}
