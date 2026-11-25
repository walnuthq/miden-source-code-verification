import type { LanguageRegistration } from "shiki/core";

import vocabulary from "@/lib/masm/vocabulary.json";

// A TextMate grammar for Miden Assembly, which Shiki has none of, for the
// `.masm` sources of a MASM package (`package-sources.server.ts`).
//
// Its words come from `vocabulary.json`, a copy of the Playground's
// (`apps/web/lib/masm/vocabulary.json` in walnuthq/miden-playground), which
// that repo extracts from the assembler's own sources in 0xMiden/miden-vm with
// `pnpm masm:sync`; its `source` names the miden-vm tag. To refresh it, run
// that sync there and copy the file over. The rules mirror the Playground's
// Monarch tokenizer (`apps/web/lib/masm/language.ts`), with TextMate scopes
// the GitHub themes color.

// The block forms among the keywords, scoped like control flow, with the
// instructions that transfer control: `call` and the rest are matched with
// their callee below.
const CONTROL = ["if", "else", "while", "do", "repeat"];
const INVOCATIONS = ["exec", "call", "syscall", "procref"];
const DYNAMIC_INVOCATIONS = ["dyncall", "dynexec"];
// What a procedure's visibility and the declarations are, rather than plain
// keywords (`proc` is matched with its name below).
const MODIFIERS = ["pub"];

const escapeDots = (word: string) => word.replace(/[.]/g, "\\.");

// One alternation of `words`, longest first so `u32assert2` isn't read as
// `u32assert`, not glued to a word character on either side. A word may hold a
// `.` (`adv.push_mapval`), so it can't follow one either: `exec.add` calls a
// procedure named `add`.
const wordsPattern = (words: string[]) =>
  `(?<![\\w.$])(?:${[...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeDots)
    .join("|")})(?![\\w$])`;

// A procedure's name or a path segment: an identifier, or a quoted name
// (`"get-count"`, the compiler's names).
const NAME = '(?:[A-Za-z_$][\\w$]*|"[^"]*")';
const PATH = `(?:::)?${NAME}(?:::${NAME})*`;

export const masmGrammar = {
  name: "masm",
  displayName: "Miden Assembly",
  scopeName: "source.masm",
  patterns: [
    { include: "#comments" },
    { include: "#attributes" },
    { include: "#strings" },
    { include: "#procedure" },
    { include: "#invocation" },
    { include: "#hash" },
    { include: "#control" },
    { include: "#modifiers" },
    { include: "#keywords" },
    { include: "#types" },
    { include: "#instructions" },
    { include: "#constants" },
    { include: "#numbers" },
    { include: "#operators" },
  ],
  repository: {
    comments: {
      patterns: [
        // `#!` starts a doc comment, `#` any other.
        { name: "comment.line.documentation.masm", match: "#!.*$" },
        { name: "comment.line.number-sign.masm", match: "#.*$" },
      ],
    },
    // `@account_procedure`, `@note_script`, `@locals(4)`
    attributes: {
      name: "entity.name.function.decorator.masm",
      match: "@[A-Za-z_]\\w*",
    },
    strings: {
      name: "string.quoted.double.masm",
      begin: '"',
      end: '"',
      patterns: [{ name: "constant.character.escape.masm", match: "\\\\." }],
    },
    // `pub proc get_count`, `proc "get-count"`
    procedure: {
      match: `\\b(proc)\\s+(${NAME})`,
      captures: {
        1: { name: "storage.type.function.masm" },
        2: { name: "entity.name.function.masm" },
      },
    },
    // `exec.active_account::get_item`, `call.::counter_account::increment_count`
    invocation: {
      match: `(${wordsPattern(INVOCATIONS)})(\\.)(${PATH})`,
      captures: {
        1: { name: "keyword.control.masm" },
        2: { name: "punctuation.accessor.masm" },
        3: { name: "entity.name.function.masm" },
      },
    },
    // `word("counter_account::count")`, `event("…")`: a hash of the string.
    hash: {
      match: "\\b(word|event)(?=\\()",
      name: "support.function.masm",
    },
    control: {
      name: "keyword.control.masm",
      match: wordsPattern([
        ...vocabulary.keywords.filter((word) => CONTROL.includes(word)),
        ...INVOCATIONS,
        ...DYNAMIC_INVOCATIONS,
      ]),
    },
    modifiers: {
      name: "storage.modifier.masm",
      match: wordsPattern(MODIFIERS),
    },
    keywords: {
      name: "keyword.other.masm",
      match: wordsPattern(
        vocabulary.keywords.filter(
          (word) => !CONTROL.includes(word) && !MODIFIERS.includes(word),
        ),
      ),
    },
    types: {
      name: "support.type.primitive.masm",
      match: wordsPattern(vocabulary.types),
    },
    // `push.1`, `movup.4`, `u32wrapping_add`, `adv.push_mapval`: the
    // immediates after the `.` are numbers and constants.
    instructions: {
      name: "support.function.instruction.masm",
      match: wordsPattern(
        vocabulary.instructions.filter(
          (word) =>
            !INVOCATIONS.includes(word) && !DYNAMIC_INVOCATIONS.includes(word),
        ),
      ),
    },
    constants: {
      patterns: [
        { name: "constant.language.masm", match: "\\b(?:true|false)\\b" },
        { name: "variable.language.masm", match: "\\$(?:kernel|exec)\\b" },
        // `const COUNTER_SLOT = …`, `push.COUNTER_SLOT[0..2]`
        {
          name: "variable.other.constant.masm",
          match: "\\b[A-Z][A-Z0-9_]*\\b",
        },
      ],
    },
    numbers: {
      patterns: [
        { name: "constant.numeric.hex.masm", match: "\\b0[xX][0-9a-fA-F]+\\b" },
        { name: "constant.numeric.binary.masm", match: "\\b0[bB][01]+\\b" },
        { name: "constant.numeric.decimal.masm", match: "\\b\\d+\\b" },
      ],
    },
    operators: {
      name: "keyword.operator.masm",
      match: "::|->|\\.\\.\\.?|[=+\\-*/]",
    },
  },
} satisfies LanguageRegistration;
