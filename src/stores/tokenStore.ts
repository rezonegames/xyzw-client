import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { gameLogger, tokenLogger, wsLogger } from "@/utils/logger";

import useIndexedDB from "@/hooks/useIndexedDB";
import { generateRandomSeed } from "@/utils/randomSeed";
import {
  transformToken,
  setAuthUserRateLimiterCallback,
  scheduleAuthUserRequest,
} from "@/utils/token";
import { emitPlus, $emit } from "./events/index.js";
import router from "@/router";
import api from "@/api/index";

const { getArrayBuffer, storeArrayBuffer, deleteArrayBuffer, clearAll } =
  useIndexedDB();

declare interface TokenData {
  id: string;
  name: string;
  token: string;
  wsUrl: string | null;
  server: string;
  remark?: string;
  importMethod?: "manual" | "bin" | "url" | "wxQrcode";
  sourceUrl?: string;
  avatar?: string;
  level?: number;
  profession?: string;
  upgradedToPermanent?: boolean;
  upgradedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  lastUsed?: string;
  isActive?: boolean;
}

// 后端连接状态（从 SSE/API 获取）
declare interface BackendConnectionState {
  status:
    | "connecting"
    | "connected"
    | "disconnected"
    | "reconnecting"
    | "error";
  connected: boolean;
  tokenName: string;
  lastActivity: string | null;
  reconnectCount: number;
  roleName?: string | null;
  roleLevel?: number | null;
  roleAvatar?: string | null;
  hasGameData?: boolean;
  error?: string | null;
  lastError?: { timestamp: string; error: string } | null;
}

// 分组接口定义
declare interface TokenGroup {
  id: string;
  name: string;
  color: string;
  tokenIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const gameTokens = ref<TokenData[]>([]);
export const hasTokens = computed(() => gameTokens.value.length > 0);
export const selectedTokenId = ref("");
export const selectedToken = computed(() => {
  return gameTokens.value?.find((token) => token.id === selectedTokenId.value);
});
export const selectedRoleInfo = ref<any>(null);

// Token分组管理 — 纯内存，从后端或初始化时加载
export const tokenGroups = ref<TokenGroup[]>([]);

/**
 * Token管理存储 — 后端 WebSocket 架构版
 * WebSocket 连接由后端 ConnectionManager 统一管理
 * 前端通过 REST API + SSE 与后端交互
 */
export const useTokenStore = defineStore("tokens", () => {
  // 后端连接状态缓存: tokenId → BackendConnectionState
  const wsConnections = ref<Record<string, Partial<BackendConnectionState>>>(
    {},
  );

  // SSE 连接实例
  let sseSource: EventSource | null = null;
  let sseRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // 游戏数据存储（从后端 SSE 推送填充）
  const gameData = ref({
    roleInfo: null as any,
    legionInfo: null as any,
    commonActivityInfo: null as any,
    bossTowerInfo: null as any,
    evoTowerInfo: null as any,
    presetTeam: null as any,
    battleVersion: null as number | null,
    studyStatus: {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: "",
      timestamp: null,
    },
    lastUpdated: null as string | null,
  });

  // 获取当前选中token的角色信息
  const selectedTokenRoleInfo = computed(() => {
    return gameData.value.roleInfo;
  });

  // ─────────── SSE 管理 ───────────

  /**
   * 建立 SSE 连接，接收后端实时推送
   */
  const connectSSE = () => {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }

    const token = localStorage.getItem("token");
    if (!token) return;

    // SSE 需要通过 URL 传递 token（EventSource 不支持自定义 header）
    // 方案：通过 query 参数传递
    const url = `/api/v1/connections/events?token=${encodeURIComponent(token)}`;
    sseSource = new EventSource(url);

    sseSource.onopen = () => {
      wsLogger.info("[SSE] 连接建立");
    };

    // 初始快照
    sseSource.addEventListener("snapshot", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.connections) {
          for (const conn of data.connections) {
            wsConnections.value[conn.tokenId] = {
              status: conn.status,
              connected: conn.connected,
              tokenName: conn.tokenName,
              lastActivity: conn.lastActivity,
              reconnectCount: conn.reconnectCount,
              roleName: conn.roleName,
              roleLevel: conn.roleLevel,
              roleAvatar: conn.roleAvatar,
              hasGameData: conn.hasGameData,
            };
          }
        }
      } catch (e) {
        wsLogger.error("[SSE] 解析 snapshot 失败:", e);
      }
    });

    // 连接状态更新
    sseSource.addEventListener("connectionStatus", (event) => {
      try {
        const data = JSON.parse(event.data);
        const { tokenId, ...state } = data;
        if (!tokenId) return;

        wsConnections.value[tokenId] = {
          ...wsConnections.value[tokenId],
          ...state,
        };

        // 映射 error → lastError（兼容旧代码）
        if (state.status === "error" && state.error) {
          wsConnections.value[tokenId].lastError = {
            timestamp: new Date().toISOString(),
            error: state.error,
          };
        } else if (state.status === "connected") {
          wsConnections.value[tokenId].lastError = null;
        }

        wsLogger.info(`[SSE] 连接状态更新: ${tokenId} → ${state.status}`);

        // 连接成功时触发事件
        if (state.status === "connected" && tokenId === selectedTokenId.value) {
          // 主动获取游戏数据
          fetchGameData(tokenId);
        }
      } catch (e) {
        wsLogger.error("[SSE] 解析 connectionStatus 失败:", e);
      }
    });

    // 角色信息推送
    sseSource.addEventListener("roleInfo", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tokenId === selectedTokenId.value && data.roleInfo) {
          gameData.value.roleInfo = data.roleInfo;
          gameData.value.lastUpdated = new Date().toISOString();

          // 触发事件系统（兼容现有组件）
          emitPlus("role_getroleinforesp", {
            tokenId: data.tokenId,
            body: data.roleInfo,
            message: {
              cmd: "role_getroleinforesp",
              getData: () => data.roleInfo,
            },
            client: null,
            gameData,
          });
        }
      } catch (e) {
        wsLogger.error("[SSE] 解析 roleInfo 失败:", e);
      }
    });

    // 军团信息推送
    sseSource.addEventListener("legionInfo", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tokenId === selectedTokenId.value && data.legionInfo) {
          gameData.value.legionInfo = data.legionInfo;
        }
      } catch (e) {
        /* ignore */
      }
    });

    // 任务进度推送
    sseSource.addEventListener("taskProgress", (event) => {
      try {
        const data = JSON.parse(event.data);
        $emit.emit("task:progress", data);
      } catch (e) {
        /* ignore */
      }
    });

    // 通用游戏消息
    sseSource.addEventListener("gameMessage", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tokenId === selectedTokenId.value) {
          gameLogger.gameMessage(data.tokenId, data.cmd, data.hasBody);
        }
      } catch (e) {
        /* ignore */
      }
    });

    // 推关日志（LevelPusher → 前端）
    sseSource.addEventListener("levelPushLog", (event) => {
      $emit.emit("levelPushLog", event);
    });

    // 推关状态更新
    sseSource.addEventListener("levelPushStatus", (event) => {
      $emit.emit("levelPushStatus", event);
    });

    sseSource.onerror = () => {
      wsLogger.warn("[SSE] 连接断开，5秒后重试");
      sseSource?.close();
      sseSource = null;
      // 自动重连
      if (sseRetryTimer) clearTimeout(sseRetryTimer);
      sseRetryTimer = setTimeout(connectSSE, 5000);
    };
  };

  /**
   * 关闭 SSE 连接
   */
  const disconnectSSE = () => {
    if (sseRetryTimer) {
      clearTimeout(sseRetryTimer);
      sseRetryTimer = null;
    }
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
  };

  // ─────────── 从后端获取游戏数据 ───────────

  /**
   * 从后端获取缓存的游戏数据
   */
  const fetchGameData = async (tokenId: string) => {
    try {
      const res = await api.connections.getGameData(tokenId);
      if (res.success && res.data) {
        if (res.data.roleInfo) {
          gameData.value.roleInfo = res.data.roleInfo;
        }
        if (res.data.legionInfo) {
          gameData.value.legionInfo = res.data.legionInfo;
        }
        if (res.data.presetTeam) {
          gameData.value.presetTeam = res.data.presetTeam;
        }
        if (res.data.battleVersion !== undefined) {
          gameData.value.battleVersion = res.data.battleVersion;
        }
        gameData.value.lastUpdated =
          res.data.lastUpdated || new Date().toISOString();
      }
    } catch (e) {
      gameLogger.warn(`获取游戏数据失败 [${tokenId}]:`, e);
    }
  };

  // ─────────── Token CRUD ───────────

  const addToken = (tokenData: TokenData) => {
    let id =
      tokenData.id ||
      `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newToken = {
      id: id,
      name: tokenData.name,
      token: tokenData.token,
      wsUrl: tokenData.wsUrl || null,
      server: tokenData.server || "",
      remark: tokenData.remark || "",
      roleId: tokenData.roleId || "",
      level: tokenData.level || 1,
      profession: tokenData.profession || "",
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      isActive: true,
      sourceUrl: tokenData.sourceUrl || null,
      importMethod: tokenData.importMethod || "manual",
      avatar: tokenData.avatar || "",
    };

    gameTokens.value.push(newToken);

    // 同步到后端
    api.tokens
      .add(newToken)
      .catch((e: any) => console.warn("[TokenSync] add failed:", e?.message));

    return newToken;
  };

  const updateToken = (tokenId: string, updates: Partial<TokenData>) => {
    const index = gameTokens.value.findIndex((token) => token.id === tokenId);
    if (index !== -1) {
      gameTokens.value[index] = {
        ...gameTokens.value[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      // 同步到后端
      api.tokens
        .update(tokenId, updates)
        .catch((e: any) =>
          console.warn("[TokenSync] update failed:", e?.message),
        );

      return true;
    }
    return false;
  };

  const removeToken = async (tokenId: string) => {
    gameTokens.value = gameTokens.value.filter((token) => token.id !== tokenId);

    // 后端断开连接 + 删除 token
    api.connections.disconnect(tokenId).catch(() => {});
    api.tokens
      .delete(tokenId)
      .catch((e: any) =>
        console.warn("[TokenSync] delete failed:", e?.message),
      );

    // 清理本地连接状态
    delete wsConnections.value[tokenId];

    if (selectedTokenId.value === tokenId) {
      selectedTokenId.value = null;
    }

    await deleteArrayBuffer(tokenId);
    return true;
  };

  const selectToken = (tokenId: string, forceReconnect = false) => {
    const token = gameTokens.value.find((t) => t.id === tokenId);
    if (!token) return null;

    const isAlreadySelected = selectedTokenId.value === tokenId;
    const existingConn = wsConnections.value[tokenId];
    const isConnected = existingConn?.status === "connected";

    selectedTokenId.value = tokenId;
    updateToken(tokenId, { lastUsed: new Date().toISOString() });

    // 如果已连接且不需要强制重连，直接返回
    if (isConnected && !forceReconnect) {
      // 获取后端缓存的游戏数据
      fetchGameData(tokenId);
      return token;
    }

    // 需要建立连接
    const shouldConnect =
      forceReconnect ||
      !isAlreadySelected ||
      !existingConn ||
      existingConn.status === "disconnected" ||
      existingConn.status === "error";

    if (shouldConnect) {
      wsLogger.info(`通过后端建立连接: ${tokenId}`);
      createWebSocketConnection(tokenId, token.token, token.wsUrl);
    }

    return token;
  };

  // ─────────── Token刷新 ───────────

  const tokenRefreshAttempts = ref<Record<string, number>>({});

  const attemptTokenRefresh = async (
    tokenId: string,
    forceReconnect = false,
  ) => {
    const lastAttempt = tokenRefreshAttempts.value[tokenId] || 0;
    const now = Date.now();
    if (now - lastAttempt < 10000) {
      wsLogger.warn(`Token刷新过于频繁，跳过 [${tokenId}]`);
      return false;
    }
    tokenRefreshAttempts.value[tokenId] = now;

    const gameToken = gameTokens.value.find((t) => t.id === tokenId);
    if (!gameToken) return false;

    wsLogger.info(`尝试自动刷新Token [${tokenId}]`);
    let refreshSuccess = false;

    try {
      if (gameToken.importMethod === "url" && gameToken.sourceUrl) {
        const token = await scheduleAuthUserRequest(async () => {
          const response = await fetch(gameToken.sourceUrl!);
          if (response.ok) {
            const data = await response.json();
            if (data.token) return data.token;
          }
          return null;
        });
        if (token) {
          updateToken(tokenId, { ...gameToken, token });
          refreshSuccess = true;
        }
      } else if (
        gameToken.importMethod === "bin" ||
        gameToken.importMethod === "wxQrcode"
      ) {
        let userToken: ArrayBuffer | null = await getArrayBuffer(tokenId);
        let usedOldKey = false;

        if (!userToken) {
          const tokenByName = await getArrayBuffer(gameToken.name);
          if (tokenByName) {
            userToken = tokenByName;
            usedOldKey = true;
          }
        }

        if (userToken) {
          const token = await transformToken(userToken);
          updateToken(tokenId, { ...gameToken, token });
          if (usedOldKey) {
            const saved = await storeArrayBuffer(tokenId, userToken);
            if (saved) await deleteArrayBuffer(gameToken.name);
          }
          refreshSuccess = true;
        }
      }
    } catch (error) {
      wsLogger.error(`Token刷新过程出错 [${tokenId}]:`, error);
    }

    if (refreshSuccess) {
      wsLogger.info(`Token刷新成功 [${tokenId}]`);
      if (forceReconnect) {
        selectToken(tokenId, true);
      }
      return true;
    }

    wsLogger.error(`Token刷新失败，请手动重新导入 [${tokenId}]`);
    return false;
  };

  // ─────────── WebSocket 连接管理（通过后端 API）───────────

  /**
   * 通过后端 API 建立 WebSocket 连接
   */
  const createWebSocketConnection = async (
    tokenId: string,
    base64Token: string,
    customWsUrl: string | null = null,
  ) => {
    wsLogger.info(`[Backend] 请求建立连接: ${tokenId}`);

    // 更新本地状态
    wsConnections.value[tokenId] = {
      status: "connecting",
      connected: false,
      tokenName: gameTokens.value.find((t) => t.id === tokenId)?.name || "",
    };

    try {
      const tokenData = gameTokens.value.find((t) => t.id === tokenId);
      const res = await api.connections.connect(tokenId, {
        token: base64Token,
        wsUrl: customWsUrl,
        name: tokenData?.name || tokenId,
      });
      if (res.success) {
        wsLogger.info(
          `[Backend] 连接请求已发送: ${tokenId}, status: ${res.data.status}`,
        );
      }
      return res;
    } catch (err: any) {
      wsLogger.error(`[Backend] 连接请求失败 [${tokenId}]:`, err?.message);
      wsConnections.value[tokenId] = {
        status: "error",
        connected: false,
        error: err?.message,
      };
      return null;
    }
  };

  /**
   * 关闭连接 — 后端架构下改为空操作（仅清理本地状态）
   * 批量任务/组件卸载等场景调此方法不会真的断开后端游戏连接
   * 真正需要断开时用 forceDisconnect
   */
  const closeWebSocketConnection = (_tokenId: string) => {
    // 不再调用后端断开 API，后端连接由后端自己管理
    // 只是前端 UI 不再跟踪此连接状态
  };

  const closeWebSocketConnectionAsync = async (_tokenId: string) => {
    // 空操作，兼容旧代码
  };

  /**
   * 强制断开后端连接（用户手动断开、删除 token 时调用）
   */
  const forceDisconnect = async (tokenId: string) => {
    try {
      await api.connections.disconnect(tokenId);
      delete wsConnections.value[tokenId];
      wsLogger.info(`[Backend] 连接已断开: ${tokenId}`);
    } catch (err: any) {
      wsLogger.error(`[Backend] 断开连接失败 [${tokenId}]:`, err?.message);
    }
  };

  /**
   * 获取连接状态
   */
  const getWebSocketStatus = (tokenId: string): string => {
    return wsConnections.value[tokenId]?.status || "disconnected";
  };

  /**
   * 获取 WebSocket 客户端（后端架构下返回 null，兼容旧代码）
   */
  const getWebSocketClient = (_tokenId: string) => {
    return null;
  };

  // ─────────── 消息发送（通过后端 API）───────────

  /**
   * 发送消息到游戏服务器（fire-and-forget）
   */
  const sendMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    _options = {},
  ) => {
    const conn = wsConnections.value[tokenId];
    if (!conn || conn.status !== "connected") {
      wsLogger.error(`未连接，无法发送消息 [${tokenId}]`);
      return false;
    }

    // 通过后端发送（异步，不等待结果）
    api.connections
      .sendCommand(tokenId, cmd, params, 8000)
      .catch((err: any) => {
        wsLogger.error(`发送失败 [${tokenId}] ${cmd}:`, err?.message);
      });

    wsLogger.wsMessage(tokenId, cmd, false);
    return true;
  };

  /**
   * Promise 版发送消息（等待响应）
   */
  const sendMessageWithPromise = async (
    tokenId: string,
    cmd: string,
    params = {},
    timeout = 8000,
  ): Promise<any> => {
    const conn = wsConnections.value[tokenId];
    if (!conn || conn.status !== "connected") {
      throw new Error(`WebSocket未连接 [${tokenId}]`);
    }

    try {
      const res = await api.connections.sendCommand(
        tokenId,
        cmd,
        params,
        timeout,
      );
      if (res.success) {
        return res.data;
      }
      throw new Error(res.message || "命令执行失败");
    } catch (err: any) {
      const message = err?.message || "请求失败";
      wsLogger.error(`命令失败 [${tokenId}] ${cmd}:`, message);
      throw new Error(message);
    }
  };

  /**
   * 设置消息监听器（后端架构下为空操作，兼容旧代码）
   */
  const setMessageListener = (_listener: any) => {
    // 后端架构下通过 SSE 接收消息，不需要手动设置监听器
  };

  const setShowMsg = (_show: any) => {
    // 兼容旧代码
  };

  const sendHeartbeat = (_tokenId: string) => {
    // 后端自动管理心跳
    return true;
  };

  // ─────────── 快捷命令方法 ───────────

  const sendGetRoleInfo = async (
    tokenId: string,
    params = {},
    retryCount = 0,
  ) => {
    try {
      const roleInfo = await sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        params,
        15000,
      );
      if (roleInfo) {
        gameData.value.roleInfo = roleInfo;
        gameData.value.lastUpdated = new Date().toISOString();
      }
      return roleInfo;
    } catch (error: any) {
      if (retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return sendGetRoleInfo(tokenId, params, retryCount + 1);
      }
      throw error;
    }
  };

  const sendGetDataBundleVersion = (tokenId: string, params = {}) => {
    return sendMessageWithPromise(tokenId, "system_getdatabundlever", params);
  };

  const sendSignIn = (tokenId: string) => {
    return sendMessageWithPromise(tokenId, "system_signinreward");
  };

  const sendClaimDailyReward = (tokenId: string, rewardId = 0) => {
    return sendMessageWithPromise(tokenId, "task_claimdailyreward", {
      rewardId,
    });
  };

  const sendGetTeamInfo = (tokenId: string, params = {}) => {
    return sendMessageWithPromise(tokenId, "presetteam_getinfo", params);
  };

  const sendMessageToWorld = (tokenId: string, message: string) => {
    return sendMessageWithPromise(tokenId, "system_sendchatmessage", {
      channel: 1,
      emojiId: 0,
      extra: null,
      msg: message,
      msgType: 1,
    });
  };

  const sendMessageToLegion = (tokenId: string, message: string) => {
    return sendMessageWithPromise(tokenId, "system_sendchatmessage", {
      channel: 2,
      emojiId: 0,
      extra: null,
      msg: message,
      msgType: 1,
    });
  };

  const sendGameMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options: any = {},
  ) => {
    if (options.usePromise) {
      return sendMessageWithPromise(tokenId, cmd, params, options.timeout);
    } else {
      return sendMessage(tokenId, cmd, params, options);
    }
  };

  // ─────────── 游戏数据读取 ───────────

  const getCurrentTowerLevel = () => {
    try {
      const roleInfo = gameData.value.roleInfo;
      if (!roleInfo?.role?.tower) return null;
      const tower = roleInfo.role.tower;
      return tower.level || tower.currentLevel || tower.floor || tower.stage;
    } catch (error) {
      return null;
    }
  };

  const getTowerInfo = () => {
    try {
      return gameData.value.roleInfo?.role?.tower || null;
    } catch (error) {
      return null;
    }
  };

  const setBattleVersion = (version: number | null) => {
    gameData.value.battleVersion = version;
    gameData.value.lastUpdated = new Date().toISOString();
  };

  const getBattleVersion = () => {
    return gameData.value.battleVersion;
  };

  // ─────────── Base64 解析 ───────────

  const validateToken = (token: any) => {
    if (!token || typeof token !== "string") return false;
    return token.trim().length >= 10;
  };

  const parseBase64Token = (base64String: string) => {
    try {
      if (!base64String || typeof base64String !== "string") {
        throw new Error("Token字符串无效");
      }

      const cleanBase64 = base64String.replace(/^data:.*base64,/, "").trim();
      if (cleanBase64.length === 0) throw new Error("Token字符串为空");

      let decoded;
      try {
        decoded = atob(cleanBase64);
      } catch {
        decoded = base64String.trim();
      }

      let tokenData;
      try {
        tokenData = JSON.parse(decoded);
      } catch {
        tokenData = { token: decoded };
      }

      const actualToken = tokenData.token || tokenData.gameToken || decoded;

      if (!validateToken(actualToken)) {
        throw new Error(`提取的token无效: "${actualToken}"`);
      }

      return {
        success: true,
        data: { ...tokenData, actualToken },
      };
    } catch (error: any) {
      return {
        success: false,
        error: "解析失败：" + error.message,
      };
    }
  };

  const importBase64Token = (
    name: string,
    base64String: string,
    additionalInfo = {},
  ) => {
    const parseResult = parseBase64Token(base64String);

    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error,
        message: `Token "${name}" 导入失败: ${parseResult.error}`,
      };
    }

    const tokenData = {
      name,
      token: parseResult.data.actualToken,
      ...additionalInfo,
      ...parseResult.data,
    };

    try {
      const newToken = addToken(tokenData);
      const tokenInfo = parseResult.data.actualToken;
      const displayToken =
        tokenInfo.length > 20
          ? `${tokenInfo.substring(0, 10)}...${tokenInfo.substring(tokenInfo.length - 6)}`
          : tokenInfo;

      return {
        success: true,
        token: newToken,
        tokenName: name,
        message: `Token "${name}" 导入成功`,
        details: `实际Token: ${displayToken}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Token "${name}" 添加失败: ${error.message}`,
      };
    }
  };

  // ─────────── 导入/导出/清理 ───────────

  const exportTokens = () => ({
    tokens: gameTokens.value,
    exportedAt: new Date().toISOString(),
    version: "2.0",
  });

  const importTokens = (data: any) => {
    try {
      if (data.tokens && Array.isArray(data.tokens)) {
        gameTokens.value = data.tokens;
        return {
          success: true,
          message: `成功导入 ${data.tokens.length} 个Token`,
        };
      }
      return { success: false, message: "导入数据格式错误" };
    } catch (error: any) {
      return { success: false, message: "导入失败：" + error.message };
    }
  };

  const clearAllTokens = async () => {
    // 断开所有后端连接
    for (const tokenId of Object.keys(wsConnections.value)) {
      api.connections.disconnect(tokenId).catch(() => {});
    }
    wsConnections.value = {};
    gameTokens.value = [];
    tokenGroups.value = [];
    selectedTokenId.value = null;
    selectedRoleInfo.value = null;
    await clearAll();
  };

  const cleanExpiredTokens = async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const tokensToRemove = gameTokens.value.filter((token) => {
      if (
        token.importMethod === "url" ||
        token.importMethod === "bin" ||
        token.importMethod === "wxQrcode" ||
        token.upgradedToPermanent
      ) {
        return false;
      }
      const lastUsed = new Date(token.lastUsed || token.createdAt);
      return lastUsed <= oneDayAgo;
    });

    for (const token of tokensToRemove) {
      await removeToken(token.id);
    }

    return tokensToRemove.length;
  };

  const upgradeTokenToPermanent = (tokenId: string) => {
    const token = gameTokens.value.find((t) => t.id === tokenId);
    if (
      token &&
      !token.upgradedToPermanent &&
      token.importMethod !== "url" &&
      token.importMethod !== "bin" &&
      token.importMethod !== "wxQrcode"
    ) {
      updateToken(tokenId, {
        upgradedToPermanent: true,
        upgradedAt: new Date().toISOString(),
      });
      return true;
    }
    return false;
  };

  // ─────────── 连接监控（简化版）───────────

  const validateConnectionUniqueness = (_tokenId: string) => true;

  const connectionMonitor = {
    startMonitoring: () => {
      // 后端架构下由后端管理连接，前端只需定期同步状态
      setInterval(async () => {
        try {
          const res = await api.connections.list();
          if (res.success && res.data) {
            // 更新本地连接状态
            const activeIds = new Set<string>();
            for (const conn of res.data) {
              activeIds.add(conn.tokenId);
              wsConnections.value[conn.tokenId] = {
                status: conn.status,
                connected: conn.connected,
                tokenName: conn.tokenName,
                lastActivity: conn.lastActivity,
                reconnectCount: conn.reconnectCount,
                roleName: conn.roleName,
                roleLevel: conn.roleLevel,
                roleAvatar: conn.roleAvatar,
                hasGameData: conn.hasGameData,
              };
            }
            // 清理不存在的连接
            for (const id of Object.keys(wsConnections.value)) {
              if (!activeIds.has(id)) {
                delete wsConnections.value[id];
              }
            }
          }
        } catch (e) {
          // 静默
        }
      }, 30000); // 每30秒同步一次
    },
    getStats: () => ({
      totalConnections: Object.keys(wsConnections.value).length,
      connectedCount: Object.values(wsConnections.value).filter(
        (c) => c.status === "connected",
      ).length,
      connectingCount: Object.values(wsConnections.value).filter(
        (c) => c.status === "connecting",
      ).length,
      disconnectedCount: Object.values(wsConnections.value).filter(
        (c) => c.status === "disconnected",
      ).length,
      errorCount: Object.values(wsConnections.value).filter(
        (c) => c.status === "error",
      ).length,
      duplicateTokens: [],
      activeLocks: 0,
      crossTabStates: 0,
    }),
    forceCleanup: async () => {
      for (const tokenId of Object.keys(wsConnections.value)) {
        await forceDisconnect(tokenId);
      }
    },
  };

  // ─────────── 初始化 ───────────

  const initTokenStore = () => {
    // 先清空所有本地缓存数据，避免切换账号时显示上一个用户的数据
    gameTokens.value = [];
    tokenGroups.value = [];
    selectedTokenId.value = "";
    selectedRoleInfo.value = null;
    wsConnections.value = {};

    // 从后端拉取当前用户的 token 列表（唯一数据源）
    api.tokens
      .getList()
      .then((res: any) => {
        if (res.success && Array.isArray(res.data)) {
          // 后端返回的是当前登录用户的 token，用它覆盖 localStorage
          const backendTokens = res.data.map((t: any) => ({
            id: t._id || t.id || t.roleId,
            name: t.name,
            token: t.token,
            wsUrl: t.wsUrl || null,
            server: t.server || "",
            remark: t.remark || "",
            importMethod: t.importMethod || "manual",
            sourceUrl: t.sourceUrl || "",
            avatar: t.avatar || "",
            level: t.level || 0,
            profession: t.profession || "",
            roleId: t.roleId || "",
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            lastUsed: t.lastUsed,
          }));
          gameTokens.value = backendTokens;
          tokenLogger.info(`从后端加载 ${backendTokens.length} 个 Token`);
        }
      })
      .catch(() => {
        // 后端不可用时保留本地数据
      });

    // 建立 SSE 连接
    connectSSE();

    // 启动连接状态同步
    connectionMonitor.startMonitoring();

    // 设置限流等待回调
    setAuthUserRateLimiterCallback((waitTimeMs: number, queueSize: number) => {
      const waitSeconds = Math.ceil(waitTimeMs / 1000);
      $emit.emit("token:refresh:waiting", {
        waitTimeMs,
        waitSeconds,
        queueSize,
        timestamp: Date.now(),
      });
    });

    tokenLogger.info("Token Store 初始化完成（后端 WebSocket 架构）");
  };

  // ─────────── Token 分组管理 ───────────

  const createTokenGroup = (name: string, color: string = "#1677ff") => {
    const group: TokenGroup = {
      id: "group_" + Date.now() + Math.random().toString(36).slice(2),
      name,
      color,
      tokenIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tokenGroups.value.push(group);
    return group;
  };

  const deleteTokenGroup = (groupId: string) => {
    const index = tokenGroups.value.findIndex((g) => g.id === groupId);
    if (index !== -1) tokenGroups.value.splice(index, 1);
  };

  const updateTokenGroup = (groupId: string, updates: Partial<TokenGroup>) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group)
      Object.assign(group, updates, { updatedAt: new Date().toISOString() });
  };

  const addTokenToGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group && !group.tokenIds.includes(tokenId)) {
      group.tokenIds.push(tokenId);
      group.updatedAt = new Date().toISOString();
    }
  };

  const removeTokenFromGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group) {
      const index = group.tokenIds.indexOf(tokenId);
      if (index !== -1) {
        group.tokenIds.splice(index, 1);
        group.updatedAt = new Date().toISOString();
      }
    }
  };

  const getTokenGroups = (tokenId: string): TokenGroup[] => {
    return tokenGroups.value.filter((g) => g.tokenIds.includes(tokenId));
  };

  const getGroupTokenIds = (groupId: string): string[] => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    return group ? group.tokenIds : [];
  };

  const getValidGroupTokenIds = (groupId: string): string[] => {
    const tokenIds = getGroupTokenIds(groupId);
    const validTokenIds = gameTokens.value.map((t) => t.id);
    return tokenIds.filter((id) => validTokenIds.includes(id));
  };

  const cleanupInvalidTokens = () => {
    const validTokenIds = new Set(gameTokens.value.map((t) => t.id));
    tokenGroups.value.forEach((group) => {
      group.tokenIds = group.tokenIds.filter((id) => validTokenIds.has(id));
    });
  };

  return {
    // 状态
    gameTokens,
    selectedTokenId,
    wsConnections,
    gameData,

    // 计算属性
    hasTokens,
    selectedToken,
    selectedTokenRoleInfo,

    // Token管理方法
    addToken,
    updateToken,
    removeToken,
    selectToken,

    // Base64解析方法
    parseBase64Token,
    importBase64Token,

    // WebSocket方法（通过后端 API）
    createWebSocketConnection,
    closeWebSocketConnection,
    forceDisconnect,
    getWebSocketStatus,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
    setMessageListener,
    setShowMsg,
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendGameMessage,

    // 工具方法
    exportTokens,
    importTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
    initTokenStore,

    // 游戏内发送消息方法
    sendMessageToLegion,
    sendMessageToWorld,

    // 塔信息方法
    getCurrentTowerLevel,
    getTowerInfo,

    // battleVersion
    setBattleVersion,
    getBattleVersion,

    // 调试工具方法
    validateToken,
    debugToken: (tokenString: string) => {
      console.log("🔍 Token调试信息:");
      console.log("原始Token:", tokenString);
      const parseResult = parseBase64Token(tokenString);
      console.log("解析结果:", parseResult);
      if (parseResult.success) {
        console.log("实际Token:", parseResult.data.actualToken);
        console.log(
          "Token有效性:",
          validateToken(parseResult.data.actualToken),
        );
      }
      return parseResult;
    },

    // 连接管理
    validateConnectionUniqueness,
    connectionMonitor,
    currentSessionId: () => "backend-managed",

    // SSE 管理
    connectSSE,
    disconnectSSE,

    // Token分组管理方法
    tokenGroups,
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,

    // 开发者工具
    devTools: {
      getConnectionStats: () => connectionMonitor.getStats(),
      forceCleanup: () => connectionMonitor.forceCleanup(),
      showConnectionLocks: () => [],
      showCrossTabStates: () => [],
      testDuplicateConnection: (_tokenId: string) => {
        console.log("后端架构下不支持重复连接测试");
      },
    },
  };
});
