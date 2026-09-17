<template>
  <div class="pushing-levels-page">
    <div class="pl-header">
      <div>
        <h2>战斗推关</h2>
        <p>主线推图（后端执行，关闭页面不停止）</p>
      </div>
      <div class="pl-header-actions">
        <n-switch v-model:value="autoContinue" size="small">
          <template #checked>自动继续</template>
          <template #unchecked>手动停止</template>
        </n-switch>
        <n-input-number
          v-model:value="maxRetries"
          :min="1"
          :max="999999"
          size="small"
          class="retry-input"
        />
        <span class="retry-label">最大重试</span>
      </div>
    </div>

    <!-- 连接规则说明 -->
    <div class="rules-banner">
      <div class="rules-title">📋 连接规则</div>
      <div class="rules-grid">
        <div class="rule-item rule-auto">
          <span class="rule-icon">🔄</span>
          <div>
            <strong>自动继续</strong>
            <span>开启后，服务器重启会自动重连并继续推图</span>
          </div>
        </div>
        <div class="rule-item rule-kick">
          <span class="rule-icon">🚫</span>
          <div>
            <strong>被踢下线</strong>
            <span>玩家登录游戏后，自动停止推图且不再重连</span>
          </div>
        </div>
        <div class="rule-item rule-restart">
          <span class="rule-icon">⚡</span>
          <div>
            <strong>服务器重启</strong>
            <span>仅恢复「自动继续」开启的推图，普通连接不恢复</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 账号列表 -->
    <n-card class="account-card-top" :content-style="{ padding: '12px 16px' }">
      <div class="account-toolbar">
        <n-input
          v-model:value="searchKeyword"
          clearable
          size="tiny"
          placeholder="搜索账号"
          class="search-input"
        />
        <n-checkbox
          :checked="allVisibleSelected"
          :indeterminate="someVisibleSelected"
          @update:checked="toggleAllVisible"
          >全选</n-checkbox
        >
        <div v-if="tokenGroups.length" class="group-list-inline">
          <button
            v-for="group in tokenGroups"
            :key="group.id"
            class="group-chip"
            :class="{ selected: selectedGroupIds.includes(group.id) }"
            :style="groupChipStyle(group)"
            @click="toggleGroup(group)"
          >
            {{ group.name }}
          </button>
        </div>
      </div>
      <div v-if="filteredTokens.length" class="token-grid">
        <div
          v-for="token in filteredTokens"
          :key="token.id"
          class="token-cell"
          :class="{ selected: selectedTokenIds.includes(token.id) }"
        >
          <n-checkbox
            :checked="selectedTokenIds.includes(token.id)"
            @update:checked="(c) => toggleToken(token.id, c)"
            @click.stop
          />
          <span class="token-server" :title="token.server || '未知区服'">{{
            token.server || "未知"
          }}</span>
          <span class="token-sep">-</span>
          <span class="token-name" :title="token.name || token.id">{{
            token.name || token.id
          }}</span>
          <span
            class="status-dot"
            :class="getStatusClass(token.id)"
            :title="getStatusTitle(token.id)"
          ></span>
        </div>
      </div>
      <n-empty
        v-else
        description="暂无账号，请先在右上角管理Token"
        size="small"
      />
    </n-card>

    <!-- 控制区 -->
    <n-card class="control-card" :content-style="{ padding: '12px 16px' }">
      <div class="control-row">
        <div class="torch-field">
          <span class="torch-label">火把类型</span>
          <n-select
            v-model:value="torchItemId"
            :options="torchOptions"
            size="small"
            class="torch-select"
          />
        </div>
        <div class="torch-field">
          <span class="torch-label">数量</span>
          <n-input-number
            v-model:value="torchQuantity"
            :min="1"
            :max="999"
            size="small"
            class="torch-input"
          />
        </div>
        <n-button
          size="small"
          type="primary"
          :disabled="!selectedTokenIds.length"
          :loading="torchRunning"
          @click="useTorchForSelected"
          >使用火把</n-button
        >
        <n-button
          type="primary"
          size="small"
          :disabled="!selectedTokenIds.length || allSelectedRunning"
          @click="startSelected"
          >开始推图</n-button
        >
        <n-button
          type="error"
          size="small"
          :disabled="!hasSelectedRunning"
          @click="stopSelected"
          >全部停止</n-button
        >
        <div class="control-spacer"></div>
        <span class="status-text"
          >已选 {{ selectedTokenIds.length }}，推图中 {{ runningCount }}</span
        >
        <n-button size="small" @click="clearSelection">清除</n-button>
      </div>
    </n-card>

    <!-- 推图卡片 -->
    <div v-if="runningCards.length" class="running-section">
      <n-card
        v-for="card in runningCards"
        :key="card.tokenId"
        class="running-card"
        :class="{ active: card.running }"
      >
        <div class="running-head">
          <div class="card-title">
            <strong :title="card.tokenName">{{ card.tokenName }}</strong>
            <span
              class="status-dot small"
              :class="getStatusClass(card.tokenId)"
              :title="getStatusTitle(card.tokenId)"
            ></span>
          </div>
          <n-space size="small">
            <n-tag size="small" type="success">{{ card.wins }}胜</n-tag>
            <n-tag size="small" type="error">{{ card.losses }}负</n-tag>
          </n-space>
        </div>
        <div class="level-line">
          当前关卡：{{ card.level > 0 ? `${card.level}关` : "--" }}
        </div>
        <div class="level-line">boss：{{ card.bossName || "--" }}</div>
        <div class="level-line torch-line">{{ card.torchLabel }}</div>
        <div class="running-body">
          <template v-if="card.running">
            <div class="countdown-row">
              <span class="countdown-text"
                >战斗剩余 {{ formatDuration(card.countdown) }}</span
              >
              <n-progress
                class="inline-progress"
                type="line"
                :percentage="progressPercent(card)"
                :show-indicator="false"
                :height="8"
                status="success"
              />
            </div>
            <div class="card-actions">
              <span>已战斗 {{ card.battles }} 场</span>
              <n-button size="tiny" type="error" @click="stopOne(card.tokenId)"
                >停止</n-button
              >
            </div>
          </template>
          <template v-else>
            <div class="waiting-line">等待推图</div>
            <div class="card-actions">
              <span class="err-text" :title="card.lastError || '无'"
                >最近错误：{{ card.lastError || "无" }}</span
              >
              <n-button
                size="tiny"
                type="primary"
                @click="startOne(card.tokenId)"
                >启动</n-button
              >
            </div>
          </template>
        </div>
      </n-card>
    </div>

    <!-- 推图日志 -->
    <n-card class="log-card" :content-style="{ padding: '12px 16px' }">
      <template #header>
        <div class="log-header">
          <div>
            推图日志 <n-tag size="small">{{ logs.length }}/2000</n-tag>
          </div>
          <div class="log-actions">
            <n-checkbox v-model:checked="autoScroll" size="small"
              >自动滚动</n-checkbox
            >
            <n-checkbox v-model:checked="onlyErrors" size="small"
              >只看错误</n-checkbox
            >
            <n-button size="tiny" @click="clearLogs">清空</n-button>
          </div>
        </div>
      </template>
      <div class="log-filter">
        <span class="log-filter-label">筛选：</span>
        <n-select
          v-model:value="logFilterTokenId"
          :options="logFilterOptions"
          size="small"
          clearable
          placeholder="全部"
          class="log-filter-select"
        />
        <span class="log-filter-count">共 {{ visibleLogs.length }} 条</span>
      </div>
      <div ref="logsContainer" class="log-container">
        <div
          v-for="(log, i) in visibleLogs"
          :key="i"
          class="log-item"
          :class="log.type"
        >
          <span class="log-time">{{ log.time }}</span>
          <span class="log-name">[{{ log.tokenName }}]</span>
          <span class="log-msg">{{ log.msg }}</span>
        </div>
        <n-empty
          v-if="!visibleLogs.length"
          description="暂无日志"
          size="small"
        />
      </div>
    </n-card>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import { useMessage } from "naive-ui";
import { useTokenStore } from "@/stores/tokenStore";
import { $emit } from "@/stores/events/index.ts";
import api from "@/api/index";

const MAX_LOGS = 2000;

const message = useMessage();
const tokenStore = useTokenStore();

const selectedTokenIds = ref([]);
const selectedGroupIds = ref([]);
const searchKeyword = ref("");
const autoContinue = ref(true);
const maxRetries = ref(999999);
const autoScroll = ref(true);
const onlyErrors = ref(false);
const logsContainer = ref(null);
const logs = ref([]);
const backendStates = reactive({}); // tokenId → 后端推送的状态
const torchRunning = ref(false);
const torchItemId = ref(1008);
const torchQuantity = ref(150);
const logFilterTokenId = ref(null);
let statusPollTimer = null;

const torchOptions = [
  { label: "木材火把", value: 1008 },
  { label: "青铜火把", value: 1009 },
  { label: "咸神火把", value: 1010 },
];

const tokens = computed(() => tokenStore.gameTokens || []);
const tokenGroups = computed(() => tokenStore.tokenGroups || []);

const filteredTokens = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  const list = [...tokens.value].sort((a, b) => {
    return (
      new Date(a.lastUsed || 0).getTime() - new Date(b.lastUsed || 0).getTime()
    );
  });
  if (!kw) return list;
  return list.filter((t) =>
    [t.name, t.server, t.remark, t.id]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw)),
  );
});

const runningCount = computed(
  () => Object.values(backendStates).filter((s) => s?.running).length,
);

const allVisibleSelected = computed(() => {
  return (
    filteredTokens.value.length > 0 &&
    filteredTokens.value.every((t) => selectedTokenIds.value.includes(t.id))
  );
});
const someVisibleSelected = computed(() => {
  return (
    filteredTokens.value.some((t) => selectedTokenIds.value.includes(t.id)) &&
    !allVisibleSelected.value
  );
});
const allSelectedRunning = computed(() => {
  return (
    selectedTokenIds.value.length > 0 &&
    selectedTokenIds.value.every((id) => isRunning(id))
  );
});
const hasSelectedRunning = computed(() =>
  selectedTokenIds.value.some((id) => isRunning(id)),
);
const hasAnyRunning = computed(() =>
  Object.values(backendStates).some((s) => s?.running),
);

// 推图卡片 — 只显示正在推图或有活跃连接的 token
const runningCards = computed(() => {
  const cardIds = new Set();

  // 1. 后端正在推图的（但排除已断线的）
  for (const [id, state] of Object.entries(backendStates)) {
    if (state?.running) {
      const ws = tokenStore.getWebSocketStatus(id);
      // 连接已断开/被踢 → 跳过，不显示卡片
      if (ws === "disconnected" || ws === "kicked") continue;
      cardIds.add(id);
    }
  }

  // 2. 后端有活跃连接的（connected / connecting）
  for (const [id, conn] of Object.entries(tokenStore.wsConnections)) {
    if (conn?.status === "connected" || conn?.status === "connecting") {
      cardIds.add(id);
    }
  }

  // 3. 用户手动勾选的也显示
  for (const id of selectedTokenIds.value) {
    cardIds.add(id);
  }

  return Array.from(cardIds).map((tokenId) => {
    const token = tokens.value.find((t) => t.id === tokenId);
    const state = backendStates[tokenId] || {};
    const torchName = state.torchTypeName || "";
    const torchLabel = state.torchActive
      ? `🔥 ${torchName} 剩余 ${formatTorchTime(state.torchRemaining || 0)}`
      : "无火把";
    return {
      tokenId,
      tokenName: token?.name || tokenId,
      running: !!state.running,
      level: state.level || 0,
      bossName: state.bossName || "",
      wins: state.wins || 0,
      losses: state.losses || 0,
      battles: state.battles || 0,
      countdown: state.countdown || 0,
      totalTime: state.totalTime || 0,
      lastError: state.lastError || "",
      torchLabel,
    };
  });
});

const visibleLogs = computed(() => {
  let list = logs.value;
  if (logFilterTokenId.value)
    list = list.filter((l) => l.tokenId === logFilterTokenId.value);
  if (onlyErrors.value) list = list.filter((l) => l.type === "error");
  return list;
});

const logFilterOptions = computed(() => {
  const map = new Map();
  logs.value.forEach((l) => {
    if (!map.has(l.tokenId))
      map.set(l.tokenId, { label: l.tokenName, value: l.tokenId });
  });
  selectedTokenIds.value.forEach((id) => {
    if (!map.has(id)) {
      const t = tokens.value.find((x) => x.id === id);
      map.set(id, { label: t?.name || id, value: id });
    }
  });
  return Array.from(map.values());
});

watch(
  () => [visibleLogs.value.length, onlyErrors.value, logFilterTokenId.value],
  () => {
    if (!autoScroll.value) return;
    nextTick(() => {
      const el = logsContainer.value;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  },
);

// ─── helpers ───

function getToken(id) {
  return tokens.value.find((t) => t.id === id);
}
function getTokenName(id) {
  return getToken(id)?.name || id;
}
function isRunning(id) {
  return !!backendStates[id]?.running;
}

function getStatusClass(id) {
  const ws = tokenStore.getWebSocketStatus(id);
  if (ws === "connected") return "status-green";
  if (ws === "connecting") return "status-blue";
  if (ws === "error" || ws === "kicked") return "status-red";
  if (isRunning(id)) return "status-green"; // 后端在跑说明连接ok
  return "status-gray";
}
function getStatusTitle(id) {
  if (isRunning(id)) return "推图中";
  const ws = tokenStore.getWebSocketStatus(id);
  return (
    {
      connected: "已连接",
      connecting: "连接中",
      error: "异常",
      kicked: "被踢下线",
      disconnected: "未连接",
    }[ws] || "未连接"
  );
}

function toggleToken(id, checked) {
  if (checked)
    selectedTokenIds.value = [...new Set([...selectedTokenIds.value, id])];
  else selectedTokenIds.value = selectedTokenIds.value.filter((x) => x !== id);
}
function toggleAllVisible(checked) {
  const ids = filteredTokens.value.map((t) => t.id);
  if (checked)
    selectedTokenIds.value = [...new Set([...selectedTokenIds.value, ...ids])];
  else {
    const set = new Set(ids);
    selectedTokenIds.value = selectedTokenIds.value.filter((x) => !set.has(x));
  }
}
function toggleGroup(group) {
  const idx = selectedGroupIds.value.indexOf(group.id);
  const validIds = (group.tokenIds || []).filter((id) => getToken(id));
  if (idx >= 0) {
    selectedGroupIds.value.splice(idx, 1);
    const set = new Set(validIds);
    selectedTokenIds.value = selectedTokenIds.value.filter(
      (id) => !set.has(id),
    );
  } else {
    selectedGroupIds.value.push(group.id);
    selectedTokenIds.value = [
      ...new Set([...selectedTokenIds.value, ...validIds]),
    ];
  }
}
function groupChipStyle(group) {
  const sel = selectedGroupIds.value.includes(group.id);
  return sel
    ? { backgroundColor: group.color, borderColor: group.color, color: "#fff" }
    : { borderColor: group.color, color: group.color };
}

function formatDuration(s) {
  const sec = Math.max(0, Number(s) || 0);
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m${sec % 60}s` : `${sec}s`;
}
function formatTorchTime(s) {
  if (!s || s <= 0) return "0分钟";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}时${m}分` : `${m}分`;
}
function progressPercent(card) {
  if (!card.totalTime) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((1 - card.countdown / card.totalTime) * 100)),
  );
}

function addLog(tokenId, tokenName, msg, type = "info") {
  logs.value.push({
    time: new Date().toLocaleTimeString(),
    tokenId,
    tokenName,
    msg,
    type,
  });
  if (logs.value.length > MAX_LOGS)
    logs.value.splice(0, logs.value.length - MAX_LOGS);
}
function clearLogs() {
  logs.value = [];
}

// ─── 后端 API 调用 ───

async function startOne(tokenId) {
  const token = getToken(tokenId);
  if (!token) return;
  if (isRunning(tokenId)) {
    addLog(tokenId, token.name, "已在推图中", "warning");
    return;
  }

  addLog(tokenId, token.name, "请求开始推图...", "info");
  backendStates[tokenId] = {
    running: true,
    level: 0,
    wins: 0,
    losses: 0,
    battles: 0,
    countdown: 0,
    totalTime: 0,
    lastError: "",
    bossName: "",
  };

  try {
    const res = await api.levelPush.start(tokenId, {
      maxRetries: maxRetries.value,
      autoContinue: autoContinue.value,
      token: token.token,
      wsUrl: token.wsUrl,
      name: token.name,
    });
    if (res.success) {
      addLog(tokenId, token.name, "后端推图已启动", "success");
    } else {
      addLog(tokenId, token.name, `启动失败: ${res.message}`, "error");
      backendStates[tokenId] = {
        ...backendStates[tokenId],
        running: false,
        lastError: res.message,
      };
    }
  } catch (err) {
    addLog(
      tokenId,
      token.name,
      `启动失败: ${err?.message || "请求错误"}`,
      "error",
    );
    backendStates[tokenId] = {
      ...backendStates[tokenId],
      running: false,
      lastError: err?.message,
    };
  }
}

async function startSelected() {
  for (const id of selectedTokenIds.value) {
    if (!isRunning(id)) {
      await startOne(id);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function stopOne(tokenId) {
  const name = getTokenName(tokenId);
  addLog(tokenId, name, "请求停止推图", "warning");
  try {
    await api.levelPush.stop(tokenId);
    if (backendStates[tokenId]) backendStates[tokenId].stopFlag = true;
  } catch (err) {
    addLog(tokenId, name, `停止失败: ${err?.message}`, "error");
  }
}

function stopSelected() {
  selectedTokenIds.value.forEach((id) => {
    if (isRunning(id)) stopOne(id);
  });
}

function clearSelection() {
  selectedTokenIds.value.forEach((id) => {
    if (isRunning(id)) stopOne(id);
  });
  selectedTokenIds.value = [];
  selectedGroupIds.value = [];
}

async function useTorchForSelected() {
  if (!selectedTokenIds.value.length) return;
  const option = torchOptions.find((o) => o.value === torchItemId.value);
  const itemName = option?.label || `#${torchItemId.value}`;
  torchRunning.value = true;
  let ok = 0,
    fail = 0;
  for (const id of selectedTokenIds.value) {
    const name = getTokenName(id);
    try {
      const token = getToken(id);
      const res = await api.levelPush.useTorch(
        id,
        torchItemId.value,
        torchQuantity.value,
        {
          token: token?.token,
          wsUrl: token?.wsUrl,
          name: token?.name,
        },
      );
      if (res.success && res.data?.success) {
        addLog(
          id,
          name,
          `使用 ${itemName} x${torchQuantity.value} 成功`,
          "success",
        );
        ok++;
      } else {
        addLog(
          id,
          name,
          `使用失败: ${res.data?.error || res.message}`,
          "error",
        );
        fail++;
      }
    } catch (err) {
      addLog(id, name, `使用失败: ${err?.message}`, "error");
      fail++;
    }
  }
  torchRunning.value = false;
  message.success(`使用 ${itemName}：成功 ${ok}，失败 ${fail}`);
}

// ─── 状态轮询 + SSE ───

async function pollAllStatus() {
  try {
    const res = await api.levelPush.getAllStatus();
    if (res.success && res.data) {
      for (const [tokenId, state] of Object.entries(res.data)) {
        backendStates[tokenId] = state;
      }
      // 清理已不在后端的状态
      for (const id of Object.keys(backendStates)) {
        if (!res.data[id]) {
          if (backendStates[id]?.running) backendStates[id].running = false;
        }
      }
    }
  } catch (e) {
    /* silent */
  }
}

function handleSSELevelPushLog(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.tokenId) {
      const name = getTokenName(data.tokenId);
      addLog(data.tokenId, name, data.msg, data.level || "info");
      if (data.state) backendStates[data.tokenId] = data.state;
    }
  } catch (e) {
    /* ignore */
  }
}

function handleSSELevelPushStatus(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.tokenId && data.state) {
      backendStates[data.tokenId] = data.state;
    }
  } catch (e) {
    /* ignore */
  }
}

// ─── lifecycle ───

onMounted(async () => {
  tokenStore.initTokenStore();

  // 初始加载后端状态
  await pollAllStatus();

  // 定时轮询（SSE 可能会断，兜底）
  statusPollTimer = setInterval(pollAllStatus, 10000);

  // 监听 SSE 事件（如果 tokenStore 的 SSE 已连接）
  // SSE 事件通过 window EventSource 接收，这里用 $emit 监听
  $emit.on("levelPushLog", handleSSELevelPushLog);
  $emit.on("levelPushStatus", handleSSELevelPushStatus);
});

onBeforeUnmount(() => {
  if (statusPollTimer) clearInterval(statusPollTimer);
  $emit.off("levelPushLog", handleSSELevelPushLog);
  $emit.off("levelPushStatus", handleSSELevelPushStatus);
  // 注意：不再停止推图，后端会继续运行
});
</script>

<style scoped>
.pushing-levels-page {
  height: 100%;
  min-height: 0;
  padding: 16px;
  background: #f6f8fb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.pl-header h2 {
  margin: 0;
  color: #1f2937;
  font-size: 22px;
  font-weight: 700;
}
.pl-header p {
  margin: 2px 0 0;
  color: #667085;
  font-size: 13px;
}
.pl-header-actions,
.account-toolbar,
.log-header,
.log-actions,
.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.retry-input {
  width: 110px;
}
.retry-label {
  color: #667085;
  font-size: 13px;
}
.account-card-top,
.control-card,
.log-card,
.running-card {
  border-radius: 8px;
}
.account-card-top :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
}
.search-input {
  width: 180px;
}
.group-list-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.group-chip {
  border: 1px solid;
  border-radius: 999px;
  padding: 2px 8px;
  background: #fff;
  font-size: 11px;
  cursor: pointer;
  line-height: 1.4;
}
.token-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 1100px) {
  .token-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .token-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .token-grid {
    grid-template-columns: 1fr;
  }
}
.token-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #e4e7ec;
  background: #fff;
  font-size: 12px;
  line-height: 1.4;
  transition:
    border-color 0.2s,
    background 0.2s;
  cursor: pointer;
}
.token-cell:hover {
  border-color: #98a2b3;
}
.token-cell.selected {
  background: #eef2ff;
  border-color: #c7d2fe;
}
.token-server {
  color: #667085;
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-sep {
  color: #98a2b3;
}
.token-name {
  color: #101828;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d0d5dd;
  display: inline-block;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.05);
}
.status-dot.small {
  width: 10px;
  height: 10px;
}
.status-gray {
  background: #d0d5dd;
}
.status-green {
  background: #12b76a;
}
.status-red {
  background: #f04438;
}
.status-blue {
  background: #2e90fa;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgba(46, 144, 250, 0.2);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(46, 144, 250, 0.05);
  }
}
.control-row {
  align-items: flex-end;
}
.torch-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #344054;
  font-size: 11px;
}
.torch-label {
  color: #667085;
}
.torch-select,
.torch-input {
  width: 120px;
}
.control-spacer {
  flex: 1;
}
.status-text {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
}
.running-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.running-card {
  min-height: 160px;
  border: 1px solid #e4e7ec;
}
.running-card.active {
  border-color: #12b76a;
}
.running-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.card-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.level-line,
.waiting-line,
.countdown-text,
.card-actions {
  color: #667085;
  font-size: 12px;
  line-height: 1.6;
}
.level-line {
  color: #344054;
}
.torch-line {
  color: #b54708;
  font-weight: 500;
}
.running-body {
  margin-top: 8px;
}
.countdown-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.countdown-text {
  color: #1d2939;
  font-weight: 600;
  white-space: nowrap;
}
.inline-progress {
  flex: 1;
  min-width: 0;
}
.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.err-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}
.log-card {
  min-height: 320px;
}
.log-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.log-filter-label {
  color: #667085;
  font-size: 12px;
}
.log-filter-select {
  width: 200px;
}
.log-filter-count {
  color: #98a2b3;
  font-size: 11px;
}
.log-container {
  height: 300px;
  overflow-y: auto;
  padding: 2px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 12px;
}
.log-item {
  display: grid;
  grid-template-columns: 74px minmax(110px, 180px) minmax(0, 1fr);
  gap: 8px;
  padding: 3px 6px;
  border-radius: 4px;
  color: #344054;
}
.log-item.success {
  color: #047857;
}
.log-item.warning {
  color: #b54708;
}
.log-item.error {
  background: #fff1f3;
  color: #b42318;
}
.log-name,
.log-msg {
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .pushing-levels-page {
    padding: 10px;
  }
  .pl-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .log-item {
    grid-template-columns: 64px minmax(80px, 110px) minmax(0, 1fr);
  }
  .torch-select,
  .torch-input,
  .log-filter-select {
    width: 100px;
  }
  .rules-grid {
    grid-template-columns: 1fr !important;
  }
}

/* 连接规则说明 */
.rules-banner {
  background: linear-gradient(135deg, #f0f4ff 0%, #fef6e4 100%);
  border: 1px solid #d6e0f0;
  border-radius: 10px;
  padding: 12px 16px;
}
.rules-title {
  font-size: 13px;
  font-weight: 600;
  color: #344054;
  margin-bottom: 8px;
}
.rules-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.rule-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.04);
}
.rule-icon {
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1.4;
}
.rule-item div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rule-item strong {
  font-size: 12px;
  color: #1f2937;
}
.rule-item span {
  font-size: 11px;
  color: #667085;
  line-height: 1.4;
}
</style>
