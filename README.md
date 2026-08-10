# tree-sitter-posix-awk

A [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
POSIX.1-2024 `awk`.

## Usage

### Emacs

Add the grammar repository to `treesit-language-source-alist` and install it:

```elisp
(add-to-list
 'treesit-language-source-alist
 '(posix_awk
   . ("https://github.com/konomanoasa/tree-sitter-posix-awk")))

(treesit-install-language-grammar 'posix_awk)
```

## Specification

- [POSIX.1-2024 `awk`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/awk.html)
- [POSIX.1-2024 extended regular expressions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap09.html#tag_09_04)

## License

[MIT](LICENSE)
