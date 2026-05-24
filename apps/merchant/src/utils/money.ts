export function money(value: number) {
  return `￥ ${value.toLocaleString("zh-CN")}`;
}
