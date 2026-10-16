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
    ctx->format_version = 1;
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
    if (!ctx || !ctx->ready || ctx->format_version != 1) return RW_NOT_READY;
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
    if (!ctx || !ctx->ready || ctx->format_version != 1) return RW_NOT_READY;
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

static rw_status validate2(const rw_source *base, const rw_overlay *overlay,
                           const rw_geometry *g, void *scratch, size_t length)
{
    rw_status status = validate(base, overlay, g, scratch, length);
    if (status != RW_OK) return status;
    if (length < (size_t)g->block_size * 4 ||
        g->overlay_limit < (uint64_t)g->block_size * 6) return RW_INVALID;
    return RW_OK;
}

static int image_header2_valid(uint8_t *header, uint32_t bs)
{
    return bytes_equal(header, (const uint8_t *)"RWINCOW2", 8) &&
           get32(header + 8) == 2 && header_crc_valid(header, bs, 56);
}

static rw_status write_headers2(const rw_overlay *overlay, const rw_geometry *g,
                                uint8_t *header, int publish)
{
    unsigned copy;
    bytes_zero(header, g->block_size);
    bytes_copy(header, (const uint8_t *)(publish ? "RWINCOW2" : "RWINPART"), 8);
    put32(header + 8, 2);
    put32(header + 12, g->block_size);
    put64(header + 16, g->block_count);
    bytes_copy(header + 24, g->baseline_id, 32);
    put32(header + 56, crc32(header, g->block_size));
    for (copy = 0; copy < 2; ++copy) {
        if (overlay->write(overlay->user, (uint64_t)copy * g->block_size,
                           header, g->block_size) ||
            overlay->flush(overlay->user)) return RW_IO;
    }
    return RW_OK;
}

rw_status rw2_format(const rw_source *base, const rw_overlay *overlay,
                     const rw_geometry *g, void *scratch, size_t scratch_bytes)
{
    uint64_t length;
    rw_status status = validate2(base, overlay, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    if (overlay->size(overlay->user, &length)) return RW_IO;
    if (length) return RW_EXISTS;
    return write_headers2(overlay, g, scratch, 1);
}

static int record2_valid(uint8_t *frame, uint32_t bs, uint64_t blocks,
                         uint64_t sequence)
{
    return bytes_equal(frame, (const uint8_t *)"RWFRAME2", 8) &&
           header_crc_valid(frame, bs, 28) && sequence != 0 &&
           get64(frame + 8) == sequence && get64(frame + 16) < blocks &&
           get32(frame + 24) == crc32(frame + bs, bs);
}

static rw_status write_pair2(const rw_overlay *overlay, uint64_t offset,
                             uint32_t bs, const uint8_t *frame)
{
    unsigned copy;
    for (copy = 0; copy < 2; ++copy) {
        uint64_t start = offset + (uint64_t)copy * bs * 2;
        if (overlay->write(overlay->user, start, frame, bs) ||
            overlay->write(overlay->user, start + bs, frame + bs, bs) ||
            overlay->flush(overlay->user)) return RW_IO;
    }
    return RW_OK;
}

/* A full scan happens before any recovery output is written, and again while
 * copying. Sources must remain immutable/exclusive throughout both passes.
 * strict=1 requires both copies; recovery never publishes an incomplete pair
 * unless at least one complete copy has a valid sequence and both CRCs. */
static rw_status scan2(const rw_overlay *overlay, const rw_geometry *g,
                       uint8_t *scratch, int strict, uint64_t *map,
                       const rw_overlay *replacement,
                       rw2_recovery_report *result)
{
    uint64_t length, offset, sequence = 1;
    uint32_t bs = g->block_size;
    uint8_t *a = scratch, *b = scratch + (size_t)bs * 2;
    int a_valid, b_valid;
    rw2_recovery_report report = {0};
    if (overlay->size(overlay->user, &length)) return RW_IO;
    if (length > g->overlay_limit) return RW_LIMIT;
    if (length < bs) return RW_CORRUPT;
    if (overlay->read(overlay->user, 0, a, bs)) return RW_IO;
    a_valid = image_header2_valid(a, bs);
    b_valid = 0;
    if (length >= (uint64_t)bs * 2) {
        if (overlay->read(overlay->user, bs, b, bs)) return RW_IO;
        b_valid = image_header2_valid(b, bs);
    }
    if ((!a_valid && !b_valid) || (strict && (!a_valid || !b_valid)))
        return RW_CORRUPT;
    if (a_valid && b_valid && !bytes_equal(a, b, bs)) return RW_CORRUPT;
    {
        const uint8_t *header = a_valid ? a : b;
        if (get32(header + 12) != bs || get64(header + 16) != g->block_count ||
            !bytes_equal(header + 24, g->baseline_id, 32)) return RW_BASE_MISMATCH;
    }
    report.repaired_header_copies = (uint64_t)(!a_valid) + (uint64_t)(!b_valid);
    report.source_bytes = length;
    offset = (uint64_t)bs * 2;
    while (offset < length) {
        uint64_t remaining = length - offset;
        size_t count = remaining >= (uint64_t)bs * 4 ? (size_t)bs * 4 : (size_t)remaining;
        const uint8_t *chosen;
        rw_status status;
        if (overlay->read(overlay->user, offset, scratch, count)) return RW_IO;
        a_valid = remaining >= (uint64_t)bs * 2 &&
                  record2_valid(a, bs, g->block_count, sequence);
        b_valid = remaining >= (uint64_t)bs * 4 &&
                  record2_valid(b, bs, g->block_count, sequence);
        if (!a_valid && !b_valid) {
            if (!strict && remaining < (uint64_t)bs * 4) {
                /* Under the durable-length contract this last short pair
                 * cannot have been acknowledged. Never skip a full pair. */
                report.discarded_tail_bytes = remaining;
                break;
            }
            return RW_CORRUPT;
        }
        if (strict && (!a_valid || !b_valid)) return RW_CORRUPT;
        if (a_valid && b_valid && !bytes_equal(a, b, (size_t)bs * 2))
            return RW_CORRUPT;
        chosen = a_valid ? a : b;
        if (map) map[get64(chosen + 16)] = offset + bs;
        if (replacement) {
            status = write_pair2(replacement, offset, bs, chosen);
            if (status != RW_OK) return status;
        }
        report.repaired_record_copies += (uint64_t)(!a_valid) + (uint64_t)(!b_valid);
        ++report.recovered_records;
        ++sequence;
        offset += (uint64_t)bs * 4;
    }
    report.replacement_bytes = (uint64_t)bs * 2 + report.recovered_records * bs * 4;
    *result = report;
    return RW_OK;
}

rw_status rw2_mount(rw_context *ctx, const rw_source *base,
                    const rw_overlay *overlay, const rw_geometry *g,
                    uint64_t *map, size_t map_entries, void *scratch,
                    size_t scratch_bytes)
{
    size_t i;
    rw2_recovery_report report;
    rw_status status;
    if (!ctx) return RW_INVALID;
    ctx->ready = 0;
    status = validate2(base, overlay, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    if (!map || g->block_count > SIZE_MAX / sizeof(*map) ||
        map_entries < g->block_count) return RW_INVALID;
    for (i = 0; i < (size_t)g->block_count; ++i) map[i] = 0;
    status = scan2(overlay, g, scratch, 1, map, NULL, &report);
    if (status != RW_OK) return status;
    ctx->base = *base;
    ctx->overlay = *overlay;
    ctx->geometry = *g;
    ctx->map = map;
    ctx->scratch = scratch;
    ctx->end = report.replacement_bytes;
    ctx->next_sequence = report.recovered_records + 1;
    ctx->format_version = 2;
    ctx->ready = 1;
    return RW_OK;
}

rw_status rw2_read(rw_context *ctx, uint64_t block, void *output)
{
    uint64_t offset, sequence;
    uint32_t bs;
    uint8_t *a, *b, *data;
    if (!ctx || !ctx->ready || ctx->format_version != 2) return RW_NOT_READY;
    if (!output || block >= ctx->geometry.block_count) return RW_INVALID;
    bs = ctx->geometry.block_size;
    a = ctx->scratch;
    b = a + (size_t)bs * 2;
    data = a + bs;
    offset = ctx->map[block];
    if (!offset) {
        if (ctx->base.read(ctx->base.user, block * bs, data, bs)) return poison(ctx, RW_IO);
    } else {
        if (ctx->overlay.read(ctx->overlay.user, offset - bs, a, (size_t)bs * 4))
            return poison(ctx, RW_IO);
        sequence = get64(a + 8);
        if (sequence >= ctx->next_sequence ||
            !record2_valid(a, bs, ctx->geometry.block_count, sequence) ||
            !record2_valid(b, bs, ctx->geometry.block_count, sequence) ||
            get64(a + 16) != block || !bytes_equal(a, b, (size_t)bs * 2))
            return poison(ctx, RW_CORRUPT);
    }
    bytes_copy(output, data, bs);
    return RW_OK;
}

rw_status rw2_write(rw_context *ctx, uint64_t block, const void *input)
{
    uint32_t bs;
    uint8_t *header, *data;
    rw_status status;
    if (!ctx || !ctx->ready || ctx->format_version != 2) return RW_NOT_READY;
    if (!input || block >= ctx->geometry.block_count) return RW_INVALID;
    bs = ctx->geometry.block_size;
    if ((uint64_t)bs * 4 > ctx->geometry.overlay_limit - ctx->end ||
        ctx->next_sequence == UINT64_MAX) return RW_LIMIT;
    header = ctx->scratch;
    data = header + bs;
    bytes_copy(data, input, bs);
    bytes_zero(header, bs);
    bytes_copy(header, (const uint8_t *)"RWFRAME2", 8);
    put64(header + 8, ctx->next_sequence);
    put64(header + 16, block);
    put32(header + 24, crc32(data, bs));
    put32(header + 28, crc32(header, bs));
    status = write_pair2(&ctx->overlay, ctx->end, bs, header);
    if (status != RW_OK) return poison(ctx, status);
    ctx->map[block] = ctx->end + bs;
    ctx->end += (uint64_t)bs * 4;
    ++ctx->next_sequence;
    return RW_OK;
}

rw_status rw2_recover(const rw_source *base, const rw_overlay *source,
                      const rw_overlay *replacement, const rw_geometry *g,
                      void *scratch, size_t scratch_bytes,
                      rw2_recovery_report *report)
{
    uint64_t length;
    rw2_recovery_report checked, copied;
    rw_status status;
    if (!report) return RW_INVALID;
    *report = (rw2_recovery_report){0};
    status = validate2(base, source, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    status = validate2(base, replacement, g, scratch, scratch_bytes);
    if (status != RW_OK) return status;
    if (source->user == replacement->user) return RW_INVALID;
    if (replacement->size(replacement->user, &length)) return RW_IO;
    if (length) return RW_EXISTS;
    status = scan2(source, g, scratch, 0, NULL, NULL, &checked);
    if (status != RW_OK) return status;
    /* Incomplete exports have no valid v2 header and cannot be mounted. */
    status = write_headers2(replacement, g, scratch, 0);
    if (status != RW_OK) return status;
    status = scan2(source, g, scratch, 0, NULL, replacement, &copied);
    if (status != RW_OK) return status;
    if (checked.recovered_records != copied.recovered_records ||
        checked.source_bytes != copied.source_bytes ||
        checked.discarded_tail_bytes != copied.discarded_tail_bytes)
        return RW_CORRUPT;
    status = write_headers2(replacement, g, scratch, 1);
    if (status != RW_OK) return status;
    *report = copied;
    return RW_OK;
}
