import { describe, expect, it } from 'vitest'
import { stringifyOption, parseOption } from '../src/sandbox/serialize'
import { runOptionCode } from '../src/sandbox/runner'

describe('函数安全序列化', () => {
  it('函数 → __chartkit_fn__ 往返', () => {
    const json = stringifyOption({ tooltip: { formatter: (v: unknown) => String(v) } })
    expect(json).toContain('__chartkit_fn__')
    const back = parseOption(json) as { tooltip: { formatter: (v: unknown) => string } }
    expect(typeof back.tooltip.formatter).toBe('function')
    expect(back.tooltip.formatter('x')).toBe('x')
  })
})

describe('Worker 沙箱', () => {
  it('裸赋值 option = {...}(官方 playground 写法)可捕获', async () => {
    const r = await runOptionCode(`const names = ['a','b'];
option = { title: { text: names.join('-') }, series: [{ type: 'bar', data: [1, 2] }] };`)
    expect(r.ok).toBe(true)
    expect((r.option as { series: unknown[] }).series).toHaveLength(1)
  })

  it('const option = {...} 也可捕获', async () => {
    const r = await runOptionCode(`const option = { series: [{ type: 'line' }] };`)
    expect(r.ok).toBe(true)
    expect(r.option).toBeTruthy()
  })

  it('带辅助函数 + 随机数的 Bump Chart 风格代码可执行', async () => {
    const r = await runOptionCode(`
const shuffle = (array) => { let i = array.length; while (i > 0) { const j = Math.floor(Math.random() * i); i--; [array[i], array[j]] = [array[j], array[i]]; } return array; };
const data = shuffle([1,2,3,4]);
option = { series: [{ type: 'line', data }] };
`)
    expect(r.ok).toBe(true)
    const opt = r.option as { series: { data: number[] }[] }
    expect(opt.series[0].data.slice().sort()).toEqual([1, 2, 3, 4])
  })

  it('死循环被超时熔断(Q6)', async () => {
    const r = await runOptionCode(`while (true) {}`, { timeoutMs: 500 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timeout/)
  })

  it('禁用 fetch:访问即报错(Q6 禁网络)', async () => {
    const r = await runOptionCode(`let err = 'no';
try { fetch('http://example.com'); } catch (e) { err = 'blocked'; }
option = { title: { text: err } };`)
    expect(r.ok).toBe(true)
    expect((r.option as { title: { text: string } }).title.text).toBe('blocked')
  })

  it('禁用 setTimeout(Q6 一期禁定时器)', async () => {
    const r = await runOptionCode(`let err = 'no';
try { setTimeout(() => {}, 10); } catch (e) { err = 'blocked'; }
option = { title: { text: err } };`)
    expect(r.ok).toBe(true)
    expect((r.option as { title: { text: string } }).title.text).toBe('blocked')
  })

  it('option 内的函数经序列化往返保留', async () => {
    const r = await runOptionCode(
      `option = { yAxis: { axisLabel: { formatter: (v) => '#' + v } } };`,
    )
    expect(r.ok).toBe(true)
    const opt = r.option as { yAxis: { axisLabel: { formatter: (v: number) => string } } }
    expect(opt.yAxis.axisLabel.formatter(3)).toBe('#3')
  })

  it('语法错误返回错误信息而非挂死', async () => {
    const r = await runOptionCode(`option = {`)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
