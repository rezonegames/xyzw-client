import { defineStore } from "pinia";
import { ref, computed } from "vue";
import api from "@/api/index";

export const useAuthStore = defineStore("auth", () => {
  // 状态
  const user = ref(null);
  const token = ref(localStorage.getItem("token") || null);
  const isLoading = ref(false);

  // 计算属性
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const userInfo = computed(() => user.value);

  // 登录
  const login = async (credentials) => {
    try {
      isLoading.value = true;
      const res = await api.auth.login(credentials);

      if (res.success) {
        token.value = res.data.token;
        user.value = res.data.user;
        localStorage.setItem("token", token.value);
        localStorage.setItem("user", JSON.stringify(user.value));
        return { success: true };
      }
      return { success: false, message: res.message || "登录失败" };
    } catch (error) {
      console.error("登录错误:", error);
      return { success: false, message: error?.message || "登录失败" };
    } finally {
      isLoading.value = false;
    }
  };

  // 注册
  const register = async (userInfo) => {
    try {
      isLoading.value = true;
      const res = await api.auth.register(userInfo);
      if (res.success) {
        return { success: true, message: res.message || "注册成功，请登录" };
      }
      return { success: false, message: res.message || "注册失败" };
    } catch (error) {
      console.error("注册错误:", error);
      return { success: false, message: error?.message || "注册失败" };
    } finally {
      isLoading.value = false;
    }
  };

  // 登出
  const logout = () => {
    user.value = null;
    token.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    // 清空本地 token 列表，防止切换账号看到别人的数据
    localStorage.removeItem("gameTokens");
    localStorage.removeItem("selectedTokenId");
    localStorage.removeItem("tokenGroups");
  };

  // 获取用户信息
  const fetchUserInfo = async () => {
    try {
      if (!token.value) return false;
      const res = await api.auth.getUserInfo();
      if (res.success) {
        user.value = res.data;
        localStorage.setItem("user", JSON.stringify(user.value));
        return true;
      }
      logout();
      return false;
    } catch (error) {
      console.error("获取用户信息失败:", error);
      logout();
      return false;
    }
  };

  // 初始化认证状态
  const initAuth = async () => {
    if (!token.value) return;
    // 先从 localStorage 恢复，再异步验证
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        user.value = JSON.parse(savedUser);
      } catch (e) {
        // ignore
      }
    }
    // 后台验证 token 有效性
    await fetchUserInfo();
  };

  return {
    user,
    token,
    isLoading,
    isAuthenticated,
    userInfo,
    login,
    register,
    logout,
    fetchUserInfo,
    initAuth,
  };
});
