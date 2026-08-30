#include <stddef.h>
#include <tree_sitter/tree-sitter-awk.h>

int main(void) {
  return tree_sitter_awk() == NULL;
}
