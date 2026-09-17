import axios from "axios";
import { useAuthStore } from "@/stores/auth";

// 创建axios实例
const request = axios.create({
  baseURL: "/api/v1",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    const data = response.data;

    // 统一处理响应格式
    if (data.success !== undefined) {
      return data;
    }

    // 兼容不同的响应格式
    return {
      success: true,
      data: data,
      message: "success",
    };
  },
  (error) => {
    const authStore = useAuthStore();

    // 处理HTTP错误
    if (error.response) {
      const { status, data } = error.response;

      switch (status) {
        case 401:
          // 未授权，清除登录状态
          authStore.logout();
          window.location.href = "/login";
          return Promise.reject({
            success: false,
            message: data?.message || "登录已过期，请重新登录",
          });
        case 403:
          return Promise.reject({
            success: false,
            message: data?.message || "没有权限访问",
          });
        case 404:
          return Promise.reject({
            success: false,
            message: data?.message || "请求的资源不存在",
          });
        case 500:
          return Promise.reject({
            success: false,
            message: data?.message || "服务器内部错误",
          });
        default:
          return Promise.reject({
            success: false,
            message: data?.message || "请求失败",
          });
      }
    } else if (error.request) {
      // 网络错误
      return Promise.reject({
        success: false,
        message: "网络连接失败，请检查网络",
      });
    } else {
      // 其他错误
      return Promise.reject({
        success: false,
        message: error.message || "未知错误",
      });
    }
  },
);

// API接口定义
const api = {
  // 认证相关
  auth: {
    login: (credentials) => request.post("/auth/login", credentials),
    register: (userInfo) => request.post("/auth/register", userInfo),
    logout: () => request.post("/auth/logout"),
    getUserInfo: () => request.get("/auth/user"),
    refreshToken: () => request.post("/auth/refresh"),
  },

  // Token 管理
  tokens: {
    getList: () => request.get("/tokens"),
    add: (tokenData) => request.post("/tokens", tokenData),
    update: (id, tokenData) => request.put(`/tokens/${id}`, tokenData),
    delete: (id) => request.delete(`/tokens/${id}`),
    import: (tokens) => request.post("/tokens/import", { tokens }),
    export: () => request.get("/tokens/export"),
    updateDailySettings: (id, settings) =>
      request.put(`/tokens/${id}/daily-settings`, settings),
  },

  // WebSocket 连接管理（后端）
  connections: {
    connect: (tokenId, body) => request.post(`/connections/${tokenId}/connect`, body || {}),
    disconnect: (tokenId) => request.post(`/connections/${tokenId}/disconnect`),
    getStatus: (tokenId) => request.get(`/connections/${tokenId}/status`),
    list: () => request.get("/connections"),
    sendCommand: (tokenId, cmd, params, timeout) =>
      request.post(`/connections/${tokenId}/command`, { cmd, params, timeout }),
    batchCommand: (tokenId, commands) =>
      request.post(`/connections/${tokenId}/batch-command`, { commands }),
    getGameData: (tokenId) => request.get(`/connections/${tokenId}/gamedata`),
    getRoleInfo: (tokenId, refresh = false) =>
      request.get(`/connections/${tokenId}/roleinfo${refresh ? '?refresh=true' : ''}`),
  },

  // 任务管理（后端）
  tasks: {
    startDaily: (tokenId, settings) =>
      request.post(`/tasks/daily/${tokenId}`, { settings }),
    cancel: (tokenId) => request.post(`/tasks/${tokenId}/cancel`),
    getStatus: (tokenId) => request.get(`/tasks/${tokenId}/status`),
    getHistory: (page, limit) =>
      request.get(`/tasks/history?page=${page || 1}&limit=${limit || 20}`),
    getLogs: (taskId) => request.get(`/tasks/${taskId}/logs`),
  },

  // 定时任务（后端）
  scheduledTasks: {
    list: () => request.get('/tasks/scheduled'),
    create: (data) => request.post('/tasks/scheduled', data),
    update: (id, data) => request.put(`/tasks/scheduled/${id}`, data),
    remove: (id) => request.delete(`/tasks/scheduled/${id}`),
    toggle: (id) => request.post(`/tasks/scheduled/${id}/toggle`),
    execute: (id) => request.post(`/tasks/scheduled/${id}/execute`),
  },

  // 主线推关（后端）
  levelPush: {
    start: (tokenId, body) =>
      request.post(`/level-push/${tokenId}/start`, body || {}),
    stop: (tokenId) => request.post(`/level-push/${tokenId}/stop`),
    getStatus: (tokenId) => request.get(`/level-push/${tokenId}/status`),
    getAllStatus: () => request.get("/level-push/status"),
    useTorch: (tokenId, itemId, quantity, body) =>
      request.post(`/level-push/${tokenId}/torch`, { itemId, quantity, ...body }),
  },

  // 游戏角色相关
  gameRoles: {
    getList: () => request.get("/gamerole_list"),
    add: (roleData) => request.post("/gameroles", roleData),
    update: (roleId, roleData) => request.put(`/gameroles/${roleId}`, roleData),
    delete: (roleId) => request.delete(`/gameroles/${roleId}`),
    getDetail: (roleId) => request.get(`/gameroles/${roleId}`),
  },

  // 日常任务相关
  dailyTasks: {
    getList: (roleId) => request.get(`/daily-tasks?roleId=${roleId}`),
    getStatus: (roleId) => request.get(`/daily-tasks/status?roleId=${roleId}`),
    complete: (taskId, roleId) =>
      request.post(`/daily-tasks/${taskId}/complete`, { roleId }),
    getHistory: (roleId, page = 1, limit = 20) =>
      request.get(
        `/daily-tasks/history?roleId=${roleId}&page=${page}&limit=${limit}`,
      ),
  },

  // 用户相关
  user: {
    getProfile: () => request.get("/user/profile"),
    updateProfile: (profileData) => request.put("/user/profile", profileData),
    changePassword: (passwordData) =>
      request.put("/user/password", passwordData),
    getStats: () => request.get("/user/stats"),
  },
};

export default api;
