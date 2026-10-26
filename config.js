/**
 * 云服务公开配置。
 * endpoint / publishableKey 仅标识应用，不携带权限，可安全打包进小程序代码。
 */
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_gltmC4Roy6VwuRmN7Xz6NW_IIYwYVzOupJIBtWDWvJpSpO1GnD1JVy6',
}

/**
 * 构建标记：首页底部会显示它。
 * 扫码后先看这一行——和最近一次改动对不上，说明微信里跑的还是旧包。
 * 每次改代码顺手更新这里。
 */
const BUILD_STAMP = 'v1.14 · 2026-10-26 13:38'

module.exports = { publicConfig, BUILD_STAMP }
