use konomanoasa_tree_sitter_gawk as grammar;
use tree_sitter::{
  InputEdit, Node, Parser, Point, Query, QueryCursor, StreamingIterator,
};

fn parser() -> Parser {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  parser
}

#[test]
fn literal_and_block_delimiter_fields_point_to_source_leaves() {
  for (source, owner_field, opening, closing) in [
    ("/^a$/", "pattern", 0..1, 4..5),
    ("\"a\"", "pattern", 0..1, 2..3),
    ("{}", "action", 0..1, 1..2),
  ] {
    let tree = parser().parse(source, None).unwrap();
    let owner = tree
      .root_node()
      .named_child(0)
      .unwrap()
      .child_by_field_name(owner_field)
      .unwrap();
    for (field, range) in [("opening", opening), ("closing", closing)] {
      let leaf = owner.child_by_field_name(field).unwrap();
      assert_eq!(leaf.byte_range(), range);
      assert!(!leaf.is_named());
      assert_eq!(leaf.child_count(), 0);
      assert_eq!(leaf.kind(), &source[leaf.byte_range()]);
    }
  }
}

fn same_cst(actual: Node<'_>, expected: Node<'_>) {
  let mut pending = vec![(actual, expected)];
  while let Some((a, b)) = pending.pop() {
    assert_eq!(
      (
        a.kind(),
        a.range(),
        a.is_named(),
        a.is_extra(),
        a.is_error(),
        a.is_missing()
      ),
      (
        b.kind(),
        b.range(),
        b.is_named(),
        b.is_extra(),
        b.is_error(),
        b.is_missing()
      )
    );
    assert_eq!(a.child_count(), b.child_count());
    for i in 0..a.child_count() {
      assert_eq!(a.field_name_for_child(i), b.field_name_for_child(i));
      pending.push((a.child(i).unwrap(), b.child(i).unwrap()));
    }
  }
}

fn point(source: &str, byte: usize) -> Point {
  let prefix = &source.as_bytes()[..byte];
  Point::new(
    prefix.iter().filter(|&&b| b == b'\n').count(),
    prefix.len()
      - prefix
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1),
  )
}

#[test]
fn parser_reuse_reset_and_document_replacement_preserve_fresh_results() {
  let sources = [
    "@namespace \"lib\"\nfunction f(systime) {return systime (3)}",
    "function f(switch) {return switch}\nBEGIN {switch(x) {case 1: break;}}",
    r"/[[:alpha:]/]a{1,2}?\xc3\xa9/",
    "BEGIN {print (a)+b; getline x < file}",
    "function f(systime) {return \"unfinished",
    r"/a{256}/",
    "",
  ];
  let mut reused = parser();
  let mut previous = reused.parse("", None).unwrap();
  let mut old_source = "";
  for source in sources.into_iter().cycle().take(sources.len() * 3) {
    let independent = parser().parse(source, None).unwrap();
    for _ in 0..2 {
      same_cst(
        reused.parse(source, None).unwrap().root_node(),
        independent.root_node(),
      );
    }
    reused.reset();
    same_cst(
      reused.parse(source, None).unwrap().root_node(),
      independent.root_node(),
    );
    previous.edit(&InputEdit {
      start_byte: 0,
      old_end_byte: old_source.len(),
      new_end_byte: source.len(),
      start_position: Point::new(0, 0),
      old_end_position: point(old_source, old_source.len()),
      new_end_position: point(source, source.len()),
    });
    previous = reused.parse(source, Some(&previous)).unwrap();
    if !independent.root_node().has_error() {
      same_cst(previous.root_node(), independent.root_node());
    }
    old_source = source;
  }
  assert!(grammar::NODE_TYPES.contains("\"regex_interval\""));
}

#[test]
fn leaves_preserve_every_nonlayout_source_byte_without_overlap() {
  for source in [
    r"/a\x7b\061,2\x7d[[:alpha:][.é.][=a=]\/]\xc3\xa9/",
    "/a\\x2\\\nb/",
    r"/\x5c\\\
./",
    "@namespace \"lib\"\nfunction f(systime) {return systime (3)}",
  ] {
    let tree = parser().parse(source, None).unwrap();
    assert!(!tree.root_node().has_error(), "{source}");
    let query =
      Query::new(&grammar::LANGUAGE.into(), grammar::HIGHLIGHTS_QUERY).unwrap();
    let mut cursor = QueryCursor::new();
    let mut captures =
      cursor.captures(&query, tree.root_node(), source.as_bytes());
    while let Some((matched, index)) = captures.next() {
      assert_eq!(matched.captures()[*index].node.child_count(), 0);
    }
    let mut pending = vec![tree.root_node()];
    let mut covered = vec![false; source.len()];
    while let Some(node) = pending.pop() {
      if node.child_count() == 0 {
        assert!(!node.byte_range().is_empty(), "{}", node.kind());
        for byte in node.byte_range() {
          assert!(!covered[byte], "overlap at {byte}");
          covered[byte] = true;
        }
      } else {
        pending.extend(node.children(&mut node.walk()));
      }
    }
    for (byte, &value) in source.as_bytes().iter().enumerate() {
      assert!(
        covered[byte] || b" \t\r\n".contains(&value),
        "lost byte {byte}"
      );
    }
  }
}

#[test]
fn parses_valid_source() {
  let source =
    "@namespace \"lib\"\nBEGIN {x = @/a{1,2}/; print awk::systime()}";
  let tree = parser().parse(source, None).unwrap();
  assert!(!tree.root_node().has_error());
  assert_eq!(tree.root_node().kind(), "program");
  assert_eq!(tree.root_node().byte_range(), 0..source.len());
}
