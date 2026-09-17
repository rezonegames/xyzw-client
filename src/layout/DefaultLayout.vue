<template>
  <div class="default-layout">
    <!-- 顶部导航 -->
    <nav class="dashboard-nav">
      <div class="nav-container">
        <div class="nav-brand">
          <img src="/icons/xiaoyugan.png" alt="XYZW" class="brand-logo" />
          <div class="brand-toggle" @click="isMobileMenuOpen = true">
            <n-icon><Menu /></n-icon>
            <span class="brand-text">XYZW</span>
          </div>
        </div>

        <div class="nav-menu">
          <router-link
            to="/admin/pushing-levels"
            class="nav-item"
            active-class="active"
          >
            <n-icon><ArrowUpCircle /></n-icon>
            <span>主线推关</span>
          </router-link>
          <router-link
            to="/admin/batch-daily-tasks"
            class="nav-item"
            active-class="active"
          >
            <n-icon><Layers /></n-icon>
            <span>批量日常</span>
          </router-link>
        </div>

        <!-- 右上角用户菜单 -->
        <div class="nav-user">
          <n-dropdown
            :options="userMenuOptions"
            @select="handleUserAction"
            trigger="click"
          >
            <div class="user-info">
              <n-avatar
                :size="32"
                :src="selectedToken?.avatar || '/icons/xiaoyugan.png'"
                round
              />
              <span class="username">{{
                authStore.userInfo?.username || "未登录"
              }}</span>
              <n-icon><ChevronDown /></n-icon>
            </div>
          </n-dropdown>
        </div>
      </div>
    </nav>

    <!-- 移动端抽屉菜单 -->
    <n-drawer v-model:show="isMobileMenuOpen" placement="left" :width="260">
      <n-drawer-content title="XYZW">
        <div class="drawer-menu">
          <router-link
            to="/admin/pushing-levels"
            class="drawer-item"
            @click="isMobileMenuOpen = false"
          >
            <n-icon><ArrowUpCircle /></n-icon>
            <span>主线推关</span>
          </router-link>
          <router-link
            to="/admin/batch-daily-tasks"
            class="drawer-item"
            @click="isMobileMenuOpen = false"
          >
            <n-icon><Layers /></n-icon>
            <span>批量日常</span>
          </router-link>
          <div class="drawer-divider" />
          <div
            class="drawer-item"
            @click="
              showTokenModal = true;
              isMobileMenuOpen = false;
            "
          >
            <n-icon><PersonCircle /></n-icon>
            <span>Token管理</span>
          </div>
          <div class="drawer-item" @click="handleLogout">
            <n-icon><LogOutOutline /></n-icon>
            <span>退出登录</span>
          </div>
        </div>
      </n-drawer-content>
    </n-drawer>

    <!-- Token管理弹窗 -->
    <n-modal
      v-model:show="showTokenModal"
      preset="card"
      title="Token 管理"
      style="max-width: 640px; width: 95vw"
      :content-style="{
        maxHeight: 'calc(100dvh - 120px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }"
    >
      <TokenManager @close="showTokenModal = false" />
    </n-modal>

    <!-- 主内容 -->
    <div class="main">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { ref, h } from "vue";
import { useRouter } from "vue-router";
import { useMessage } from "naive-ui";
import { useTokenStore, selectedToken } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/auth";
import TokenManager from "@/components/TokenManager.vue";
import {
  PersonCircle,
  ChevronDown,
  Menu,
  Layers,
  ArrowUpCircle,
  LogOutOutline,
} from "@vicons/ionicons5";

const tokenStore = useTokenStore();
const authStore = useAuthStore();
const router = useRouter();
const message = useMessage();

const isMobileMenuOpen = ref(false);
const showTokenModal = ref(false);

const userMenuOptions = [
  { label: "Token 管理", key: "tokens" },
  { type: "divider" },
  { label: "退出登录", key: "logout" },
];

const handleUserAction = (key) => {
  switch (key) {
    case "tokens":
      showTokenModal.value = true;
      break;
    case "logout":
      handleLogout();
      break;
  }
};

const handleLogout = () => {
  authStore.logout();
  tokenStore.disconnectSSE();
  message.success("已退出");
  router.push("/login");
};
</script>

<style scoped lang="scss">
.default-layout {
  min-height: 100dvh;
  background: var(--bg-secondary);
}

.dashboard-nav {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  padding: 0 var(--spacing-lg);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}

.nav-container {
  display: flex;
  align-items: center;
  height: 56px;
  max-width: 1400px;
  margin: 0 auto;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-right: var(--spacing-lg);
}

.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: var(--border-radius-small);
}

.brand-text {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.brand-toggle {
  display: none;
  align-items: center;
  gap: var(--spacing-xs);
  cursor: pointer;
}

.nav-menu {
  display: flex;
  gap: var(--spacing-sm);
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  &.active {
    background: var(--primary-color-light);
    color: var(--primary-color);
  }
}

.nav-user {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover {
    background: var(--bg-tertiary);
  }
}

.username {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 14px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main {
  flex: 1;
}

/* 移动端 */
@media (max-width: 768px) {
  .nav-menu {
    display: none;
  }
  .brand-logo {
    display: none;
  }
  .brand-toggle {
    display: inline-flex;
  }
  .nav-container {
    height: 48px;
  }
  .dashboard-nav {
    padding: 0 var(--spacing-md);
  }
  .username {
    display: none;
  }
}

.drawer-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  font-size: 15px;
  &:hover {
    background: var(--bg-tertiary);
  }
  &.router-link-active {
    background: var(--primary-color-light);
    color: var(--primary-color);
  }
}

.drawer-divider {
  height: 1px;
  background: var(--border-light);
  margin: 8px 0;
}
</style>
