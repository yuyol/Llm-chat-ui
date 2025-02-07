<script setup lang="ts">
import { defineComponent, onMounted, ref, toRaw } from "vue";
import MessageBubble from "./components/MessageBubble.vue";
import { TextLineStream } from "./types/textlinestream";
import daisyuiThemes from "daisyui/src/theming/themes";
import type { Theme } from "daisyui";
import OpenAI from "openai";

// types
/** @typedef {{ id: number, role: -'user' | 'assistant', content: string, timings: any }} Message */
/** @typedef {{ role: 'user' | 'assistant', content: string }} APIMessage */
/** @typedef {{ id: string, lastModified: number, messages: Array<Message> }} Conversation */

interface Message {
  id: number;
  role: string;
  content: string | null;
}

const BASE_URL = "http://localhost:8080";
// OpenAI API config
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: "sk-10e7ee563d2e4244b7f19b671f6e5bc7",
  dangerouslyAllowBrowser: true,
});

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
  systemMessage:
    "You are a job seeker and senior Java software developer and logician, now you are interviewing for a SWE job. Your answers need to be detailed and accurate. As a job seeker, please think like you would answer the interviewer's questions during an interview. You can think in English, but the answer must be in Chinese.",
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
    return localStorage.getItem("theme") || "null";
  },
  setTheme(theme: any) {
    if (theme === "auto") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", theme);
    }
  },
};

let stopGeneration = () => {};
let conversations = StorageUtils.getAllConversations();
let selectedTheme = StorageUtils.getTheme();
const viewingConvId = StorageUtils.getNewConvId();
const config = StorageUtils.getConfig(); // list of themes supported by daisyui
const THEMES = ["light", "dark"];
// make sure light & dark are always at the beginning
// .concat(
//   Object.keys(daisyuiThemes).filter((t) => t !== "light" && t !== "auto")
// );
const themes = ref(THEMES);

function setSelectedTheme(theme: Theme) {
  selectedTheme = theme;
  document.body.setAttribute("data-theme", theme);
  document.body.setAttribute(
    "data-color-scheme",
    daisyuiThemes[theme]?.["color-scheme"] ?? "auto"
  );
  StorageUtils.setTheme(theme);
}

function toggleTheme(theme: Theme) {
  selectedTheme = selectedTheme === "dark" ? "light" : "dark";
  document.body.setAttribute("data-theme", selectedTheme);
  StorageUtils.setTheme(selectedTheme);
}

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
    const chunks = sendSSEPostRequest(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(params),
      signal: abortController.signal,
    });
    for await (const chunk of chunks) {
      const stop = chunk.stop;
      const lastContent: any = pendingMsg.value.content || "";
      const addedContent = chunk.choices[0].delta.content;
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

    // const chunks = await openai.chat.completions.create({
    //   messages: messages.value,
    //   model: "deepseek-chat",
    //   stream: true, // 开启流式传输
    // });
    // for await (const chunk of chunks) {
    //   const addedContent = chunk.choices[0]?.delta?.content || ""; // 兼容空内容
    //   const lastContent = pendingMsg.value.content || "";

    //   if (addedContent) {
    //     pendingMsg.value = {
    //       id: pendingMsg.value.id,
    //       role: "assistant",
    //       content: lastContent + addedContent, // 累加新内容
    //     };
    //   }
    // }

    StorageUtils.appendMsg(currConvId, pendingMsg.value);
    fetchConversation();
    fetchMessages();
    // setTimeout(() => document.getElementById("msg-input").focus(), 1);
  } catch (error: any) {
    if (error.name === "AbortError") {
      StorageUtils.appendMsg(currConvId, pendingMsg.value);
      fetchConversation();
      fetchMessages();
    } else {
      console.error(error);
      alert(error);
      const lastUserMsg = StorageUtils.popMsg(currConvId);
      inputMsg.value = lastUserMsg ? lastUserMsg.content : "";
    }
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

function setDefaultTheme() {
  if (selectedTheme != "null") {
    document.body.setAttribute("data-theme", selectedTheme);
  } else {
    selectedTheme = "light";
    document.body.setAttribute("data-theme", selectedTheme);
  }
}

onMounted(() => {
  setDefaultTheme();
});
</script>

<template>
  <div>
    <!-- main view -->
    <div
      class="chat-screen drawer-content grow flex flex-col h-screen w-screen mx-auto px-4"
    >
      <!-- header -->
      <div class="flex flex-row items-center mt-6 mb-6">
        <div class="grow text-2xl font-bold ml-2">YY Chat bot</div>
        <!-- action buttons (top right) -->
        <div class="flex items-center">
          <!-- theme controller is copied from https://daisyui.com/components/theme-controller/ -->
          <label class="swap swap-rotate">
            <!-- this hidden checkbox controls the state -->
            <input
              type="checkbox"
              class="theme-controller"
              :checked="selectedTheme === 'dark'"
              @change="toggleTheme"
            />

            <!-- sun icon -->
            <svg
              class="swap-off h-10 w-10 fill-current"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
            >
              <path
                d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
              />
            </svg>

            <!-- moon icon -->
            <svg
              class="swap-on h-10 w-10 fill-current"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
            >
              <path
                d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"
              />
            </svg>
          </label>
        </div>
      </div>
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
      <div
        class="flex flex-row items-center mt-8 mb-6"
        style="min-width: 300px"
      >
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
          class="btn btn-lg btn-outline btn-primary ml-4"
          @click="sendMessage"
          :disabled="inputMsg.length === 0"
        >
          Send
        </button>
        <button
          v-else
          class="btn btn-lg btn-outline btn-neutral ml-4"
          @click="stopGeneration"
        >
          Stop
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
