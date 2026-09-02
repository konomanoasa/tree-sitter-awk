#include <stddef.h>
#include <tree_sitter/tree-sitter-posix-awk.h>

int main(void) {
  return tree_sitter_posix_awk() == NULL;
}
