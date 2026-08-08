import axios from 'axios';

import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Attach the active profile header so every API call is automatically scoped.
  // Routes that don't care about profiles simply ignore it.
  const profileId = useProfileStore.getState().activeProfileId;
  config.headers['X-Profile-Id'] = profileId ? String(profileId) : 'primary';

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {};

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (window.location.pathname === '/login') {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const token = await useAuthStore.getState().refreshToken();
        originalRequest.headers = {
          ...(originalRequest.headers || {}),
          Authorization: `Bearer ${token}`,
        };
        return apiClient(originalRequest);
      } catch (_refreshError) {
        await useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
