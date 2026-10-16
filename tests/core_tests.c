#define _POSIX_C_SOURCE 200809L
#include "restorewin.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <unistd.h>
#endif

#define CAPACITY (128U * 1024U)
#define BLOCKS 8U
#define CHECK(x) do { if (!(x)) { \
    fprintf(stderr, "FAIL at %s:%d: %s\n", __FILE__, __LINE__, #x); \
    exit(EXIT_FAILURE); } } while (0)

typedef struct {
    uint8_t bytes[CAPACITY];
    uint8_t durable[CAPACITY];
    uint64_t length;
    uint64_t durable_length;
    size_t fail_after;
    int fail_flush;
    int fail_read;
    unsigned writes;
    unsigned flushes;
    unsigned fail_flush_at;
} memory_store;

typedef struct {
    memory_store base_store;
    memory_store delta_store;
    rw_source base;
    rw_overlay delta;
    rw_geometry geometry;
    rw_context context;
    uint64_t map[BLOCKS];
    uint8_t scratch[16384];
} fixture;

static int memory_read(void *user, uint64_t offset, void *out, size_t size)
{
    memory_store *s = user;
    if (s->fail_read || offset > s->length || size > s->length - offset) return -1;
    memcpy(out, s->bytes + (size_t)offset, size);
    return 0;
}

static int memory_write(void *user, uint64_t offset, const void *in, size_t size)
{
    memory_store *s = user;
    size_t count = size;
    ++s->writes;
    if (offset > CAPACITY || size > CAPACITY - offset) return -1;
    if (s->fail_after < count) count = s->fail_after;
    memcpy(s->bytes + (size_t)offset, in, count);
    if (offset + count > s->length) s->length = offset + count;
    if (s->fail_after != SIZE_MAX) s->fail_after -= count;
    return count == size ? 0 : -1;
}

static int memory_size(void *user, uint64_t *out)
{
    memory_store *s = user;
    *out = s->length;
    return 0;
}

static int memory_flush(void *user)
{
    memory_store *s = user;
    ++s->flushes;
    if (s->fail_flush || s->flushes == s->fail_flush_at) return -1;
    memcpy(s->durable, s->bytes, (size_t)s->length);
    s->durable_length = s->length;
    return 0;
}

static void power_loss(memory_store *s)
{
    memcpy(s->bytes, s->durable, (size_t)s->durable_length);
    memset(s->bytes + (size_t)s->durable_length, 0,
           CAPACITY - (size_t)s->durable_length);
    s->length = s->durable_length;
    s->fail_after = SIZE_MAX;
    s->fail_flush = 0;
    s->fail_flush_at = 0;
}

static fixture *fixture_new(uint32_t bs)
{
    fixture *f = calloc(1, sizeof(*f));
    unsigned i;
    CHECK(f != NULL);
    f->base_store.fail_after = SIZE_MAX;
    f->delta_store.fail_after = SIZE_MAX;
    f->base_store.length = (uint64_t)bs * BLOCKS;
    for (i = 0; i < BLOCKS; ++i)
        memset(f->base_store.bytes + (size_t)i * bs, (int)(0x10U + i), bs);
    CHECK(memory_flush(&f->base_store) == 0);
    f->base = (rw_source){&f->base_store, memory_read, memory_size};
    f->delta = (rw_overlay){&f->delta_store, memory_read, memory_write,
                            memory_size, memory_flush};
    f->geometry.block_size = bs;
    f->geometry.block_count = BLOCKS;
    /* A deterministic test identity, not a claimed SHA-256 implementation. */
    memset(f->geometry.baseline_id, 0x42, sizeof(f->geometry.baseline_id));
    f->geometry.overlay_limit = CAPACITY;
    return f;
}

static rw_status mount_fixture(fixture *f)
{
    return rw_mount(&f->context, &f->base, &f->delta, &f->geometry,
                    f->map, BLOCKS, f->scratch, sizeof(f->scratch));
}

static void prepare(fixture *f)
{
    CHECK(rw_format(&f->base, &f->delta, &f->geometry,
                     f->scratch, sizeof(f->scratch)) == RW_OK);
    CHECK(mount_fixture(f) == RW_OK);
}

static void expect_block(fixture *f, uint64_t block, uint8_t value)
{
    uint8_t out[4096];
    size_t i;
    memset(out, 0xFF, sizeof(out));
    CHECK(rw_read(&f->context, block, out) == RW_OK);
    for (i = 0; i < f->geometry.block_size; ++i) CHECK(out[i] == value);
}

static void expect_unchanged_base(fixture *f)
{
    CHECK(f->base_store.writes == 0);
    CHECK(f->base_store.length == f->base_store.durable_length);
    CHECK(memcmp(f->base_store.bytes, f->base_store.durable,
                 (size_t)f->base_store.length) == 0);
}

static void test_geometry_and_replay(void)
{
    const uint32_t sizes[] = {512, 4096};
    size_t n;
    for (n = 0; n < sizeof(sizes) / sizeof(sizes[0]); ++n) {
        fixture *f = fixture_new(sizes[n]);
        uint8_t data[4096];
        unsigned block;
        prepare(f);
        for (block = 0; block < BLOCKS; ++block)
            expect_block(f, block, (uint8_t)(0x10U + block));
        memset(data, 0xAA, sizeof(data));
        CHECK(rw_write(&f->context, 0, data) == RW_OK);
        memset(data, 0xBB, sizeof(data));
        CHECK(rw_write(&f->context, 3, data) == RW_OK);
        memset(data, 0xCC, sizeof(data));
        CHECK(rw_write(&f->context, 0, data) == RW_OK);
        rw_close(&f->context);
        power_loss(&f->delta_store);
        CHECK(mount_fixture(f) == RW_OK);
        expect_block(f, 0, 0xCC);
        expect_block(f, 3, 0xBB);
        expect_block(f, 7, 0x17);
        expect_unchanged_base(f);
        free(f);
    }
}

static void test_format_refuses_overwrite(void)
{
    fixture *f = fixture_new(512);
    unsigned writes;
    prepare(f);
    writes = f->delta_store.writes;
    CHECK(rw_format(&f->base, &f->delta, &f->geometry,
                     f->scratch, sizeof(f->scratch)) == RW_EXISTS);
    CHECK(f->delta_store.writes == writes);
    expect_block(f, 0, 0x10);
    free(f);
}

static void test_fresh_offline_overlay_restores_baseline(void)
{
    fixture *f = fixture_new(4096);
    memory_store *new_store = calloc(1, sizeof(*new_store));
    rw_overlay original, replacement;
    uint8_t data[4096];
    CHECK(new_store != NULL);
    new_store->fail_after = SIZE_MAX;
    prepare(f);
    memset(data, 0xEE, sizeof(data));
    CHECK(rw_write(&f->context, 2, data) == RW_OK);
    rw_close(&f->context);
    original = f->delta;
    replacement = (rw_overlay){new_store, memory_read, memory_write,
                               memory_size, memory_flush};
    f->delta = replacement;
    prepare(f);
    expect_block(f, 2, 0x12);
    rw_close(&f->context);
    f->delta = original;
    CHECK(mount_fixture(f) == RW_OK);
    expect_block(f, 2, 0xEE);
    expect_unchanged_base(f);
    free(new_store);
    free(f);
}

static void test_partial_write_and_power_loss(void)
{
    const size_t fail_points[] = {0, 20, 512 + 100};
    size_t n;
    for (n = 0; n < sizeof(fail_points) / sizeof(fail_points[0]); ++n) {
        fixture *f = fixture_new(512);
        uint8_t data[512];
        prepare(f);
        memset(data, 0xA1, sizeof(data));
        CHECK(rw_write(&f->context, 0, data) == RW_OK);
        f->delta_store.fail_after = fail_points[n];
        memset(data, 0xB2, sizeof(data));
        CHECK(rw_write(&f->context, 1, data) == RW_IO);
        CHECK(rw_read(&f->context, 0, data) == RW_NOT_READY);
        CHECK(rw_write(&f->context, 0, data) == RW_NOT_READY);
        power_loss(&f->delta_store);
        CHECK(mount_fixture(f) == RW_OK);
        expect_block(f, 0, 0xA1);
        expect_block(f, 1, 0x11);
        expect_unchanged_base(f);
        free(f);
    }
}

static void test_failed_flush_does_not_publish_write(void)
{
    fixture *f = fixture_new(4096);
    uint8_t data[4096];
    prepare(f);
    memset(data, 0xA3, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    f->delta_store.fail_flush = 1;
    memset(data, 0xB4, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_IO);
    CHECK(!f->context.ready);
    power_loss(&f->delta_store);
    CHECK(mount_fixture(f) == RW_OK);
    expect_block(f, 0, 0xA3);
    expect_unchanged_base(f);
    free(f);
}

static void test_persisted_torn_tail_has_no_baseline_fallback(void)
{
    fixture *f = fixture_new(512);
    uint8_t data[512];
    prepare(f);
    memset(data, 0xA5, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    f->delta_store.fail_after = 512 + 100;
    CHECK(rw_write(&f->context, 1, data) == RW_IO);
    /* Simulate a device persisting part of an unacknowledged write. */
    CHECK(memory_flush(&f->delta_store) == 0);
    power_loss(&f->delta_store);
    CHECK(mount_fixture(f) == RW_CORRUPT);
    CHECK(rw_read(&f->context, 0, data) == RW_NOT_READY);
    expect_unchanged_base(f);
    free(f);
}

static void test_unacknowledged_complete_frame_may_survive(void)
{
    fixture *f = fixture_new(512);
    uint8_t data[512];
    prepare(f);
    memset(data, 0xD1, sizeof(data));
    f->delta_store.fail_flush = 1;
    CHECK(rw_write(&f->context, 0, data) == RW_IO);
    CHECK(!f->context.ready);
    /* A failed flush does not imply that the device saved no bytes. */
    f->delta_store.fail_flush = 0;
    CHECK(memory_flush(&f->delta_store) == 0);
    power_loss(&f->delta_store);
    CHECK(mount_fixture(f) == RW_OK);
    expect_block(f, 0, 0xD1);
    expect_unchanged_base(f);
    free(f);
}

static void test_corruption_is_rejected_on_replay(void)
{
    fixture *f = fixture_new(512);
    uint8_t data[512];
    prepare(f);
    memset(data, 0xA6, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    memset(data, 0xB6, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    /* Even an obsolete record is checked; damaged history is not skipped. */
    f->delta_store.bytes[2U * 512U + 10U] ^= 1U;
    CHECK(mount_fixture(f) == RW_CORRUPT);
    CHECK(!f->context.ready);
    expect_unchanged_base(f);
    free(f);
}

static void test_corruption_after_mount_does_not_return_bad_data(void)
{
    fixture *f = fixture_new(4096);
    uint8_t data[4096];
    size_t i;
    prepare(f);
    memset(data, 0xA7, sizeof(data));
    CHECK(rw_write(&f->context, 2, data) == RW_OK);
    f->delta_store.bytes[(size_t)f->map[2] + 20] ^= 1U;
    memset(data, 0x99, sizeof(data));
    CHECK(rw_read(&f->context, 2, data) == RW_CORRUPT);
    for (i = 0; i < sizeof(data); ++i) CHECK(data[i] == 0x99);
    CHECK(rw_read(&f->context, 0, data) == RW_NOT_READY);
    free(f);
}

static void test_capacity_and_bounds(void)
{
    fixture *f = fixture_new(512);
    uint8_t data[512];
    uint64_t length;
    f->geometry.overlay_limit = 3U * 512U;
    prepare(f);
    memset(data, 0xA8, sizeof(data));
    CHECK(rw_write(&f->context, BLOCKS, data) == RW_INVALID);
    CHECK(rw_read(&f->context, UINT64_MAX, data) == RW_INVALID);
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    length = f->delta_store.length;
    CHECK(rw_write(&f->context, 1, data) == RW_LIMIT);
    CHECK(f->delta_store.length == length);
    expect_block(f, 0, 0xA8);
    expect_block(f, 1, 0x11);
    expect_unchanged_base(f);
    free(f);
}

static void test_mismatched_baseline_and_invalid_geometry(void)
{
    fixture *f = fixture_new(512);
    prepare(f);
    f->geometry.baseline_id[0] ^= 1U;
    CHECK(mount_fixture(f) == RW_BASE_MISMATCH);
    f->geometry.baseline_id[0] ^= 1U;
    f->base_store.length -= 512;
    CHECK(mount_fixture(f) == RW_BASE_MISMATCH);
    f->base_store.length += 512;
    f->geometry.block_size = 1024;
    CHECK(mount_fixture(f) == RW_INVALID);
    f->geometry.block_size = 512;
    f->geometry.block_count = UINT64_MAX;
    CHECK(mount_fixture(f) == RW_INVALID);
    f->geometry.block_count = BLOCKS;
    CHECK(rw_mount(&f->context, &f->base, &f->delta, &f->geometry,
                    f->map, BLOCKS - 1, f->scratch, sizeof(f->scratch)) == RW_INVALID);
    CHECK(rw_mount(&f->context, &f->base, &f->delta, &f->geometry,
                    f->map, BLOCKS, f->scratch, 512) == RW_INVALID);
    free(f);
}

static void test_header_corruption_and_empty_overlay(void)
{
    fixture *f = fixture_new(512);
    CHECK(mount_fixture(f) == RW_CORRUPT);
    prepare(f);
    f->delta_store.bytes[24] ^= 1U;
    CHECK(mount_fixture(f) == RW_CORRUPT);
    CHECK(!f->context.ready);
    free(f);
}

static void test_read_failure_and_closed_context(void)
{
    fixture *f = fixture_new(512);
    uint8_t data[512];
    prepare(f);
    f->base_store.fail_read = 1;
    CHECK(rw_read(&f->context, 0, data) == RW_IO);
    CHECK(!f->context.ready);
    f->base_store.fail_read = 0;
    CHECK(mount_fixture(f) == RW_OK);
    memset(data, 0xA9, sizeof(data));
    CHECK(rw_write(&f->context, 0, data) == RW_OK);
    f->delta_store.fail_read = 1;
    CHECK(rw_read(&f->context, 0, data) == RW_IO);
    f->delta_store.fail_read = 0;
    CHECK(mount_fixture(f) == RW_OK);
    rw_close(&f->context);
    CHECK(rw_read(&f->context, 0, data) == RW_NOT_READY);
    CHECK(rw_write(&f->context, 0, data) == RW_NOT_READY);
    expect_unchanged_base(f);
    free(f);
}

#ifndef _WIN32
static int file_read(void *user, uint64_t offset, void *out, size_t size)
{
    FILE *file = user;
    if (offset > INT64_MAX || fseeko(file, (off_t)offset, SEEK_SET)) return -1;
    return fread(out, 1, size, file) == size ? 0 : -1;
}

static int file_write(void *user, uint64_t offset, const void *in, size_t size)
{
    FILE *file = user;
    if (offset > INT64_MAX || fseeko(file, (off_t)offset, SEEK_SET)) return -1;
    return fwrite(in, 1, size, file) == size ? 0 : -1;
}

static int file_size(void *user, uint64_t *out)
{
    FILE *file = user;
    off_t length;
    if (fseeko(file, 0, SEEK_END)) return -1;
    length = ftello(file);
    if (length < 0) return -1;
    *out = (uint64_t)length;
    return 0;
}

static int file_flush(void *user)
{
    FILE *file = user;
    return fflush(file) || fsync(fileno(file)) ? -1 : 0;
}

static void test_file_backed_reopen(void)
{
    char base_path[] = "/tmp/restorewin-test-base-XXXXXX";
    char overlay_path[] = "/tmp/restorewin-test-overlay-XXXXXX";
    int base_fd = mkstemp(base_path), overlay_fd = mkstemp(overlay_path);
    FILE *base_file, *overlay_file;
    rw_source base;
    rw_overlay overlay;
    rw_geometry g = {0};
    rw_context ctx = {0};
    uint8_t scratch[8192], data[4096], output[4096];
    uint64_t map[BLOCKS];
    unsigned i;
    CHECK(base_fd >= 0 && overlay_fd >= 0);
    base_file = fdopen(base_fd, "w+b");
    overlay_file = fdopen(overlay_fd, "w+b");
    CHECK(base_file && overlay_file);
    memset(data, 0x35, sizeof(data));
    for (i = 0; i < BLOCKS; ++i) CHECK(fwrite(data, 1, sizeof(data), base_file) == sizeof(data));
    CHECK(file_flush(base_file) == 0);
    CHECK(fclose(base_file) == 0);
    base_file = fopen(base_path, "rb");
    CHECK(base_file);
    base = (rw_source){base_file, file_read, file_size};
    overlay = (rw_overlay){overlay_file, file_read, file_write, file_size, file_flush};
    g.block_size = 4096;
    g.block_count = BLOCKS;
    g.overlay_limit = CAPACITY;
    memset(g.baseline_id, 0x42, sizeof(g.baseline_id));
    CHECK(rw_format(&base, &overlay, &g, scratch, sizeof(scratch)) == RW_OK);
    CHECK(rw_mount(&ctx, &base, &overlay, &g, map, BLOCKS, scratch, sizeof(scratch)) == RW_OK);
    memset(data, 0xCD, sizeof(data));
    CHECK(rw_write(&ctx, 4, data) == RW_OK);
    rw_close(&ctx);
    CHECK(fclose(overlay_file) == 0);
    overlay_file = fopen(overlay_path, "r+b");
    CHECK(overlay_file);
    overlay.user = overlay_file;
    CHECK(rw_mount(&ctx, &base, &overlay, &g, map, BLOCKS, scratch, sizeof(scratch)) == RW_OK);
    CHECK(rw_read(&ctx, 4, output) == RW_OK);
    CHECK(memcmp(output, data, sizeof(data)) == 0);
    CHECK(file_read(base_file, 4U * 4096U, output, sizeof(output)) == 0);
    for (i = 0; i < sizeof(output); ++i) CHECK(output[i] == 0x35);
    rw_close(&ctx);
    CHECK(fclose(base_file) == 0 && fclose(overlay_file) == 0);
    CHECK(unlink(base_path) == 0 && unlink(overlay_path) == 0);
}
#endif

static rw_status mount_fixture2(fixture *f)
{
    return rw2_mount(&f->context, &f->base, &f->delta, &f->geometry,
                     f->map, BLOCKS, f->scratch, sizeof(f->scratch));
}

static void prepare2(fixture *f)
{
    CHECK(rw2_format(&f->base, &f->delta, &f->geometry,
                      f->scratch, sizeof(f->scratch)) == RW_OK);
    CHECK(mount_fixture2(f) == RW_OK);
}

static void expect_block2(fixture *f, uint64_t block, uint8_t value)
{
    uint8_t out[4096];
    size_t i;
    CHECK(rw2_read(&f->context, block, out) == RW_OK);
    for (i = 0; i < f->geometry.block_size; ++i) CHECK(out[i] == value);
}

static memory_store *recover_fixture2(fixture *f, rw2_recovery_report *report)
{
    memory_store *store = calloc(1, sizeof(*store));
    rw_overlay target;
    unsigned writes = f->delta_store.writes, flushes = f->delta_store.flushes;
    uint64_t length = f->delta_store.length;
    CHECK(store != NULL);
    store->fail_after = SIZE_MAX;
    target = (rw_overlay){store, memory_read, memory_write, memory_size, memory_flush};
    rw_close(&f->context);
    CHECK(rw2_recover(&f->base, &f->delta, &target, &f->geometry,
                       f->scratch, sizeof(f->scratch), report) == RW_OK);
    CHECK(f->delta_store.writes == writes && f->delta_store.flushes == flushes);
    CHECK(f->delta_store.length == length);
    expect_unchanged_base(f);
    return store;
}

static void mount_replacement2(fixture *f, memory_store *store)
{
    power_loss(store);
    f->delta = (rw_overlay){store, memory_read, memory_write, memory_size, memory_flush};
    CHECK(mount_fixture2(f) == RW_OK);
}

static void test_v2_geometry_replay_and_api_separation(void)
{
    const uint32_t sizes[] = {512, 4096};
    size_t n;
    for (n = 0; n < sizeof(sizes) / sizeof(sizes[0]); ++n) {
        fixture *f = fixture_new(sizes[n]);
        uint8_t data[4096];
        prepare2(f);
        expect_block2(f, 0, 0x10);
        CHECK(rw_write(&f->context, 0, data) == RW_NOT_READY);
        CHECK(rw_read(&f->context, 0, data) == RW_NOT_READY);
        memset(data, 0xA1, sizeof(data));
        CHECK(rw2_write(&f->context, 3, data) == RW_OK);
        memset(data, 0xB2, sizeof(data));
        CHECK(rw2_write(&f->context, 3, data) == RW_OK);
        rw_close(&f->context);
        power_loss(&f->delta_store);
        CHECK(mount_fixture2(f) == RW_OK);
        expect_block2(f, 3, 0xB2);
        expect_block2(f, 7, 0x17);
        CHECK(rw2_read(&f->context, BLOCKS, data) == RW_INVALID);
        CHECK(rw2_write(&f->context, BLOCKS, data) == RW_INVALID);
        CHECK(rw2_read(&f->context, 0, NULL) == RW_INVALID);
        rw_close(&f->context);
        CHECK(rw2_write(&f->context, 0, data) == RW_NOT_READY);
        expect_unchanged_base(f);
        free(f);
    }
}

static void check_v2_interrupted_write(uint32_t bs, size_t cut, int persist_tail)
{
    fixture *f = fixture_new(bs);
    memory_store *recovered;
    rw2_recovery_report report;
    uint8_t data[4096];
    uint64_t acknowledged_length;
    prepare2(f);
    memset(data, 0xA3, sizeof(data));
    CHECK(rw2_write(&f->context, 0, data) == RW_OK);
    acknowledged_length = f->delta_store.length;
    f->delta_store.fail_after = cut;
    memset(data, 0xB4, sizeof(data));
    if (cut < (size_t)bs * 4) {
        CHECK(rw2_write(&f->context, 1, data) == RW_IO);
        CHECK(!f->context.ready);
        CHECK(rw2_read(&f->context, 0, data) == RW_NOT_READY);
    } else {
        CHECK(rw2_write(&f->context, 1, data) == RW_OK);
    }
    if (persist_tail) CHECK(memory_flush(&f->delta_store) == 0);
    power_loss(&f->delta_store);
    if (f->delta_store.length == acknowledged_length || cut == (size_t)bs * 4)
        CHECK(mount_fixture2(f) == RW_OK);
    else
        CHECK(mount_fixture2(f) == RW_CORRUPT);
    recovered = recover_fixture2(f, &report);
    CHECK(report.recovered_records == (cut >= (size_t)bs * 2 ? 2U : 1U));
    if (cut < (size_t)bs * 2) {
        CHECK(report.discarded_tail_bytes == (persist_tail ? (uint64_t)cut : 0));
    } else {
        CHECK(report.discarded_tail_bytes == 0);
    }
    mount_replacement2(f, recovered);
    expect_block2(f, 0, 0xA3);
    expect_block2(f, 1, cut >= (size_t)bs * 2 ? 0xB4 : 0x11);
    CHECK(memcmp(f->delta_store.bytes, f->delta_store.durable,
                 (size_t)f->delta_store.length) == 0);
    /* Recovered images must accept new durable writes without stale tails. */
    memset(data, 0xC5, sizeof(data));
    CHECK(rw2_write(&f->context, 2, data) == RW_OK);
    rw_close(&f->context);
    power_loss(recovered);
    CHECK(mount_fixture2(f) == RW_OK);
    expect_block2(f, 0, 0xA3);
    expect_block2(f, 2, 0xC5);
    free(recovered);
    free(f);
}

static void test_v2_all_512_byte_record_cuts(void)
{
    size_t cut;
    int persist;
    for (persist = 0; persist < 2; ++persist)
        for (cut = 0; cut <= 512U * 4; ++cut)
            check_v2_interrupted_write(512, cut, persist);
}

static void test_v2_4096_byte_record_boundaries(void)
{
    const size_t cuts[] = {0, 1, 20, 511, 512, 4095, 4096, 4097, 8191,
                           8192, 8193, 12287, 12288, 12289, 16383, 16384};
    size_t n;
    int persist;
    for (persist = 0; persist < 2; ++persist)
        for (n = 0; n < sizeof(cuts) / sizeof(cuts[0]); ++n)
            check_v2_interrupted_write(4096, cuts[n], persist);
}

static void test_v2_format_interruptions(void)
{
    size_t cut;
    for (cut = 0; cut <= 1024; ++cut) {
        fixture *f = fixture_new(512);
        memory_store *target = calloc(1, sizeof(*target));
        rw_overlay replacement;
        rw2_recovery_report report;
        CHECK(target != NULL);
        target->fail_after = SIZE_MAX;
        replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
        f->delta_store.fail_after = cut;
        CHECK(rw2_format(&f->base, &f->delta, &f->geometry, f->scratch,
                          sizeof(f->scratch)) == (cut < 1024 ? RW_IO : RW_OK));
        CHECK(memory_flush(&f->delta_store) == 0);
        power_loss(&f->delta_store);
        if (cut < 512) {
            CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                               f->scratch, sizeof(f->scratch), &report) == RW_CORRUPT);
            CHECK(target->writes == 0 && report.recovered_records == 0);
        } else {
            CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                               f->scratch, sizeof(f->scratch), &report) == RW_OK);
            mount_replacement2(f, target);
            expect_block2(f, 0, 0x10);
        }
        expect_unchanged_base(f);
        free(target);
        free(f);
    }
}

static void test_v2_each_copy_can_be_recovered(void)
{
    const uint32_t sizes[] = {512, 4096};
    size_t n;
    unsigned damaged;
    for (n = 0; n < sizeof(sizes) / sizeof(sizes[0]); ++n) {
        /* Both image headers, each record header/data, including obsolete data. */
        for (damaged = 0; damaged < 10; ++damaged) {
            fixture *f = fixture_new(sizes[n]);
            memory_store *recovered;
            rw2_recovery_report report;
            uint8_t data[4096];
            prepare2(f);
            memset(data, 0xA6, sizeof(data));
            CHECK(rw2_write(&f->context, 0, data) == RW_OK);
            memset(data, 0xB7, sizeof(data));
            CHECK(rw2_write(&f->context, 0, data) == RW_OK);
            f->delta_store.bytes[(size_t)damaged * sizes[n] + 20] ^= 1U;
            CHECK(mount_fixture2(f) == RW_CORRUPT);
            recovered = recover_fixture2(f, &report);
            CHECK(report.recovered_records == 2);
            CHECK(report.repaired_header_copies == (damaged < 2 ? 1U : 0U));
            CHECK(report.repaired_record_copies == (damaged < 2 ? 0U : 1U));
            CHECK(report.discarded_tail_bytes == 0);
            mount_replacement2(f, recovered);
            expect_block2(f, 0, 0xB7);
            free(recovered);
            free(f);
        }
    }
}

static void test_v2_two_damaged_copies_refuse_recovery(void)
{
    unsigned damaged;
    for (damaged = 0; damaged < 3; ++damaged) {
        fixture *f = fixture_new(512);
        memory_store *target = calloc(1, sizeof(*target));
        rw_overlay replacement;
        rw2_recovery_report report;
        uint8_t data[512];
        CHECK(target != NULL);
        target->fail_after = SIZE_MAX;
        replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
        prepare2(f);
        memset(data, 0xA8, sizeof(data));
        CHECK(rw2_write(&f->context, 0, data) == RW_OK);
        memset(data, 0xB9, sizeof(data));
        CHECK(rw2_write(&f->context, 1, data) == RW_OK);
        if (damaged == 0) {
            f->delta_store.bytes[20] ^= 1U;
            f->delta_store.bytes[512U + 20] ^= 1U;
        } else {
            size_t start = (damaged == 1 ? 2U : 6U) * 512U;
            f->delta_store.bytes[start + 512U + 20] ^= 1U;
            f->delta_store.bytes[start + 3U * 512U + 20] ^= 1U;
        }
        CHECK(mount_fixture2(f) == RW_CORRUPT);
        CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                           f->scratch, sizeof(f->scratch), &report) == RW_CORRUPT);
        CHECK(target->length == 0 && target->writes == 0);
        CHECK(report.recovered_records == 0);
        expect_unchanged_base(f);
        free(target);
        free(f);
    }
}

static void test_v2_conflicting_valid_copies_refuse_recovery(void)
{
    fixture *f = fixture_new(512), *other = fixture_new(512);
    memory_store *target = calloc(1, sizeof(*target));
    rw_overlay replacement;
    rw2_recovery_report report;
    uint8_t data[512];
    CHECK(target != NULL);
    target->fail_after = SIZE_MAX;
    replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
    prepare2(f);
    prepare2(other);
    memset(data, 0xAA, sizeof(data));
    CHECK(rw2_write(&f->context, 0, data) == RW_OK);
    memset(data, 0xBB, sizeof(data));
    CHECK(rw2_write(&other->context, 0, data) == RW_OK);
    memcpy(f->delta_store.bytes + 4U * 512U, other->delta_store.bytes + 4U * 512U, 2U * 512U);
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_CORRUPT);
    CHECK(target->writes == 0);
    /* Independently valid headers with conflicting geometry are also ambiguous. */
    memcpy(f->delta_store.bytes + 4U * 512U, f->delta_store.bytes + 2U * 512U, 2U * 512U);
    other->delta_store.length = 0;
    other->geometry.baseline_id[0] ^= 1U;
    CHECK(rw2_format(&other->base, &other->delta, &other->geometry,
                      other->scratch, sizeof(other->scratch)) == RW_OK);
    memcpy(f->delta_store.bytes + 512U, other->delta_store.bytes + 512U, 512U);
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_CORRUPT);
    CHECK(target->writes == 0);
    free(target);
    free(other);
    free(f);
}

static void test_v2_runtime_corruption_and_io_poison_context(void)
{
    fixture *f = fixture_new(4096);
    memory_store *recovered;
    rw2_recovery_report report;
    uint8_t data[4096];
    size_t i;
    prepare2(f);
    memset(data, 0xCC, sizeof(data));
    CHECK(rw2_write(&f->context, 2, data) == RW_OK);
    f->delta_store.bytes[(size_t)f->map[2] + 2U * 4096U + 20U] ^= 1U;
    memset(data, 0xDD, sizeof(data));
    CHECK(rw2_read(&f->context, 2, data) == RW_CORRUPT);
    for (i = 0; i < sizeof(data); ++i) CHECK(data[i] == 0xDD);
    CHECK(rw2_read(&f->context, 0, data) == RW_NOT_READY);
    recovered = recover_fixture2(f, &report);
    mount_replacement2(f, recovered);
    expect_block2(f, 2, 0xCC);
    recovered->fail_read = 1;
    CHECK(rw2_read(&f->context, 2, data) == RW_IO);
    CHECK(!f->context.ready);
    recovered->fail_read = 0;
    CHECK(mount_fixture2(f) == RW_OK);
    f->base_store.fail_read = 1;
    CHECK(rw2_read(&f->context, 0, data) == RW_IO);
    CHECK(!f->context.ready);
    free(recovered);
    free(f);
}

static void test_v2_both_write_flush_failures(void)
{
    unsigned stage;
    int persist;
    for (stage = 1; stage <= 2; ++stage) for (persist = 0; persist < 2; ++persist) {
        fixture *f = fixture_new(512);
        memory_store *recovered;
        rw2_recovery_report report;
        uint8_t data[512];
        prepare2(f);
        memset(data, 0xAD, sizeof(data));
        CHECK(rw2_write(&f->context, 0, data) == RW_OK);
        f->delta_store.fail_flush_at = f->delta_store.flushes + stage;
        memset(data, 0xBE, sizeof(data));
        CHECK(rw2_write(&f->context, 1, data) == RW_IO);
        CHECK(!f->context.ready);
        if (persist) CHECK(memory_flush(&f->delta_store) == 0);
        power_loss(&f->delta_store);
        recovered = recover_fixture2(f, &report);
        mount_replacement2(f, recovered);
        expect_block2(f, 0, 0xAD);
        expect_block2(f, 1, (stage == 2 || persist) ? 0xBE : 0x11);
        free(recovered);
        free(f);
    }
}

static void test_v2_incomplete_exports_stay_unmountable(void)
{
    /* Export: 2 header writes, 4 record writes, 2 publishing writes. Every
     * byte boundary is covered at the 512-byte geometry, including publication. */
    size_t cut;
    for (cut = 0; cut <= 8U * 512U; ++cut) {
        fixture *f = fixture_new(512);
        memory_store *target = calloc(1, sizeof(*target));
        rw_overlay replacement;
        rw2_recovery_report report;
        uint8_t data[512];
        rw_status status;
        CHECK(target != NULL);
        target->fail_after = cut;
        replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
        prepare2(f);
        memset(data, 0xCF, sizeof(data));
        CHECK(rw2_write(&f->context, 0, data) == RW_OK);
        rw_close(&f->context);
        status = rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                             f->scratch, sizeof(f->scratch), &report);
        CHECK(status == (cut < 8U * 512U ? RW_IO : RW_OK));
        if (status != RW_OK) CHECK(report.recovered_records == 0);
        CHECK(memory_flush(target) == 0);
        power_loss(target);
        f->delta = replacement;
        status = mount_fixture2(f);
        if (status == RW_OK) {
            /* Any mountable publication must include all recovered data. */
            /* A short publication write can still produce a valid header
             * when the remaining reserved bytes already match. That is safe
             * only because every data record was flushed before publication. */
            CHECK(cut >= 6U * 512U);
            expect_block2(f, 0, 0xCF);
        } else { CHECK(status == RW_CORRUPT); }
        expect_unchanged_base(f);
        free(target);
        free(f);
    }
}

static void test_v2_recovery_flush_failures(void)
{
    unsigned stage;
    int persist;
    for (stage = 1; stage <= 6; ++stage) for (persist = 0; persist < 2; ++persist) {
        fixture *f = fixture_new(512);
        memory_store *target = calloc(1, sizeof(*target));
        rw_overlay replacement;
        rw2_recovery_report report;
        uint8_t data[512];
        CHECK(target != NULL);
        target->fail_after = SIZE_MAX;
        target->fail_flush_at = stage;
        replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
        prepare2(f);
        memset(data, 0xDF, sizeof(data));
        CHECK(rw2_write(&f->context, 0, data) == RW_OK);
        rw_close(&f->context);
        CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                           f->scratch, sizeof(f->scratch), &report) == RW_IO);
        CHECK(report.recovered_records == 0);
        if (persist) CHECK(memory_flush(target) == 0);
        power_loss(target);
        f->delta = replacement;
        if (stage == 6 && persist) {
            CHECK(mount_fixture2(f) == RW_OK);
            expect_block2(f, 0, 0xDF);
        } else { CHECK(mount_fixture2(f) == RW_CORRUPT); }
        expect_unchanged_base(f);
        free(target);
        free(f);
    }
}

static void test_v2_bounds_format_isolation_and_recovery_guards(void)
{
    fixture *f = fixture_new(512);
    memory_store *target = calloc(1, sizeof(*target));
    rw_overlay replacement;
    rw2_recovery_report report;
    uint8_t data[512];
    unsigned writes;
    CHECK(target != NULL);
    target->fail_after = SIZE_MAX;
    replacement = (rw_overlay){target, memory_read, memory_write, memory_size, memory_flush};
    prepare(f);
    CHECK(rw2_write(&f->context, 0, data) == RW_NOT_READY);
    CHECK(rw2_read(&f->context, 0, data) == RW_NOT_READY);
    CHECK(mount_fixture2(f) == RW_CORRUPT);
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_CORRUPT);
    CHECK(target->writes == 0);
    f->delta_store.length = 0;
    f->geometry.overlay_limit = 6U * 512U;
    prepare2(f);
    writes = f->delta_store.writes;
    CHECK(rw2_format(&f->base, &f->delta, &f->geometry,
                      f->scratch, sizeof(f->scratch)) == RW_EXISTS);
    CHECK(f->delta_store.writes == writes);
    CHECK(mount_fixture(f) == RW_CORRUPT);
    CHECK(mount_fixture2(f) == RW_OK);
    memset(data, 0xEF, sizeof(data));
    CHECK(rw2_write(&f->context, 0, data) == RW_OK);
    CHECK(rw2_write(&f->context, 1, data) == RW_LIMIT);
    expect_block2(f, 0, 0xEF);
    rw_close(&f->context);
    CHECK(rw2_recover(&f->base, &f->delta, &f->delta, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_INVALID);
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), NULL) == RW_INVALID);
    target->length = 1;
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_EXISTS);
    CHECK(target->writes == 0);
    target->length = 0;
    f->geometry.baseline_id[0] ^= 1U;
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_BASE_MISMATCH);
    CHECK(target->writes == 0);
    f->geometry.baseline_id[0] ^= 1U;
    CHECK(rw2_mount(&f->context, &f->base, &f->delta, &f->geometry,
                     f->map, BLOCKS - 1, f->scratch, sizeof(f->scratch)) == RW_INVALID);
    CHECK(rw2_mount(&f->context, &f->base, &f->delta, &f->geometry,
                     f->map, BLOCKS, f->scratch, 512U * 2) == RW_INVALID);
    f->delta_store.fail_read = 1;
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_IO);
    CHECK(target->writes == 0);
    expect_unchanged_base(f);
    free(target);
    free(f);
}

#ifndef _WIN32
static void test_v2_recovery_to_real_temporary_file(void)
{
    fixture *f = fixture_new(4096);
    char path[] = "/tmp/restorewin-v2-recovery-XXXXXX";
    int fd = mkstemp(path);
    FILE *file;
    rw_overlay replacement;
    rw2_recovery_report report;
    uint8_t data[4096];
    CHECK(fd >= 0);
    file = fdopen(fd, "w+b");
    CHECK(file != NULL);
    replacement = (rw_overlay){file, file_read, file_write, file_size, file_flush};
    prepare2(f);
    memset(data, 0xEC, sizeof(data));
    CHECK(rw2_write(&f->context, 4, data) == RW_OK);
    rw_close(&f->context);
    f->delta_store.bytes[3U * 4096U + 20] ^= 1U;
    CHECK(rw2_recover(&f->base, &f->delta, &replacement, &f->geometry,
                       f->scratch, sizeof(f->scratch), &report) == RW_OK);
    CHECK(report.repaired_record_copies == 1);
    CHECK(fclose(file) == 0);
    file = fopen(path, "r+b");
    CHECK(file != NULL);
    replacement.user = file;
    f->delta = replacement;
    CHECK(mount_fixture2(f) == RW_OK);
    expect_block2(f, 4, 0xEC);
    expect_block2(f, 3, 0x13);
    rw_close(&f->context);
    CHECK(fclose(file) == 0);
    CHECK(unlink(path) == 0);
    expect_unchanged_base(f);
    free(f);
}
#endif

int main(void)
{
    typedef void (*test_function)(void);
    const struct { const char *name; test_function run; } tests[] = {
        {"512/4096-byte geometry and persistent replay", test_geometry_and_replay},
        {"format refuses existing overlay", test_format_refuses_overwrite},
        {"offline fresh overlay restores baseline", test_fresh_offline_overlay_restores_baseline},
        {"partial writes and power loss", test_partial_write_and_power_loss},
        {"failed durability flush", test_failed_flush_does_not_publish_write},
        {"persisted torn tail refuses activation", test_persisted_torn_tail_has_no_baseline_fallback},
        {"unacknowledged complete frame may persist", test_unacknowledged_complete_frame_may_survive},
        {"corruption of obsolete record", test_corruption_is_rejected_on_replay},
        {"corruption after mount", test_corruption_after_mount_does_not_return_bad_data},
        {"capacity and block bounds", test_capacity_and_bounds},
        {"wrong baseline and invalid geometry", test_mismatched_baseline_and_invalid_geometry},
        {"corrupt header and empty overlay", test_header_corruption_and_empty_overlay},
        {"read failures and closed context", test_read_failure_and_closed_context},
#ifndef _WIN32
        {"real temporary files and reopen", test_file_backed_reopen},
#endif
        {"v2 geometry, replay and format API isolation", test_v2_geometry_replay_and_api_separation},
        {"v2 all 512-byte record cuts, both persistence outcomes", test_v2_all_512_byte_record_cuts},
        {"v2 4096-byte record boundaries", test_v2_4096_byte_record_boundaries},
        {"v2 all image header cuts", test_v2_format_interruptions},
        {"v2 recovery of each single damaged copy", test_v2_each_copy_can_be_recovered},
        {"v2 double-copy corruption refuses recovery", test_v2_two_damaged_copies_refuse_recovery},
        {"v2 conflicting valid copies refuse recovery", test_v2_conflicting_valid_copies_refuse_recovery},
        {"v2 runtime corruption and I/O stop reads", test_v2_runtime_corruption_and_io_poison_context},
        {"v2 first/second durability flush failures", test_v2_both_write_flush_failures},
        {"v2 all export cuts prevent incomplete publication", test_v2_incomplete_exports_stay_unmountable},
        {"v2 export flush failures", test_v2_recovery_flush_failures},
        {"v2 bounds, format isolation and recovery guards", test_v2_bounds_format_isolation_and_recovery_guards},
#ifndef _WIN32
        {"v2 recovery into real temporary file and reopen", test_v2_recovery_to_real_temporary_file},
#endif
    };
    size_t i;
    for (i = 0; i < sizeof(tests) / sizeof(tests[0]); ++i) {
        tests[i].run();
        printf("PASS %s\n", tests[i].name);
    }
    printf("%zu core tests passed; Windows boot/driver tests NOT performed.\n",
           sizeof(tests) / sizeof(tests[0]));
#ifdef _WIN32
    puts("2 POSIX file-backed tests are excluded on Windows; memory crash tests ran.");
#endif
    return EXIT_SUCCESS;
}
