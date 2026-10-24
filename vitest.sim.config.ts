import { defineConfig } from 'vitest/config';

// 밸런스 시뮬레이션 전용 설정: npm run sim
export default defineConfig({
  test: { include: ['tools/**/*.sim.ts'], environment: 'node', testTimeout: 600000 },
});
