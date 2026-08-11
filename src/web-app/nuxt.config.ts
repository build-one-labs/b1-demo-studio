// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  srcDir: 'src',
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  telemetry: false,
  extends: ['@buildone/web-framework-layer'],
  modules: ['@nuxt/eslint', '@nuxt/image'],
  app: {
    head: {
      title: 'BuildOne Application',
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.svg' }]
    }
  }
});
