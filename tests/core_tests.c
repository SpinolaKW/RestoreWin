#define _POSIX_C_SOURCE 200809L
#include "restorewin.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

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
} memory_store;

typedef struct {
    memory_store base_store;
    memory_store delta_store;
    rw_source base;
    rw_overlay delta;
    rw_geometry geometry;
    rw_context context;
    uint64_t map[BLOCKS];
    uint8_t scratch[8192];
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
    if (s->fail_flush) return -1;
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
        {"real temporary files and reopen", test_file_backed_reopen},
    };
    size_t i;
    for (i = 0; i < sizeof(tests) / sizeof(tests[0]); ++i) {
        tests[i].run();
        printf("PASS %s\n", tests[i].name);
    }
    printf("%zu core tests passed; Windows boot/driver tests NOT performed.\n",
           sizeof(tests) / sizeof(tests[0]));
    return EXIT_SUCCESS;
}
