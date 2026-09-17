<template>
  <div class="auth-page">
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <img src="/icons/xiaoyugan.png" alt="XYZW" class="auth-logo" />
          <h1>XYZW 助手</h1>
          <p class="auth-subtitle">游戏辅助管理工具</p>
        </div>

        <n-form
          ref="formRef"
          :model="form"
          :rules="rules"
          size="large"
          :show-label="false"
        >
          <n-form-item path="username">
            <n-input
              v-model:value="form.username"
              placeholder="用户名"
              :input-props="{ autocomplete: 'username' }"
            >
              <template #prefix
                ><n-icon><PersonCircle /></n-icon
              ></template>
            </n-input>
          </n-form-item>
          <n-form-item path="password">
            <n-input
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="密码"
              :input-props="{ autocomplete: 'current-password' }"
              @keydown.enter="handleLogin"
            >
              <template #prefix
                ><n-icon><LockClosed /></n-icon
              ></template>
            </n-input>
          </n-form-item>
          <n-button
            type="primary"
            size="large"
            block
            :loading="loading"
            class="auth-btn"
            @click="handleLogin"
          >
            登录
          </n-button>
        </n-form>

        <div class="auth-footer">
          <span>没有账号？</span>
          <n-button text type="primary" @click="router.push('/register')"
            >立即注册</n-button
          >
        </div>

        <div class="disclaimer">
          本工具完全免费，不收取任何费用，仅供学习交流使用，不用于商业用途。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useMessage } from "naive-ui";
import { useAuthStore } from "@/stores/auth";
import { PersonCircle, LockClosed } from "@vicons/ionicons5";

const router = useRouter();
const message = useMessage();
const authStore = useAuthStore();
const formRef = ref(null);
const loading = ref(false);

const form = reactive({ username: "", password: "" });

const rules = {
  username: [
    { required: true, message: "请输入用户名", trigger: ["input", "blur"] },
  ],
  password: [
    { required: true, message: "请输入密码", trigger: ["input", "blur"] },
    { min: 6, message: "密码至少6位", trigger: ["input", "blur"] },
  ],
};

const handleLogin = async () => {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
    loading.value = true;
    const result = await authStore.login({
      username: form.username,
      password: form.password,
    });
    if (result.success) {
      message.success("登录成功");
      router.push("/admin/pushing-levels");
    } else {
      message.error(result.message);
    }
  } catch (e) {
    // validation failed
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (authStore.isAuthenticated) router.push("/admin/pushing-levels");
});
</script>

<style scoped>
.auth-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
[data-theme="dark"] .auth-page {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
}
.auth-container {
  width: 100%;
  max-width: 400px;
}
.auth-card {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 36px 28px 28px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}
[data-theme="dark"] .auth-card {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.auth-header {
  text-align: center;
  margin-bottom: 28px;
}
.auth-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  margin-bottom: 12px;
}
.auth-header h1 {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--text-primary, #1f2937);
}
.auth-subtitle {
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
  margin: 0;
}
.auth-btn {
  height: 46px;
  font-size: 15px;
  font-weight: 600;
  margin-top: 4px;
}
.auth-footer {
  text-align: center;
  margin-top: 20px;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
}
.auth-footer span {
  margin-right: 4px;
}
.disclaimer {
  margin-top: 20px;
  padding: 10px 12px;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #92400e;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
[data-theme="dark"] .disclaimer {
  background: rgba(254, 243, 199, 0.1);
  border-color: rgba(253, 230, 138, 0.2);
  color: #fbbf24;
}
@media (max-width: 480px) {
  .auth-card {
    padding: 28px 20px 20px;
  }
  .auth-header h1 {
    font-size: 20px;
  }
}
</style>
