LANGUAGE_NAME := tree-sitter-awk
HOMEPAGE_URL := https://github.com/konomanoasa/tree-sitter-awk
VERSION := 0.5.0
DESCRIPTION := Tree-sitter grammar for POSIX awk.

PREFIX ?= /usr/local
DATADIR ?= $(PREFIX)/share
INCLUDEDIR ?= $(PREFIX)/include
LIBDIR ?= $(PREFIX)/lib
BINDIR ?= $(PREFIX)/bin
PCLIBDIR ?= $(LIBDIR)/pkgconfig

SOURCES := src/parser.c src/scanner.c
OBJECTS := $(SOURCES:.c=.o)
MAKE_BUILD_DIR := build/make
STATIC_LIBRARY := lib$(LANGUAGE_NAME).a
PKG_CONFIG := $(LANGUAGE_NAME).pc
TEST := $(MAKE_BUILD_DIR)/binding.test

ARFLAGS := rcs
override CFLAGS += -std=c11 -fPIC

SONAME_MAJOR := $(shell sed -n 's/\#define LANGUAGE_VERSION //p' src/parser.c)
SONAME_MINOR := $(word 1,$(subst ., ,$(VERSION)))

ifeq ($(SONAME_MAJOR),)
$(error The parser must define LANGUAGE_VERSION)
endif

MACHINE := $(shell $(CC) -dumpmachine)

ifneq ($(findstring darwin,$(MACHINE)),)
SOEXT := dylib
SOEXTVER_MAJOR := $(SONAME_MAJOR).$(SOEXT)
SOEXTVER := $(SONAME_MAJOR).$(SONAME_MINOR).$(SOEXT)
LINKSHARED := -dynamiclib -Wl,-install_name,$(LIBDIR)/lib$(LANGUAGE_NAME).$(SOEXTVER)
else ifneq ($(findstring mingw32,$(MACHINE)),)
SOEXT := dll
LINKSHARED := -s -shared -Wl,--out-implib,lib$(LANGUAGE_NAME).dll.a
TEST := $(MAKE_BUILD_DIR)/binding.test.exe
else
SOEXT := so
SOEXTVER_MAJOR := $(SOEXT).$(SONAME_MAJOR)
SOEXTVER := $(SOEXT).$(SONAME_MAJOR).$(SONAME_MINOR)
LINKSHARED := -shared -Wl,-soname,lib$(LANGUAGE_NAME).$(SOEXTVER)
ifneq ($(filter $(shell uname),FreeBSD NetBSD DragonFly),)
PCLIBDIR := $(PREFIX)/libdata/pkgconfig
endif
endif

SHARED_LIBRARY := lib$(LANGUAGE_NAME).$(SOEXT)

all: $(STATIC_LIBRARY) $(SHARED_LIBRARY) $(PKG_CONFIG)

$(STATIC_LIBRARY): $(OBJECTS)
	$(AR) $(ARFLAGS) $@ $^

$(SHARED_LIBRARY): $(OBJECTS)
	$(CC) $(LDFLAGS) $(LINKSHARED) $^ $(LDLIBS) -o $@
ifneq ($(STRIP),)
	$(STRIP) $@
endif

$(PKG_CONFIG): bindings/c/$(LANGUAGE_NAME).pc.in FORCE
	sed -e 's|@PROJECT_VERSION@|$(VERSION)|' \
		-e 's|@CMAKE_INSTALL_LIBDIR@|$(LIBDIR:$(PREFIX)/%=%)|' \
		-e 's|@CMAKE_INSTALL_INCLUDEDIR@|$(INCLUDEDIR:$(PREFIX)/%=%)|' \
		-e 's|@PROJECT_DESCRIPTION@|$(DESCRIPTION)|' \
		-e 's|@PROJECT_HOMEPAGE_URL@|$(HOMEPAGE_URL)|' \
		-e 's|@CMAKE_INSTALL_PREFIX@|$(PREFIX)|' $< > $@

src/parser.o: src/tree_sitter/parser.h
src/scanner.o: src/tree_sitter/alloc.h src/tree_sitter/parser.h

$(MAKE_BUILD_DIR):
	mkdir -p $@

$(TEST): test/binding.test.c $(STATIC_LIBRARY) | $(MAKE_BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -Ibindings/c $< $(STATIC_LIBRARY) $(LDFLAGS) $(LDLIBS) -o $@

test: $(TEST)
	./$(TEST)

install: all
	install -d '$(DESTDIR)$(DATADIR)'/tree-sitter/queries/awk \
		'$(DESTDIR)$(INCLUDEDIR)'/tree_sitter \
		'$(DESTDIR)$(PCLIBDIR)' \
		'$(DESTDIR)$(LIBDIR)'
	install -m644 bindings/c/tree_sitter/$(LANGUAGE_NAME).h \
		'$(DESTDIR)$(INCLUDEDIR)'/tree_sitter/$(LANGUAGE_NAME).h
	install -m644 $(PKG_CONFIG) '$(DESTDIR)$(PCLIBDIR)'/$(PKG_CONFIG)
	install -m644 $(STATIC_LIBRARY) '$(DESTDIR)$(LIBDIR)'/$(STATIC_LIBRARY)
ifneq ($(findstring mingw32,$(MACHINE)),)
	install -d '$(DESTDIR)$(BINDIR)'
	install -m755 $(SHARED_LIBRARY) '$(DESTDIR)$(BINDIR)'/$(SHARED_LIBRARY)
	install -m644 lib$(LANGUAGE_NAME).dll.a \
		'$(DESTDIR)$(LIBDIR)'/lib$(LANGUAGE_NAME).dll.a
else
	install -m755 $(SHARED_LIBRARY) \
		'$(DESTDIR)$(LIBDIR)'/lib$(LANGUAGE_NAME).$(SOEXTVER)
	cd '$(DESTDIR)$(LIBDIR)' && \
		ln -sf lib$(LANGUAGE_NAME).$(SOEXTVER) \
			lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR)
	cd '$(DESTDIR)$(LIBDIR)' && \
		ln -sf lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR) $(SHARED_LIBRARY)
endif
	install -m644 queries/*.scm \
		'$(DESTDIR)$(DATADIR)'/tree-sitter/queries/awk

uninstall:
	$(RM) '$(DESTDIR)$(LIBDIR)'/$(STATIC_LIBRARY) \
		'$(DESTDIR)$(INCLUDEDIR)'/tree_sitter/$(LANGUAGE_NAME).h \
		'$(DESTDIR)$(PCLIBDIR)'/$(PKG_CONFIG)
ifneq ($(findstring mingw32,$(MACHINE)),)
	$(RM) '$(DESTDIR)$(BINDIR)'/$(SHARED_LIBRARY) \
		'$(DESTDIR)$(LIBDIR)'/lib$(LANGUAGE_NAME).dll.a
else
	$(RM) '$(DESTDIR)$(LIBDIR)'/lib$(LANGUAGE_NAME).$(SOEXTVER) \
		'$(DESTDIR)$(LIBDIR)'/lib$(LANGUAGE_NAME).$(SOEXTVER_MAJOR) \
		'$(DESTDIR)$(LIBDIR)'/$(SHARED_LIBRARY)
endif
	$(RM) -r '$(DESTDIR)$(DATADIR)'/tree-sitter/queries/awk

clean:
	$(RM) $(OBJECTS) $(STATIC_LIBRARY) $(SHARED_LIBRARY) \
		lib$(LANGUAGE_NAME).dll.a $(PKG_CONFIG)
	$(RM) -r $(MAKE_BUILD_DIR)

FORCE:

.PHONY: all clean FORCE install test uninstall
