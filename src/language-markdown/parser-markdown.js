"use strict";

const remarkParse = require("remark-parse");
const unified = require("unified");
const pragma = require("./pragma");
const parseFrontMatter = require("../utils/front-matter");
const { mapAst } = require("./utils");
const mdx = require("./mdx");
const remarkMath = require("remark-math");

/**
 * based on [MDAST](https://github.com/syntax-tree/mdast) with following modifications:
 *
 * 1. restore unescaped character (Text)
 * 2. merge continuous Texts
 * 3. replace whitespaces in InlineCode#value with one whitespace
 *    reference: http://spec.commonmark.org/0.25/#example-605
 * 4. split Text into Sentence
 *
 * interface Word { value: string }
 * interface Whitespace { value: string }
 * interface Sentence { children: Array<Word | Whitespace> }
 * interface InlineCode { children: Array<Sentence> }
 */
function createParse({ isMDX }) {
  return text => {
    const processor = unified()
      .use(
        remarkParse,
        Object.assign(
          {
            footnotes: true,
            commonmark: true
          },
          isMDX && { blocks: [mdx.BLOCKS_REGEX] }
        )
      )
      .use(frontMatter)
      .use(remarkMath)
      .use(isMDX ? mdx.esSyntax : identity)
      .use(liquid)
      .use(isMDX ? htmlToJsx : identity);
    return processor.runSync(processor.parse(text));
  };
}

function identity(x) {
  return x;
}

function htmlToJsx() {
  return ast =>
    mapAst(ast, (node, index, [parent]) => {
      if (
        node.type !== "html" ||
        /^<!--[\s\S]*-->$/.test(node.value) ||
        // inline html
        parent.type === "paragraph"
      ) {
        return node;
      }

      return Object.assign({}, node, { type: "jsx" });
    });
}

function frontMatter() {
  const proto = this.Parser.prototype;
  proto.blockMethods = ["frontMatter"].concat(proto.blockMethods);
  proto.blockTokenizers.frontMatter = tokenizer;

  function tokenizer(eat, value) {
    const parsed = parseFrontMatter(value);

    if (parsed.frontMatter) {
      return eat(parsed.frontMatter.raw)(parsed.frontMatter);
    }
  }
  tokenizer.onlyAtStart = true;
}

function liquid() {
  const proto = this.Parser.prototype;
  const methods = proto.inlineMethods;
  methods.splice(methods.indexOf("text"), 0, "liquid");
  proto.inlineTokenizers.liquid = tokenizer;

  function tokenizer(eat, value) {
    const match = value.match(/^({%[\s\S]*?%}|{{[\s\S]*?}})/);

    if (match) {
      return eat(match[0])({
        type: "liquidNode",
        value: match[0]
      });
    }
  }
  tokenizer.locator = function(value, fromIndex) {
    return value.indexOf("{", fromIndex);
  };
}

const baseParser = {
  astFormat: "mdast",
  hasPragma: pragma.hasPragma,
  locStart: node => node.position.start.offset,
  locEnd: node => node.position.end.offset,
  preprocess: text => text.replace(/\n\s+$/, "\n") // workaround for https://github.com/remarkjs/remark/issues/350
};

const markdownParser = Object.assign({}, baseParser, {
  parse: createParse({ isMDX: false })
});

const mdxParser = Object.assign({}, baseParser, {
  parse: createParse({ isMDX: true })
});

module.exports = {
  parsers: {
    remark: markdownParser,
    // TODO: Delete this in 2.0
    markdown: markdownParser,
    mdx: mdxParser
  }
};
