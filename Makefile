CC ?= cc
WARNINGS = -std=c11 -Wall -Wextra -Werror -Wconversion -Wshadow -pedantic
CFLAGS ?= -O1 -g
SANITIZERS ?= -fsanitize=address,undefined -fno-omit-frame-pointer

.PHONY: test test-core test-python test-desktop test-all clean

test: test-core test-python

artifacts/core_tests: core/restorewin.c core/restorewin.h tests/core_tests.c
	mkdir -p artifacts
	$(CC) $(WARNINGS) $(CFLAGS) $(SANITIZERS) -Icore core/restorewin.c tests/core_tests.c -o $@

test-core: artifacts/core_tests
	./artifacts/core_tests

test-python:
	python3 -m unittest discover -s tests -v

test-desktop:
	cd desktop && npm test

test-all: test test-desktop

clean:
	rm -f artifacts/core_tests
