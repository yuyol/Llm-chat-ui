<template>
  <!-- 渲染后的 markdown 内容 -->
  <div :innerHTML="renderedContent"></div>
</template>

<script lang="ts">
import { defineComponent, shallowRef, computed, h } from "vue";
// const MarkdownIt = require("markdown-it").default;
import MarkdownIt from "markdown-it";
import markdownItKatexGpt from "../katex-gpt";
import markdownItKatexNormal from "@vscode/markdown-it-katex";
import hljs from "highlight.js";

/**
 * 用于转义 HTML 属性值的简单实现。
 * 根据实际需求，可以使用更完善的库来处理转义。
 */
function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 一个简单的复制文本到剪贴板的函数实现。
 * 你也可以根据需要自行调整或引入其它库。
 */
function copyStr(str: string): void {
  navigator.clipboard
    .writeText(str)
    .then(() => {
      console.log("Copied to clipboard:", str);
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
    });
}

export default defineComponent({
  name: "VueMarkdown",
  props: {
    source: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    // 初始化 MarkdownIt 实例，并配置代码高亮
    const md = shallowRef(
      new MarkdownIt({
        breaks: true,
        highlight: function (str: string, lang: string): string {
          if (lang && hljs.getLanguage(lang)) {
            try {
              return (
                '<pre dir="auto"><code class="hljs">' +
                hljs.highlight(str, {
                  language: lang,
                  ignoreIllegals: true,
                }).value +
                "</code></pre>"
              );
            } catch (error) {
              // 出错时可以在此处记录日志
              console.error("Highlight error:", error);
            }
          }
          return (
            '<pre dir="auto"><code class="hljs">' +
            md.value.utils.escapeHtml(str) +
            "</code></pre>"
          );
        },
      })
    );

    // 使用 markdown-it 插件支持 latex（双美元符和方括号）以及单美元符
    md.value.use(markdownItKatexGpt, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$$", right: "$$", display: false },
      ],
      throwOnError: false,
    });
    md.value.use(markdownItKatexNormal, { throwOnError: false });

    // 声明 origFenceRenderer 的类型，确保它符合预期的函数签名，或者可能为 undefined
    const origFenceRenderer = md.value.renderer.rules.fence as
      | ((tokens: any[], idx: number, ...args: any[]) => string)
      | undefined;

    // 重写 fence 规则，返回包含复制按钮的代码块 HTML 字符串
    md.value.renderer.rules.fence = (
      tokens: any[],
      idx: number,
      ...args: any[]
    ): string => {
      const token = tokens[idx];
      const content = token.content;

      // 调用原始渲染器获取代码块的 HTML
      const origRendered = origFenceRenderer
        ? origFenceRenderer(tokens, idx, ...args)
        : "";

      return `<div class="relative my-4">
            <div class="text-right sticky top-4 mb-2 mr-2 h-0">
              <button class="badge btn-mini" onclick="copyStr(${escapeAttr(
                JSON.stringify(content)
              )})">📋 Copy</button>
            </div>
            ${origRendered}
          </div>`;
    };

    // 将 copyStr 函数挂载到 window 对象上，以便在内联 onclick 中调用
    (window as any).copyStr = copyStr;

    // 根据传入的 markdown 文本计算渲染后的 HTML 内容
    const renderedContent = computed(() => md.value.render(props.source));

    // 采用渲染函数的方式返回内容（也可以直接在 template 中使用 computed 的值）
    return { renderedContent };
  },
});
</script>

<style scoped>
/* 示例样式，根据需要调整 */
.relative {
  position: relative;
}
.my-4 {
  margin-top: 1rem;
  margin-bottom: 1rem;
}
.text-right {
  text-align: right;
}
.sticky {
  position: sticky;
}
.top-4 {
  top: 1rem;
}
.mb-2 {
  margin-bottom: 0.5rem;
}
.mr-2 {
  margin-right: 0.5rem;
}
.h-0 {
  height: 0;
}
.badge {
  cursor: pointer;
}
.btn-mini {
  font-size: 0.8rem;
}
</style>
