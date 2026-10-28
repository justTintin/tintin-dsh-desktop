// Vitest 用 remotion 桩:registry.ts 只 import 组件类型(编译期擦除),不触运行时;
// 若测试间接触包 remotion 运行时(不应发生),显式失败以防误测。
export const Composition = () => {
  throw new Error('remotion 运行时不应在单测中执行')
}
export const registerRoot = () => {
  throw new Error('remotion 运行时不应在单测中执行')
}
export const AbsoluteFill = () => {
  throw new Error('remotion 运行时不应在单测中执行')
}
export const Img = () => {
  throw new Error('remotion 运行时不应在单测中执行')
}
export const staticFile = () => {
  throw new Error('remotion 运行时不应在单测中执行')
}
