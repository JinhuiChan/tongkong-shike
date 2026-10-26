/*
 * 深色模式基础测试：
 * 1. 首次进入跟随系统深色主题
 * 2. 手动切换后写入选择，并立即更新页面根节点 class
 * 3. 保存的选择优先于系统主题
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const failures = []
const storage = {}

global.wx = {
  getSystemInfoSync() { return { theme: 'dark', windowWidth: 375 } },
  getStorageSync(key) { return storage[key] === undefined ? '' : storage[key] },
  setStorageSync(key, value) { storage[key] = value },
  removeStorageSync(key) { delete storage[key] },
}

const theme = require(path.join(ROOT, 'utils/theme.js'))

if (theme.mode() !== 'dark') failures.push('首次进入应跟随系统深色主题')
if (theme.className() !== 'theme-dark') failures.push('根节点 class 应为 theme-dark')

const page = {
  data: {},
  setData(patch) { Object.assign(this.data, patch) },
}
theme.sync(page)
if (page.data.themeClass !== 'theme-dark' || page.data.nightMode !== true) {
  failures.push('同步页面时未应用深色状态')
}

theme.toggle(page)
if (storage.theme_mode !== 'light') failures.push('切换后未持久化浅色选择')
if (page.data.themeClass !== 'theme-light' || page.data.nightMode !== false) {
  failures.push('切换后页面未立即变回浅色')
}
if (theme.mode() !== 'light') failures.push('已保存的浅色选择应优先于系统深色主题')

theme.toggle(page)
if (storage.theme_mode !== 'dark') failures.push('再次切换后未持久化深色选择')
if (page.data.themeClass !== 'theme-dark') failures.push('再次切换后页面未恢复深色')

console.log('深色跟随系统 / 手动切换 / 选择持久化，均符合预期')

if (failures.length) {
  console.log('\n❌ 深色模式测试失败:')
  failures.forEach(f => console.log(' - ' + f))
  process.exit(1)
}
console.log('\n✅ 深色模式测试通过')
