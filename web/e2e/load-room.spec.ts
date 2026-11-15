import { test, expect } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { login } from './helpers'

test('a human teacher receives every continuously publishing virtual student',async({page})=>{
  test.skip(process.env.TEST_LOAD_ROOM!=='1','Requires running virtual student containers')
  test.setTimeout(120000)
  const run=JSON.parse(readFileSync(resolve('../infra/local/.loadtest/classroom.json'),'utf8'))
  await login(page,'teacher1')
  const lesson=await(await page.request.get(`/api/v1/lessons/${run.lessonId}`)).json()
  expect(lesson.endsAt).toBeNull();expect(lesson.status).toBe('LIVE')
  await page.goto(`/lessons/${run.lessonId}/prejoin`)
  await page.getByRole('button',{name:'마이크 끄기',exact:true}).click()
  await page.getByRole('button',{name:'카메라 끄기',exact:true}).click()
  await page.getByRole('button',{name:'지금 참여하기',exact:true}).click()
  await expect(page.locator('.call-connected')).toHaveText('연결됨')
  const virtualStudents=lesson.students.filter((person:{username:string})=>run.studentUsernames.includes(person.username))
  const received=new Set<string>()
  const next=page.getByRole('button',{name:'다음 참가자 페이지',exact:true})
  for(;;){
    for(const student of virtualStudents){
      const tile=page.locator(`.video-tile[data-participant="${student.id}"]`)
      if(!await tile.count())continue
      const video=tile.locator('video')
      await expect.poll(async()=>video.evaluate((element:HTMLVideoElement)=>element.readyState>=2&&element.videoWidth>0),{timeout:30000}).toBe(true)
      received.add(student.id)
    }
    const videos=page.locator('.video-tile video')
    const before=await videos.evaluateAll((items:HTMLVideoElement[])=>items.map(video=>video.getVideoPlaybackQuality().totalVideoFrames))
    await expect.poll(async()=>videos.evaluateAll((items:HTMLVideoElement[],baseline:number[])=>items.length===baseline.length&&items.every((video,index)=>video.getVideoPlaybackQuality().totalVideoFrames>baseline[index]),before)).toBe(true)
    if(!await next.count()||await next.isDisabled())break
    await next.click()
  }
  expect([...received].sort()).toEqual(virtualStudents.map((student:{id:string})=>student.id).sort())
  const previous=page.getByRole('button',{name:'이전 참가자 페이지',exact:true})
  while(await previous.count()&&await previous.isEnabled())await previous.click()
  const directory=resolve('../infra/local/artifacts/loadtest');mkdirSync(directory,{recursive:true})
  await page.screenshot({path:resolve(directory,'teacher-view.png'),fullPage:true})
  // Leave personally so the virtual class remains running for the user.
  const leave=await page.request.post(`/api/v1/lessons/${run.lessonId}/leave`);expect(leave.ok()).toBe(true)
  const retained=await(await page.request.get(`/api/v1/lessons/${run.lessonId}`)).json();expect(retained.status).toBe('LIVE')
})
