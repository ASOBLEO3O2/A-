import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0', // LANアクセス可能
    port: 5173,       // ポート番号
    open: '/index.html' // 起動時に開くページ
  }
});
