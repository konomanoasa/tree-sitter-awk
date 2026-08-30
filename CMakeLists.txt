cmake_minimum_required(VERSION 3.13)

project(
  tree-sitter-awk
  VERSION 0.3.0
  DESCRIPTION "Tree-sitter grammar for POSIX awk."
  HOMEPAGE_URL "https://github.com/konomanoasa/tree-sitter-awk"
  LANGUAGES C
)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the Tree-sitter allocator" OFF)

file(
  STRINGS src/parser.c
  TREE_SITTER_ABI_DEFINITION
  REGEX "^#define LANGUAGE_VERSION [0-9]+$"
)
if(NOT TREE_SITTER_ABI_DEFINITION MATCHES "^#define LANGUAGE_VERSION [0-9]+$")
  message(FATAL_ERROR "The parser must define one LANGUAGE_VERSION")
endif()
string(
  REGEX REPLACE "^#define LANGUAGE_VERSION " ""
  TREE_SITTER_ABI_VERSION
  "${TREE_SITTER_ABI_DEFINITION}"
)

include(GNUInstallDirs)
if(CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
  include(CTest)
endif()

add_library(tree-sitter-awk src/parser.c src/scanner.c)
target_include_directories(
  tree-sitter-awk
  INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/bindings/c>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
target_compile_definitions(
  tree-sitter-awk
  PRIVATE
    $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
    $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>
)
set_target_properties(
  tree-sitter-awk
  PROPERTIES
    C_STANDARD 11
    C_STANDARD_REQUIRED ON
    DEFINE_SYMBOL ""
    POSITION_INDEPENDENT_CODE ON
    SOVERSION "${TREE_SITTER_ABI_VERSION}.${PROJECT_VERSION_MAJOR}"
)

if(BUILD_TESTING AND CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
  add_executable(tree-sitter-awk-binding-test test/binding.test.c)
  target_link_libraries(tree-sitter-awk-binding-test PRIVATE tree-sitter-awk)
  add_test(
    NAME tree-sitter-awk-binding
    COMMAND tree-sitter-awk-binding-test
  )
endif()

configure_file(
  bindings/c/tree-sitter-awk.pc.in
  "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-awk.pc"
  @ONLY
)

install(
  TARGETS tree-sitter-awk
  ARCHIVE DESTINATION "${CMAKE_INSTALL_LIBDIR}"
  LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}"
  RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}"
)
install(
  DIRECTORY bindings/c/tree_sitter
  DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}"
  FILES_MATCHING PATTERN "*.h"
)
install(
  FILES "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-awk.pc"
  DESTINATION "${CMAKE_INSTALL_LIBDIR}/pkgconfig"
)
install(
  DIRECTORY queries/
  DESTINATION "${CMAKE_INSTALL_DATADIR}/tree-sitter/queries/awk"
  FILES_MATCHING PATTERN "*.scm"
)
