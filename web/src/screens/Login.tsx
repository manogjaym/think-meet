import { designContent } from "../generated/design-content"
import { useState } from "react"
import { useAuth } from "../lib/auth"
import { BrandSymbol } from "../components/BrandSymbol"
import { Icon } from "../components/ui"
export function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <main className="center-page login-page">
      <section className="login-card">
        <div className="login-brand">
          <BrandSymbol />
          <strong>{designContent.loginBrand}</strong>
        </div>
        <h1>{designContent.loginTitle}</h1>
        <p>{designContent.loginDescription}</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (pending) return
            setPending(true)
            setError("")
            try {
              await login(username.trim(), password)
            } catch (e) {
              setError(e instanceof Error ? e.message : "로그인하지 못했어요.")
            } finally {
              setPending(false)
            }
          }}
        >
          <label className="field">
            <span>아이디</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>비밀번호</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="service-error" role="alert">
              <Icon name="alert" size={17} />
              {error}
            </p>
          )}
          <button
            className="primary full"
            type="submit"
            disabled={pending || !username.trim() || !password}
          >
            {pending ? "로그인 중…" : "로그인"}
          </button>
        </form>
        <p className="login-note">{designContent.loginHelp}</p>
      </section>
    </main>
  )
}
