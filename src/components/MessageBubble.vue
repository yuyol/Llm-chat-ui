<template>
  <div class="message-bubble">
    <!-- 示例：使用 VueMarkdown 渲染 msg.content -->
    <!-- <VueMarkdown :source="msg.content" /> -->
    <div
      :class="{
        chat: true,
        'chat-start': msg.role !== 'user',
        'chat-end': msg.role === 'user',
      }"
    >
      <div
        :class="{
          'chat-bubble markdown': true,
          'chat-bubble-base-300': msg.role !== 'user',
        }"
      >
        <!-- textarea for editing message -->
        <template v-if="editingContent !== null">
          <textarea
            dir="auto"
            class="textarea textarea-bordered bg-base-100 text-base-content w-[calc(90vw-8em)] lg:w-96"
            v-model="editingContent"
          ></textarea>
          <br />
          <button
            class="btn btn-ghost mt-2 mr-2"
            @click="editingContent = null"
          >
            Cancel
          </button>
          <button class="btn mt-2" @click="editMsg()">Submit</button>
        </template>
        <template v-else>
          <!-- show loading dots for pending message -->
          <span
            v-if="msg.content === null"
            class="loading loading-dots loading-md"
          ></span>
          <!-- render message as markdown -->
          <div v-else dir="auto">
            <details
              v-if="msg.role === 'assistant' && splitMsgContent.cot"
              class="collapse bg-base-200 collapse-arrow mb-4"
              open
            >
              <summary class="collapse-title">
                <span v-if="splitMsgContent.isThinking">
                  <span
                    v-if="isGenerating"
                    class="loading loading-spinner loading-md mr-2"
                    style="vertical-align: middle"
                  ></span>
                  <b>Thinking</b>
                </span>
                <b v-else>Thought Process</b>
              </summary>
              <vue-markdown
                :source="splitMsgContent.cot"
                dir="auto"
                class="collapse-content"
              ></vue-markdown>
            </details>
            <vue-markdown :source="splitMsgContent.content"></vue-markdown>
          </div>
          <!-- render timings if enabled -->
          <div
            class="dropdown dropdown-hover dropdown-top mt-2"
            v-if="timings && config.showTokensPerSecond"
          >
            <div
              tabindex="0"
              role="button"
              class="cursor-pointer font-semibold text-sm opacity-60"
            >
              Speed: {{ timings.predicted_per_second.toFixed(1) }} t/s
            </div>
            <div class="dropdown-content bg-base-100 z-10 w-64 p-2 shadow mt-4">
              <b>Prompt</b><br />
              - Tokens: {{ timings.prompt_n }}<br />
              - Time: {{ timings.prompt_ms }} ms<br />
              - Speed: {{ timings.prompt_per_second.toFixed(1) }} t/s<br />
              <b>Generation</b><br />
              - Tokens: {{ timings.predicted_n }}<br />
              - Time: {{ timings.predicted_ms }} ms<br />
              - Speed: {{ timings.predicted_per_second.toFixed(1) }} t/s<br />
            </div>
          </div>
        </template>
      </div>
    </div>
    <!-- actions for each message -->
    <div
      :class="{ 'text-right': msg.role === 'user', 'opacity-0': isGenerating }"
      class="mx-4 mt-2 mb-2"
    >
      <!-- user message -->
      <button
        v-if="msg.role === 'user'"
        class="badge btn-mini show-on-hover"
        @click="editingContent = msg.content"
        :disabled="isGenerating"
      >
        ✍️ Edit
      </button>
      <!-- assistant message -->
      <button
        v-if="msg.role === 'assistant'"
        class="badge btn-mini show-on-hover mr-2"
        @click="regenerateMsg(msg)"
        :disabled="isGenerating"
      >
        🔄 Regenerate
      </button>
      <button
        v-if="msg.role === 'assistant'"
        class="badge btn-mini show-on-hover mr-2"
        @click="copyMsg()"
        :disabled="isGenerating"
      >
        📋 Copy
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import VueMarkdown from "./VueMarkdown.vue";

const copyStr = (textToCopy: any) => {
  // Navigator clipboard api needs a secure context (https)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(textToCopy);
  } else {
    // Use the 'out of viewport hidden text area' trick
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy;
    // Move textarea out of the viewport so it's not visible
    textArea.style.position = "absolute";
    textArea.style.left = "-999999px";
    document.body.prepend(textArea);
    textArea.select();
    document.execCommand("copy");
  }
};

// 根据实际情况定义接口类型
interface Config {
  // 例如：
  // theme: string;
  // ...
}

interface Message {
  id: number | string;
  content: string;
  // 其他属性...
}

export default defineComponent({
  name: "MessageBubble",
  components: {
    VueMarkdown,
  },
  props: {
    config: {
      type: Object,
      required: true,
    },
    msg: {
      type: Object,
      required: true,
    },
    isGenerating: {
      type: Boolean,
      required: true,
    },
    showThoughtInProgress: {
      type: Boolean,
      default: false,
    },
    editUserMsgAndRegenerate: {
      //   type: Function as PropType<(newMsg: string) => void>,
      type: Function,
      required: true,
    },
    regenerateMsg: {
      //   type: Function as PropType<() => void>,
      type: Function,
      required: true,
    },
  },
  data() {
    return {
      // 如果编辑内容是字符串，则可以指定类型为 string | null
      editingContent: null as string | null,
    };
  },
  computed: {
    // 可根据需要添加计算属性
    timings() {
      if (!this.msg.timings) return null;
      return {
        ...this.msg.timings,
        prompt_per_second:
          this.msg.timings.prompt_n / (this.msg.timings.prompt_ms / 1000),
        predicted_per_second:
          this.msg.timings.predicted_n / (this.msg.timings.predicted_ms / 1000),
      };
    },
    splitMsgContent() {
      const content = this.msg.content;
      if (this.msg.role !== "assistant") {
        return { content };
      }
      let actualContent = "";
      let cot = "";
      let isThinking = false;
      let thinkSplit = content.split("<think>", 2);
      actualContent += thinkSplit[0];
      while (thinkSplit[1] !== undefined) {
        // <think> tag found
        thinkSplit = thinkSplit[1].split("</think>", 2);
        cot += thinkSplit[0];
        isThinking = true;
        if (thinkSplit[1] !== undefined) {
          // </think> closing tag found
          isThinking = false;
          thinkSplit = thinkSplit[1].split("<think>", 2);
          actualContent += thinkSplit[0];
        }
      }
      return { content: actualContent, cot, isThinking };
    },
  },
  methods: {
    // 可根据需要添加方法
    copyMsg() {
      copyStr(this.msg.content);
    },
    editMsg() {
      this.editUserMsgAndRegenerate({
        ...this.msg,
        content: this.editingContent,
      });
      this.editingContent = null;
    },
  },
});
</script>

<style scoped>
/* 添加你的样式 */
.message-bubble {
  /* 样式代码 */
}
</style>
