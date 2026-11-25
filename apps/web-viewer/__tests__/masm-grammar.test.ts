import githubLight from "@shikijs/themes/github-light";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { beforeAll, describe, expect, it } from "vitest";

import { masmGrammar } from "@/lib/masm/grammar";

// The grammar as the server loads it: the JavaScript regex engine, which
// rejects patterns Oniguruma would take.
const highlighter = createHighlighterCore({
  themes: [githubLight],
  langs: [masmGrammar],
  engine: createJavaScriptRegexEngine(),
});

let tokenize: (code: string) => [text: string, scope: string][];

beforeAll(async () => {
  const { codeToTokensBase } = await highlighter;
  // Each non-blank piece of `code` and its innermost scope, `source.masm`
  // where nothing else matched.
  tokenize = (code) =>
    codeToTokensBase(code, {
      lang: "masm",
      theme: "github-light",
      includeExplanation: true,
    }).flatMap((line) =>
      line.flatMap(({ explanation = [] }) =>
        explanation.flatMap(({ content, scopes }) =>
          content.trim() === ""
            ? []
            : [[content.trim(), scopes[scopes.length - 1]?.scopeName ?? ""] as [string, string]],
        ),
      ),
    );
});

// The scope given to `text`, the first time it occurs in `code`.
const scopeOf = (code: string, text: string) =>
  tokenize(code).find(([content]) => content === text)?.[1];

describe("the MASM grammar", () => {
  it("scopes doc comments apart from comments", () => {
    expect(tokenize("#! Returns the count.\n# => [count]")).toEqual([
      ["#! Returns the count.", "comment.line.documentation.masm"],
      ["# => [count]", "comment.line.number-sign.masm"],
    ]);
  });

  it("scopes a procedure, its visibility, its attribute and its signature", () => {
    const code = "@account_procedure\npub proc increment_count(amount: felt) -> word\nend";
    expect(tokenize(code)).toEqual([
      ["@account_procedure", "entity.name.function.decorator.masm"],
      ["pub", "storage.modifier.masm"],
      ["proc", "storage.type.function.masm"],
      ["increment_count", "entity.name.function.masm"],
      ["(amount:", "source.masm"],
      ["felt", "support.type.primitive.masm"],
      [")", "source.masm"],
      ["->", "keyword.operator.masm"],
      ["word", "support.type.primitive.masm"],
      ["end", "keyword.other.masm"],
    ]);
  });

  it("scopes a quoted procedure name", () => {
    expect(scopeOf('proc "get-count"', '"get-count"')).toBe("entity.name.function.masm");
  });

  it("scopes `use`, `const`, `begin` and the program's keywords", () => {
    const code = "use miden::core::sys\nconst MAX = 4\nbegin\nend";
    expect(scopeOf(code, "use")).toBe("keyword.other.masm");
    expect(scopeOf(code, "const")).toBe("keyword.other.masm");
    expect(scopeOf(code, "MAX")).toBe("variable.other.constant.masm");
    expect(scopeOf(code, "=")).toBe("keyword.operator.masm");
    expect(scopeOf(code, "4")).toBe("constant.numeric.decimal.masm");
    expect(scopeOf(code, "begin")).toBe("keyword.other.masm");
  });

  it("scopes control flow, and an invocation with its callee", () => {
    const code =
      "if.true\n  exec.active_account::get_item\nelse\n  call.::counter::increment\nend\nwhile.true\nrepeat.4\ndynexec";
    expect(scopeOf(code, "if")).toBe("keyword.control.masm");
    expect(scopeOf(code, "true")).toBe("constant.language.masm");
    expect(scopeOf(code, "exec")).toBe("keyword.control.masm");
    expect(scopeOf(code, "active_account::get_item")).toBe("entity.name.function.masm");
    expect(scopeOf(code, "::counter::increment")).toBe("entity.name.function.masm");
    expect(scopeOf(code, "else")).toBe("keyword.control.masm");
    expect(scopeOf(code, "while")).toBe("keyword.control.masm");
    expect(scopeOf(code, "repeat")).toBe("keyword.control.masm");
    expect(scopeOf(code, "dynexec")).toBe("keyword.control.masm");
  });

  it("scopes an invocation of a procedure named like an instruction as a callee", () => {
    expect(scopeOf("exec.add", "add")).toBe("entity.name.function.masm");
  });

  it("scopes instructions and their immediates", () => {
    const code =
      "push.COUNTER_SLOT[0..2] movup.4 add u32assert2 adv.push_mapval push.0x1f mem_load.0b101";
    expect(tokenize(code)).toEqual([
      ["push", "support.function.instruction.masm"],
      [".", "source.masm"],
      ["COUNTER_SLOT", "variable.other.constant.masm"],
      ["[", "source.masm"],
      ["0", "constant.numeric.decimal.masm"],
      ["..", "keyword.operator.masm"],
      ["2", "constant.numeric.decimal.masm"],
      ["]", "source.masm"],
      ["movup", "support.function.instruction.masm"],
      [".", "source.masm"],
      ["4", "constant.numeric.decimal.masm"],
      ["add", "support.function.instruction.masm"],
      ["u32assert2", "support.function.instruction.masm"],
      ["adv.push_mapval", "support.function.instruction.masm"],
      ["push", "support.function.instruction.masm"],
      [".", "source.masm"],
      ["0x1f", "constant.numeric.hex.masm"],
      ["mem_load", "support.function.instruction.masm"],
      [".", "source.masm"],
      ["0b101", "constant.numeric.binary.masm"],
    ]);
  });

  it("scopes `word(…)` with its string", () => {
    expect(tokenize('word("counter::count")')).toEqual([
      ["word", "support.function.masm"],
      ["(", "source.masm"],
      ['"', "string.quoted.double.masm"],
      ["counter::count", "string.quoted.double.masm"],
      ['"', "string.quoted.double.masm"],
      [")", "source.masm"],
    ]);
  });

  it("leaves identifiers that only contain a keyword alone", () => {
    expect(scopeOf("exec.foo::get_count", "foo::get_count")).toBe("entity.name.function.masm");
    expect(scopeOf("pushes", "pushes")).toBe("source.masm");
  });
});
