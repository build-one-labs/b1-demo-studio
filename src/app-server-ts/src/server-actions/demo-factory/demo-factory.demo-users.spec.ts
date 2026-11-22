import { DEMO_USER_ID_PATTERN, demoUserJobEnv, demoUserSecretName } from './demo-factory.demo-users';
import { stageBlockedReason } from './demo-factory.lib';

describe('demo users', () => {
  it('stores each user under its own organization secret', () => {
    expect(demoUserSecretName('samples-demo')).toBe('demo-factory-user-samples-demo');
    expect(DEMO_USER_ID_PATTERN.test('samples-demo')).toBe(true);
    expect(DEMO_USER_ID_PATTERN.test('../x')).toBe(false);
  });

  it("gives a job the user's key under the scoped name too, and the user's own auth state", () => {
    expect(
      demoUserJobEnv('samples-demo', 'key-123', {
        authUrl: 'https://auth.test.build.one/build-one',
        authStateFile: '/factory/playwright/.auth/demo-user-samples-demo.json'
      })
    ).toEqual({
      B1_USER_API_KEY: 'key-123',
      B1_USER_API_KEY__AUTH_TEST_BUILD_ONE: 'key-123',
      B1_AUTH_STATE: '/factory/playwright/.auth/demo-user-samples-demo.json',
      DEMO_USER: 'samples-demo'
    });
  });

  it('lets a demo with its own demo user run where the host has no key', () => {
    const host = { hasFactory: true, hasDependencies: true, canRecord: true, canRender: true, canAuthenticate: false };
    expect(stageBlockedReason('all', host)).toMatch(/API key/);
    expect(stageBlockedReason('all', host, { hasDemoUser: true })).toBeNull();
    expect(stageBlockedReason('convert', host, { hasDemoUser: true })).toBeNull();
  });
});
