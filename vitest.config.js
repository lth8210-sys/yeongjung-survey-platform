import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // test/rules는 Firestore 에뮬레이터가 떠 있어야 동작한다(npm run test:rules로
    // 별도 실행). 일반 npm test에서 함께 돌면 에뮬레이터 없이 실패하므로 제외한다.
    exclude: ['**/node_modules/**', 'test/rules/**'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
