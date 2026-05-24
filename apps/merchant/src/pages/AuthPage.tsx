import { FormEvent, useState } from "react";
import { Gavel, LockKeyhole, Mail, PlayCircle, ShieldCheck, UserRound } from "lucide-react";
import { login, register, type AuthResponse } from "../api/client";

type AuthPageProps = {
  onAuthenticated: (response: AuthResponse) => void;
  initialMode?: "login" | "register";
};

export function AuthPage({ onAuthenticated, initialMode = "login" }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);

    try {
      const response = mode === "login" ? await login(email, password) : await register(nickname, email, password);
      onAuthenticated(response);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual">
        <div className="auth-brand">
          <span className="logo-mark">
            <PlayCircle size={30} fill="currentColor" />
          </span>
          <strong>直播助手</strong>
        </div>
        <div>
          <h1>商家直播竞拍工作台</h1>
          <p>统一管理直播场次、竞拍商品、成交订单和经营复盘，让每一场直播都有清晰的下一步。</p>
        </div>
        <div className="auth-highlights">
          <span>
            <ShieldCheck size={18} />
            登录后查看经营数据与订单状态
          </span>
          <span>
            <Gavel size={18} />
            支持直播场次、拍品队列和竞拍规则管理
          </span>
          <span>
            <LockKeyhole size={18} />
            账号数据仅对已授权商家可见
          </span>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-head">
          <span>
            <Gavel size={22} />
          </span>
          <div>
            <h2>{mode === "login" ? "登录商家后台" : "注册商家账号"}</h2>
            <p>{mode === "login" ? "继续处理直播竞拍业务" : "创建账号后直接进入后台"}</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">登录</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">注册</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label>
              <span>商家名称</span>
              <div>
                <UserRound size={18} />
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="请输入商家名称" />
              </div>
            </label>
          )}
          <label>
            <span>邮箱</span>
            <div>
              <Mail size={18} />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div>
              <LockKeyhole size={18} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位密码" />
            </div>
          </label>

          {message && <p className="auth-error">{message}</p>}

          <button className="btn primary auth-submit" disabled={submitting} type="submit">
            {submitting ? "处理中..." : mode === "login" ? "登录" : "注册并进入"}
          </button>
        </form>
      </section>
    </main>
  );
}
