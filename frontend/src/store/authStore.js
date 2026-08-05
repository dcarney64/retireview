import axios from 'axios';
import { create } from 'zustand';

const authApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,

  setToken: (token) => {
    set({ accessToken: token, isAuthenticated: Boolean(token) });
  },

  login: async (email, password) => {
    const response = await authApi.post('/auth/login', { email, password });
    if (response.data.requires2FA) {
      return response.data;
    }
    set({
      user: response.data.user,
      accessToken: response.data.accessToken,
      isAuthenticated: true,
    });
    return response.data;
  },

  verify2FA: async (tempToken, code, trustDevice) => {
    const response = await authApi.post('/auth/2fa/verify', { tempToken, code, trustDevice });
    set({
      user: response.data.user,
      accessToken: response.data.accessToken,
      isAuthenticated: true,
    });
    return response.data;
  },

  resend2FA: async (tempToken) => {
    const response = await authApi.post('/auth/2fa/send', { tempToken });
    return response.data;
  },

  register: async (fullName, email, password) => {
    const response = await authApi.post('/auth/register', { fullName, email, password });
    set({
      user: response.data.user,
      accessToken: response.data.accessToken,
      isAuthenticated: true,
    });
    return response.data;
  },

  refreshToken: async () => {
    const response = await authApi.post('/auth/refresh');
    set({ accessToken: response.data.accessToken, isAuthenticated: true });
    return response.data.accessToken;
  },

  logout: async () => {
    try {
      await authApi.post('/auth/logout');
    } catch (_error) {
      // noop
    }
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  bootstrapMe: async () => {
    if (!get().accessToken) {
      return;
    }
    const response = await authApi.get('/auth/me', {
      headers: { Authorization: `Bearer ${get().accessToken}` },
    });
    set({ user: response.data, isAuthenticated: true });
  },
}));
