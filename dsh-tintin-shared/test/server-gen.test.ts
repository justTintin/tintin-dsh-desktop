import { describe, expect, it } from 'vitest'
import { absoluteUrl, taskIdOf, taskStatusOf } from '../lib/server-gen.js'

describe('server-gen(服务端生成契约纯函数,自 openfilm-tools 随迁)', () => {
  it('absoluteUrl:相对路径拼 base,绝对 URL 原样,空值返回空', () => {
    expect(absoluteUrl('http://s:8000', '/tasks/unified/1')).toBe('http://s:8000/tasks/unified/1')
    expect(absoluteUrl('http://s:8000/', 'tasks/unified/1')).toBe('http://s:8000/tasks/unified/1')
    expect(absoluteUrl('http://s:8000', 'http://cdn/x.png')).toBe('http://cdn/x.png')
    expect(absoluteUrl('http://s:8000', '')).toBe('')
  })

  it('taskIdOf:四种键名与 data 包层都认', () => {
    expect(taskIdOf({ task_id: 't1' })).toBe('t1')
    expect(taskIdOf({ taskId: 't2' })).toBe('t2')
    expect(taskIdOf({ job_id: 42 })).toBe('42')
    expect(taskIdOf({ data: { id: 't3' } })).toBe('t3')
    expect(taskIdOf('not-object')).toBe('')
  })

  it('taskStatusOf:status/state 小写化,data 包层递归', () => {
    expect(taskStatusOf({ status: 'Completed' })).toBe('completed')
    expect(taskStatusOf({ state: 'RUNNING' })).toBe('running')
    expect(taskStatusOf({ data: { status: 'failed' } })).toBe('failed')
    expect(taskStatusOf(null)).toBe('')
  })
})
