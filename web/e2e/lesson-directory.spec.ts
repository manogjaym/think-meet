import { expect, test, type Page, type Route } from "@playwright/test"
import type { ApiLesson, User } from "../src/lib/api"

const previousTeacher: User = {
  id: "previous-teacher",
  username: "teacher-a",
  name: "이전",
  role: "teacher",
}
const nextTeacher: User = {
  id: "next-teacher",
  username: "teacher-b",
  name: "현재",
  role: "teacher",
}
const previousStudent: User = {
  id: "previous-student",
  username: "student-a",
  name: "이전 반 학생",
  role: "student",
}
const nextStudent: User = {
  id: "next-student",
  username: "student-b",
  name: "현재 반 학생",
  role: "student",
}

function lessonFor(teacher: User, student: User): ApiLesson {
  const startsAt = Date.now() + 86_400_000
  return {
    id: `lesson-${teacher.id}`,
    title: `${teacher.name} 계정 수업`,
    description: "",
    teacher,
    students: [student],
    accessMode: "INVITE_ONLY",
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 3_600_000).toISOString(),
    status: "SCHEDULED",
    code: teacher.id,
    startedAt: null,
    endedAt: null,
    participants: [],
    attendance: [],
  }
}

async function mockDirectory(page: Page) {
  let user: User | null = previousTeacher
  let authChecks = 0
  let holdCurrentDirectory = false
  const previousLessons: Route[] = []
  const previousStudents: Route[] = []
  const unauthorized = {
    status: 401,
    json: { code: "UNAUTHENTICATED", message: "이전 세션이 만료되었어요." },
  }

  // Deliver the pending responses even if the application has cancelled them.
  await page.addInitScript(() => {
    const fetchFromBrowser = window.fetch.bind(window)
    window.fetch = async (input, options) => {
      if (input !== "/api/v1/lessons" && input !== "/api/v1/students") {
        return fetchFromBrowser(input, options)
      }
      const response = await fetchFromBrowser(input, {
        ...options,
        signal: undefined,
      })
      if (response.headers.has("x-test-previous-directory")) {
        const observeBody = <T>(readBody: () => Promise<T>) => async () => {
          const body = await readBody()
          // Signal after the caller has consumed the body and React can commit.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const { dataset } = document.documentElement
              dataset.previousDirectoryResponses = String(
                Number(dataset.previousDirectoryResponses ?? 0) + 1,
              )
            }),
          )
          return body
        }
        response.text = observeBody(response.text.bind(response))
        response.json = observeBody(response.json.bind(response))
      }
      return response
    }
  })
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.route("**/api/v1/**", async (route) => {
    switch (new URL(route.request().url()).pathname) {
      case "/api/v1/capabilities":
        return route.fulfill({ status: 404 })
      case "/api/v1/auth/me":
        authChecks++
        return route.fulfill(user ? { json: user } : unauthorized)
      case "/api/v1/auth/logout":
        user = null
        return route.fulfill({ status: 204 })
      case "/api/v1/auth/login":
        expect(route.request().postDataJSON().username).toBe(
          nextTeacher.username,
        )
        user = nextTeacher
        return route.fulfill({ json: user })
      case "/api/v1/lessons":
        if (user === previousTeacher) {
          previousLessons.push(route)
          return
        }
        if (holdCurrentDirectory) return
        return route.fulfill(
          user ? { json: [lessonFor(user, nextStudent)] } : unauthorized,
        )
      case "/api/v1/students":
        if (user === previousTeacher) {
          previousStudents.push(route)
          return
        }
        if (holdCurrentDirectory) return
        return route.fulfill(user ? { json: [nextStudent] } : unauthorized)
      default:
        return route.fulfill({ status: 404 })
    }
  })

  await page.goto("/")
  await expect
    .poll(() => previousLessons.length > 0 && previousStudents.length > 0)
    .toBe(true)
  return {
    get authChecks() {
      return authChecks
    },
    async releasePrevious(expired: boolean) {
      holdCurrentDirectory = true
      const lessons = expired
        ? unauthorized
        : { json: [lessonFor(previousTeacher, previousStudent)] }
      const roster = { json: [previousStudent] }
      const responses = [
        ...previousLessons.map((route) => ({ route, response: lessons })),
        ...previousStudents.map((route) => ({ route, response: roster })),
      ]
      await Promise.all(
        responses.map(({ route, response }) =>
          route.fulfill({
            ...response,
            headers: { "x-test-previous-directory": "true" },
          }),
        ),
      )
      await expect(page.locator("html")).toHaveAttribute(
        "data-previous-directory-responses",
        String(responses.length),
      )
    },
  }
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "이전 선생님" }).click()
  await page.getByRole("button", { name: "로그아웃", exact: true }).click()
  await expect(page).toHaveURL(/\/login\?next=/)
}

test("a late lesson error cannot retry authentication after logout", async ({
  page,
}) => {
  const directory = await mockDirectory(page)
  await logout(page)
  const authChecks = directory.authChecks

  await directory.releasePrevious(true)

  expect(directory.authChecks).toBe(authChecks)
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible()
})

test("late lessons and student roster cannot replace another account's directory", async ({
  page,
}) => {
  const directory = await mockDirectory(page)
  await logout(page)
  await page.getByLabel("아이디", { exact: true }).fill(nextTeacher.username)
  await page.getByLabel("비밀번호", { exact: true }).fill("fixture-password")
  await page.getByRole("button", { name: "로그인", exact: true }).click()
  await expect(page.getByText("현재 계정 수업", { exact: true })).toBeVisible()

  await directory.releasePrevious(false)

  await expect(page.getByText("현재 계정 수업", { exact: true })).toBeVisible()
  await expect(page.getByText("이전 계정 수업", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "새 수업 예약", exact: true }).click()
  await expect(
    page
      .locator(".student-options button")
      .filter({ hasText: nextStudent.name }),
  ).toBeVisible()
  await expect(
    page
      .locator(".student-options button")
      .filter({ hasText: previousStudent.name }),
  ).toHaveCount(0)
})

test("a 401 while the session is still valid re-checks it without remounting the app", async ({
  page,
}) => {
  let authChecks = 0
  let failLessons = false
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.route("**/api/v1/**", (route) => {
    switch (new URL(route.request().url()).pathname) {
      case "/api/v1/capabilities":
        return route.fulfill({ status: 404 })
      case "/api/v1/auth/me":
        authChecks++
        return route.fulfill({ json: previousTeacher })
      case "/api/v1/lessons":
        if (failLessons) {
          failLessons = false
          return route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED", message: "일시적인 인증 오류" } })
        }
        return route.fulfill({ json: [lessonFor(previousTeacher, previousStudent)] })
      case "/api/v1/students":
        return route.fulfill({ json: [previousStudent] })
      default:
        return route.fulfill({ status: 404 })
    }
  })
  await page.goto("/")
  // The account menu lives outside screen content; it only disappears if the whole app unmounts (as a live meeting would).
  const account = page.getByRole("button", { name: "이전 선생님" })
  await expect(account).toBeVisible()
  await account.evaluate((element) => { (element as HTMLElement & { kept?: boolean }).kept = true })
  const checks = authChecks

  failLessons = true
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))

  await expect.poll(() => authChecks).toBe(checks + 1)
  await expect(page).not.toHaveURL(/\/login/)
  expect(await account.evaluate((element) => (element as HTMLElement & { kept?: boolean }).kept)).toBe(true)
})
