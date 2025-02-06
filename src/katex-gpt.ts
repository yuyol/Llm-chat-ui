import katex from "katex";
import MarkdownIt from "markdown-it";

// 定义选项的接口
interface Delimiter {
  left: string;
  right: string;
  display: boolean;
}

interface Options {
  delimiters: Delimiter[];
}

const defaultOptions: Options = {
  delimiters: [
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ],
};

export function renderLatexHTML(content: string, display = false): string {
  return katex.renderToString(content, {
    throwOnError: false,
    output: "mathml" as any, // 明确指定类型，因为output选项可能不在类型定义中
    displayMode: display,
  });
}

function escapedBracketRule(options: Options) {
  return (state: any, silent: boolean): boolean => {
    const max = state.posMax;
    const start = state.pos;

    for (const { left, right, display } of options.delimiters) {
      if (!state.src.startsWith(left, start)) continue;

      let pos = start + left.length;

      while (pos < max) {
        if (state.src.startsWith(right, pos)) {
          break;
        }
        pos++;
      }

      if (pos >= max) continue;

      if (!silent) {
        const content = state.src.slice(start + left.length, pos);
        try {
          const renderedContent = renderLatexHTML(content, display);
          const token = state.push("html_inline", "", 0);
          token.content = renderedContent;
        } catch (e) {
          console.error(e);
        }
      }

      state.pos = pos + right.length;
      return true;
    }

    return false;
  };
}

export default function KatexPlugin(
  md: MarkdownIt,
  options: Options = defaultOptions
): void {
  md.inline.ruler.after("text", "escaped_bracket", escapedBracketRule(options));
}
