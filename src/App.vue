<script setup lang="ts">
import { defineComponent, ref, toRaw } from "vue";
import MessageBubble from "./components/MessageBubble.vue";
import { TextLineStream } from "./types/textlinestream";
import { asyncIterator } from "@sec-ant/readable-stream/ponyfill/asyncIterator";

// types
/** @typedef {{ id: number, role: -'user' | 'assistant', content: string, timings: any }} Message */
/** @typedef {{ role: 'user' | 'assistant', content: string }} APIMessage */
/** @typedef {{ id: string, lastModified: number, messages: Array<Message> }} Conversation */

interface Message {
  id: number;
  role: string;
  content: string | null;
}

/** @type {Array<Message>} */
const messages = ref<any[]>([]);
const inputMsg = ref("");
const isGenerating = ref(false);
/** @type {Array<Message> | null} */
const pendingMsg = ref<any>(null); // the on-going message from assistant
const isDev = import.meta.env.MODE === "development";
const CONFIG_DEFAULT = {
  // Note: in order not to introduce breaking changes, please keep the same data type (number, string, etc) if you want to change the default value. Do not use null or undefined for default value.
  apiKey: "",
  systemMessage: "You are a helpful assistant.",
  showTokensPerSecond: false,
  showThoughtInProgress: false,
  excludeThoughtOnReq: true,
  // make sure these default values are in sync with `common.h`
  samplers: "edkypmxt",
  temperature: 0.8,
  dynatemp_range: 0.0,
  dynatemp_exponent: 1.0,
  top_k: 40,
  top_p: 0.95,
  min_p: 0.05,
  xtc_probability: 0.0,
  xtc_threshold: 0.1,
  typical_p: 1.0,
  repeat_last_n: 64,
  repeat_penalty: 1.0,
  presence_penalty: 0.0,
  frequency_penalty: 0.0,
  dry_multiplier: 0.0,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_penalty_last_n: -1,
  max_tokens: -1,
  custom: "", // custom json-stringified object
};

// coversations is stored in localStorage
// format: { [convId]: { id: string, lastModified: number, messages: [...] } }
// convId is a string prefixed with 'conv-'
const StorageUtils = {
  /**
   * manage conversations
   * @returns {Array<Conversation>}
   */
  getAllConversations() {
    const res = [];
    for (const key in localStorage) {
      if (key.startsWith("conv-")) {
        res.push(JSON.parse(localStorage.getItem(key) ?? "null"));
      }
    }
    res.sort((a, b) => b.lastModified - a.lastModified);
    return res;
  },
  /**
   * can return null if convId does not exist
   * @param {string} convId
   * @returns {Conversation | null}
   */
  getOneConversation(convId: any) {
    return JSON.parse(localStorage.getItem(convId) || "null");
  },
  /**
   * if convId does not exist, create one
   * @param {string} convId
   * @param {Message} msg
   */
  appendMsg(convId: any, msg: any) {
    if (msg.content === null) return;
    const conv = StorageUtils.getOneConversation(convId) || {
      id: convId,
      lastModified: Date.now(),
      messages: [],
    };
    conv.messages.push(msg);
    conv.lastModified = Date.now();
    // 将响应式对象转换为普通对象，避免循环引用
    localStorage.setItem(convId, JSON.stringify(conv));
  },
  /**
   * Get new conversation id
   * @returns {string}
   */
  getNewConvId() {
    return `conv-${Date.now()}`;
  },
  /**
   * remove conversation by id
   * @param {string} convId
   */
  remove(convId: any) {
    localStorage.removeItem(convId);
  },
  /**
   * remove all conversations
   * @param {string} convId
   */
  filterAndKeepMsgs(convId: any, predicate: any) {
    const conv = StorageUtils.getOneConversation(convId);
    if (!conv) return;
    conv.messages = conv.messages.filter(predicate);
    conv.lastModified = Date.now();
    localStorage.setItem(convId, JSON.stringify(conv));
  },
  /**
   * remove last message from conversation
   * @param {string} convId
   * @returns {Message | undefined}
   */
  popMsg(convId: any) {
    const conv = StorageUtils.getOneConversation(convId);
    if (!conv) return;
    const msg = conv.messages.pop();
    conv.lastModified = Date.now();
    if (conv.messages.length === 0) {
      StorageUtils.remove(convId);
    } else {
      localStorage.setItem(convId, JSON.stringify(conv));
    }
    return msg;
  },

  // manage config
  getConfig() {
    const savedVal = JSON.parse(localStorage.getItem("config") || "{}");
    // to prevent breaking changes in the future, we always provide default value for missing keys
    return {
      ...CONFIG_DEFAULT,
      ...savedVal,
    };
  },
  setConfig(config: any) {
    localStorage.setItem("config", JSON.stringify(config));
  },
  getTheme() {
    return localStorage.getItem("theme") || "auto";
  },
  setTheme(theme: any) {
    if (theme === "auto") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", theme);
    }
  },
};

let conversations = StorageUtils.getAllConversations();
const viewingConvId = StorageUtils.getNewConvId();
const config = StorageUtils.getConfig();

function editUserMsgAndRegenerate(msg: any) {
  if (isGenerating.value) return;
  const currConvId = viewingConvId;
  const newContent = msg.content;
  StorageUtils.filterAndKeepMsgs(currConvId, (m: any) => m.id < msg.id);
  StorageUtils.appendMsg(currConvId, {
    id: Date.now(),
    role: "user",
    content: newContent,
  });
  fetchConversation();
  fetchMessages();
  generateMessage(currConvId);
}

function regenerateMsg(msg: any) {
  if (isGenerating.value) return;
  // TODO: somehow keep old history (like how ChatGPT has different "tree"). This can be done by adding "sub-conversations" with "subconv-" prefix, and new message will have a list of subconvIds
  const currConvId = viewingConvId;
  StorageUtils.filterAndKeepMsgs(currConvId, (m: any) => m.id < msg.id);
  fetchConversation();
  fetchMessages();
  generateMessage(currConvId);
}

function fetchConversation() {
  conversations = StorageUtils.getAllConversations();
}
function fetchMessages() {
  messages.value =
    StorageUtils.getOneConversation(viewingConvId)?.messages ?? [];
}

async function sendMessage() {
  if (!inputMsg.value || isGenerating.value) return;
  const currConvId = viewingConvId;

  StorageUtils.appendMsg(currConvId, {
    id: Date.now(),
    role: "user",
    content: inputMsg.value,
  });
  fetchConversation();
  fetchMessages();
  inputMsg.value = "";
  generateMessage(currConvId);
}

/**
 * filter out redundant fields upon sending to API
 * @param {Array<APIMessage>} messages
 * @returns {Array<APIMessage>}
 */
function normalizeMsgsForAPI(messages: any) {
  return messages.map((msg: any) => {
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

/**
 * recommended for DeepsSeek-R1, filter out content between <think> and </think> tags
 * @param {Array<APIMessage>} messages
 * @returns {Array<APIMessage>}
 */
function filterThoughtFromMsgs(messages: any) {
  return messages.map((msg: any) => {
    return {
      role: msg.role,
      content:
        msg.role === "assistant"
          ? msg.content.split("</think>").at(-1).trim()
          : msg.content,
    };
  });
}

async function generateMessage(currConvId: any) {
  if (isGenerating.value) return;
  pendingMsg.value = {
    id: Date.now() + 1,
    role: "assistant",
    content: null,
  };
  isGenerating.value = true;

  try {
    const config = StorageUtils.getConfig();
    const abortController = new AbortController();
    stopGeneration = () => abortController.abort();
    /** @type {Array<APIMessage>} */
    let tempMessages = [
      { role: "system", content: config.systemMessage },
      ...normalizeMsgsForAPI(messages.value),
    ];
    messages.value = tempMessages;
    if (config.excludeThoughtOnReq) {
      messages.value = filterThoughtFromMsgs(messages.value);
    }
    const params = {
      messages: messages.value,
      stream: true,
      cache_prompt: true,
      samplers: config.samplers,
      temperature: config.temperature,
      dynatemp_range: config.dynatemp_range,
      dynatemp_exponent: config.dynatemp_exponent,
      top_k: config.top_k,
      top_p: config.top_p,
      min_p: config.min_p,
      typical_p: config.typical_p,
      xtc_probability: config.xtc_probability,
      xtc_threshold: config.xtc_threshold,
      repeat_last_n: config.repeat_last_n,
      repeat_penalty: config.repeat_penalty,
      presence_penalty: config.presence_penalty,
      frequency_penalty: config.frequency_penalty,
      dry_multiplier: config.dry_multiplier,
      dry_base: config.dry_base,
      dry_allowed_length: config.dry_allowed_length,
      dry_penalty_last_n: config.dry_penalty_last_n,
      max_tokens: config.max_tokens,
      timings_per_token: !!config.showTokensPerSecond,
      ...(config.custom.length ? JSON.parse(config.custom) : {}),
    };
    const chunks = sendSSEPostRequest(
      `http://localhost:8080/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify(params),
        signal: abortController.signal,
      }
    );
    for await (const chunk of chunks) {
      const stop = chunk.stop;
      const addedContent = chunk.choices[0].delta.content;
      const lastContent: any = pendingMsg.value.content || "";
      if (addedContent) {
        pendingMsg.value = {
          id: pendingMsg.value.id,
          role: "assistant",
          content: lastContent + addedContent,
        };
      }
      const timings = chunk.timings;
      if (timings && config.showTokensPerSecond) {
        // only extract what's really needed, to save some space
        pendingMsg.value.timings = {
          prompt_n: timings.prompt_n,
          prompt_ms: timings.prompt_ms,
          predicted_n: timings.predicted_n,
          predicted_ms: timings.predicted_ms,
        };
      }
    }
    StorageUtils.appendMsg(currConvId, pendingMsg.value);
    fetchConversation();
    fetchMessages();
    // setTimeout(() => document.getElementById("msg-input").focus(), 1);
  } catch (error) {
    console.log(error);
  }

  isGenerating.value = false;
  pendingMsg.value = null;
  stopGeneration = () => {};
  fetchMessages();
}

// wrapper for SSE
async function* sendSSEPostRequest(url: any, fetchOptions: any) {
  const res = await fetch(url, fetchOptions);
  if (!res.body) {
    throw new Error("Response body is null. Unable to read SSE stream.");
  }

  const reader = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .getReader(); // Get a reader instead of using asyncIterator

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const line = value as string; // Explicitly cast `value` to `string`

    if (isDev) console.log({ line });

    if (line.startsWith("data:") && !line.endsWith("[DONE]")) {
      yield JSON.parse(line.slice(5));
    } else if (line.startsWith("error:")) {
      const data = JSON.parse(line.slice(6));
      throw new Error(data.message || "Unknown error");
    }
  }
}

let stopGeneration = () => {
  console.log("stop");
};
</script>

<template>
  <div>
    <!-- main view -->
    <div
      class="chat-screen drawer-content grow flex flex-col h-screen w-screen mx-auto px-4"
    >
      <!-- chat messages -->
      <div id="messages-list" class="flex flex-col grow overflow-y-auto">
        <div class="mt-auto flex justify-center">
          <!-- placeholder to shift the message to the bottom -->
          {{ messages.length === 0 ? "Send a message to start" : "" }}
        </div>
        <div v-for="msg in messages" class="group">
          <MessageBubble
            :config="config"
            :msg="msg"
            :key="msg.id"
            :is-generating="isGenerating"
            :edit-user-msg-and-regenerate="editUserMsgAndRegenerate"
            :regenerate-msg="regenerateMsg"
          >
          </MessageBubble>
        </div>

        <!-- pending (ongoing) assistant message -->
        <div id="pending-msg" class="group">
          <MessageBubble
            v-if="pendingMsg"
            :config="config"
            :msg="pendingMsg"
            :key="pendingMsg.id"
            :is-generating="isGenerating"
            :show-thought-in-progress="config.showThoughtInProgress"
            :edit-user-msg-and-regenerate="() => {}"
            :regenerate-msg="() => {}"
          ></MessageBubble>
        </div>
      </div>

      <!-- chat input -->
      <div class="flex flex-row items-center mt-8 mb-6">
        <textarea
          class="textarea textarea-bordered w-full"
          placeholder="Type a message (Shift+Enter to add a new line)"
          v-model="inputMsg"
          @keydown.enter.exact.prevent="sendMessage"
          id="msg-input"
          dir="auto"
        ></textarea>
        <button
          v-if="!isGenerating"
          class="btn btn-primary ml-2"
          @click="sendMessage"
          :disabled="inputMsg.length === 0"
        >
          Send
        </button>
        <button v-else class="btn btn-neutral ml-2" @click="stopGeneration">
          Stop
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
