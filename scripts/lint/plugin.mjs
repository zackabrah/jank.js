const comparisons = new Set(["===", "!==", "==", "!="]);

const literal = "Literal";

const template = "TemplateLiteral";

const unary = "UnaryExpression";

const typeOf = "typeof";

const message =
  "Magic string. Name it with a module-level const and compare against that.";

/** A non-empty string literal; "" is an emptiness check, not a magic value. */
const isMagic = (node) =>
  (node.type === literal &&
    typeof node.value === "string" &&
    node.value.length > 0) ||
  (node.type === template &&
    node.expressions.length === 0 &&
    node.quasis[0].value.cooked.length > 0);

/** True for a `typeof x` operand, whose comparison strings are type names. */
const isTypeOf = (node) => node.type === unary && node.operator === typeOf;

export const noMagicStrings = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow string literals in equality comparisons and switch cases.",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!comparisons.has(node.operator)) return;

        if (isTypeOf(node.left) || isTypeOf(node.right)) return;

        for (const side of [node.left, node.right])
          if (isMagic(side)) context.report({ node: side, message });
      },
      SwitchCase(node) {
        if (node.test && isMagic(node.test))
          context.report({ node: node.test, message });
      },
    };
  },
};

const functionValues = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
]);

const exportTypes = new Set([
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
]);

// Lint directives say how to lint the code, not what it does.
const directive = /^\s*(?:oxlint|eslint)-/;

const lineComment = "Line";

const docMarker = "*";

const docEnd = "*/";

const uncommented =
  "Function needs a /** */ comment above it saying what it does.";

/** A declaration's comment sits above its export keyword, when it has one. */
const commentTarget = (node) =>
  exportTypes.has(node.parent?.type) ? node.parent : node;

/** The unbroken run of comments on the lines directly above the node, nearest last. */
const commentsAbove = (context, target) => {
  const comments = context.sourceCode.getCommentsBefore(target);

  let first = comments.length,
    nextLine = target.loc.start.line;

  while (first > 0 && comments[first - 1].loc.end.line === nextLine - 1) {
    first--;

    nextLine = comments[first].loc.start.line;
  }

  return comments.slice(first);
};

/** True for a comment that describes code rather than directing the linter. */
const isDoc = (comment) => !directive.test(comment.value);

/** True for a `/** *\/` block, which editors show on hover. */
const isJsDoc = (comment) =>
  comment.type !== lineComment && comment.value.startsWith(docMarker);

/** The text of `//` or `/* *\/` comments as one JSDoc block, indented like the first. */
const toJsDoc = (comments) => {
  const lines = comments.flatMap((comment) =>
    comment.type === lineComment
      ? [comment.value.replace(/^ /, "").trimEnd()]
      : comment.value
          .split("\n")
          .map((text) => text.trim().replace(/^\* ?/, ""))
          .filter(Boolean),
  );

  if (lines.length === 1) return `/** ${lines[0]} */`;

  const indent = " ".repeat(comments[0].loc.start.column);

  return [
    "/**",
    ...lines.map((text) => `${indent} * ${text}`.trimEnd()),
    `${indent} */`,
  ].join("\n");
};

export const requireFunctionComment = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Require a /** */ comment above function declarations, function-valued variables and class methods.",
    },
  },
  // Object literal methods are left out: they implement interfaces documented elsewhere.
  create(context) {
    /** Reports a function without a /** *\/ comment, fixing plain comments where it can. */
    const check = (node, target = node) => {
      const above = commentsAbove(context, commentTarget(target));

      if (above.some(isJsDoc)) return;

      const docs = above.filter(isDoc);

      // Rewrite existing comments only when lint directives stay directly above the code.
      const fixable =
        docs.length > 0 &&
        above.slice(0, docs.length).every(isDoc) &&
        !docs.some((comment) => comment.value.includes(docEnd));

      context.report({
        node,
        message: uncommented,
        ...(fixable && {
          fix: (fixer) =>
            fixer.replaceTextRange(
              [docs[0].range[0], docs.at(-1).range[1]],
              toJsDoc(docs),
            ),
        }),
      });
    };

    return {
      FunctionDeclaration: (node) => check(node),
      VariableDeclarator(node) {
        if (!functionValues.has(node.init?.type)) return;

        const declaration = node.parent;

        check(node, declaration.declarations[0] === node ? declaration : node);
      },
      MethodDefinition: (node) => check(node),
      PropertyDefinition(node) {
        if (functionValues.has(node.value?.type)) check(node);
      },
    };
  },
};

const wrappers = new Set([
  "ChainExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
]);

const member = "MemberExpression";

const call = "CallExpression";

const assignment = "AssignmentExpression";

const update = "UpdateExpression";

const expressionStatement = "ExpressionStatement";

const identifier = "Identifier";

const self = "ThisExpression";

const keepTogether =
  "Statements on the same object stay together; drop the blank line.";

const keepApart = "Separate statements on different objects with a blank line.";

/** The identifier or `this` at the root of a member or call chain, like `a` in `a.b.c()`. */
const root = (node) => {
  let current = node;

  for (;;) {
    if (wrappers.has(current.type)) current = current.expression;
    else if (current.type === member) current = current.object;
    else if (current.type === call) current = current.callee;
    else break;
  }

  if (current.type === identifier) return current.name;

  return current.type === self ? "this" : null;
};

/** The object a statement sets a property on or calls a method of, or null for anything else. */
const subject = (statement) => {
  if (statement.type !== expressionStatement) return null;

  let expression = statement.expression;

  if (wrappers.has(expression.type)) expression = expression.expression;

  if (expression.type === assignment && expression.left.type === member)
    return root(expression.left);

  if (expression.type === update && expression.argument.type === member)
    return root(expression.argument);

  if (expression.type === call && expression.callee.type === member)
    return root(expression.callee);

  return null;
};

export const groupObjectStatements = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: {
      description:
        "Keep consecutive statements on the same object together and put a blank line between other expression statements.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;

    /** Checks the spacing between each pair of neighbouring expression statements in a block. */
    const check = (statements) => {
      for (let i = 1; i < statements.length; i++) {
        const previous = statements[i - 1],
          next = statements[i];

        if (
          previous.type !== expressionStatement ||
          next.type !== expressionStatement
        )
          continue;

        const between = source.slice(previous.range[1], next.range[0]);

        // A comment between them is a deliberate break; leave the spacing to the author.
        if (between.trim()) continue;

        const lines = between.split("\n").length - 1;

        if (!lines) continue;

        const indent = between.slice(between.lastIndexOf("\n") + 1);

        const same =
          subject(previous) !== null && subject(previous) === subject(next);

        if (same && lines > 1)
          context.report({
            node: next,
            message: keepTogether,
            fix: (fixer) =>
              fixer.replaceTextRange(
                [previous.range[1], next.range[0]],
                `\n${indent}`,
              ),
          });
        else if (!same && lines === 1)
          context.report({
            node: next,
            message: keepApart,
            fix: (fixer) =>
              fixer.replaceTextRange(
                [previous.range[1], next.range[0]],
                `\n\n${indent}`,
              ),
          });
      }
    };

    return {
      Program: (node) => check(node.body),
      BlockStatement: (node) => check(node.body),
      StaticBlock: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
    };
  },
};

export default {
  meta: { name: "jank" },
  rules: {
    "group-object-statements": groupObjectStatements,
    "no-magic-strings": noMagicStrings,
    "require-function-comment": requireFunctionComment,
  },
};
