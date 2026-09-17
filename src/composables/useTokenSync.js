/**
 * Token 后端同步层
 * 
 * tokenStore 仍然用 localStorage 管理运行时数据（WebSocket 连接、游戏数据等），
 * 这个 composable 负责在关键操作时同步到后端 MongoDB：
 * - 登录后：从后端拉取 token 列表，写入 localStorage
 * - 添加 token：同步到后端
 * - 删除 token：同步到后端
 * - 定期同步：保持数据一致
 */
import api from "@/api/index";
import { gameTokens } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/auth";
import { watch } from "vue";

let syncInProgress = false;

/**
 * 从后端拉取 token 列表并写入 localStorage（覆盖）
 */
export async function pullTokensFromServer() {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;

  try {
    const res = await api.tokens.getList();
    if (res.success && Array.isArray(res.data)) {
      syncInProgress = true;

      if (res.data.length === 0 && gameTokens.value.length > 0) {
        // 服务端没有数据但本地有 → 先推送本地数据到服务端
        console.log(`[TokenSync] 服务端无数据，推送本地 ${gameTokens.value.length} 个 token`);
        await pushTokensToServer();
        syncInProgress = false;
        return;
      }

      if (res.data.length > 0) {
        // 将后端数据转为前端 TokenData 格式
        const serverTokens = res.data.map((t) => ({
          id: t._id,
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
          isActive: t.isActive !== false,
          createdAt: t.createdAt,
          lastUsed: t.lastUsed,
          updatedAt: t.updatedAt,
          dailySettings: t.dailySettings || {},
        }));

        gameTokens.value = serverTokens;
        console.log(`[TokenSync] 从服务器拉取了 ${serverTokens.length} 个 token`);
      }

      syncInProgress = false;
    }
  } catch (err) {
    syncInProgress = false;
    console.error("[TokenSync] 拉取失败:", err);
  }
}

/**
 * 将当前 localStorage 中的所有 token 推送到后端（全量同步）
 */
export async function pushTokensToServer() {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;

  try {
    const tokens = gameTokens.value.map((t) => ({
      name: t.name,
      token: t.token,
      wsUrl: t.wsUrl,
      server: t.server,
      remark: t.remark,
      importMethod: t.importMethod,
      sourceUrl: t.sourceUrl,
      avatar: t.avatar,
      level: t.level,
      profession: t.profession,
      roleId: t.roleId || t.id,
    }));

    const res = await api.tokens.import(tokens);
    if (res.success) {
      console.log(`[TokenSync] 推送完成: ${res.message}`);
    }
  } catch (err) {
    console.error("[TokenSync] 推送失败:", err);
  }
}

/**
 * 同步单个 token 到后端（添加或更新）
 */
export async function syncTokenToServer(tokenData) {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;

  try {
    await api.tokens.add({
      name: tokenData.name,
      token: tokenData.token,
      wsUrl: tokenData.wsUrl,
      server: tokenData.server,
      remark: tokenData.remark,
      importMethod: tokenData.importMethod,
      sourceUrl: tokenData.sourceUrl,
      avatar: tokenData.avatar,
      level: tokenData.level,
      profession: tokenData.profession,
      roleId: tokenData.roleId || tokenData.id,
    });
  } catch (err) {
    console.error("[TokenSync] 同步单个token失败:", err);
  }
}

/**
 * 从后端删除 token
 */
export async function deleteTokenFromServer(tokenId) {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;

  try {
    await api.tokens.delete(tokenId);
  } catch (err) {
    console.error("[TokenSync] 删除token失败:", err);
  }
}

/**
 * 初始化同步：登录后调用
 */
export function initTokenSync() {
  const authStore = useAuthStore();

  // 监听登录状态，登录后自动拉取
  watch(
    () => authStore.isAuthenticated,
    async (isAuth) => {
      if (isAuth) {
        await pullTokensFromServer();
      }
    },
    { immediate: true },
  );
}
