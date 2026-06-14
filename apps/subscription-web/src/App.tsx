import { useEffect, useState, type FormEvent } from "react";
import { confirmSubscription, subscribe, unsubscribe } from "./api";
import {
  getStableOperationDays,
  stableOperationStartLabel,
} from "./uptime";

type SubmissionState =
  | { mode: "idle"; message: "" }
  | { mode: "confirmation"; message: string }
  | { mode: "unsubscribe"; message: string }
  | { mode: "loading"; message: string }
  | { mode: "success"; message: string }
  | { mode: "error"; message: string };

const INITIAL_STATE: SubmissionState = { mode: "idle", message: "" };

function initialSubmissionState(): SubmissionState {
  if (
    new URLSearchParams(window.location.search).has("confirmation_token")
  ) {
    return {
      mode: "confirmation",
      message: "请点击下方按钮完成邮箱确认。此链接只能成功使用一次。",
    };
  }
  if (new URLSearchParams(window.location.search).has("unsubscribe_token")) {
    return {
      mode: "unsubscribe",
      message: "确认后将停止接收每日科技早报。你之后仍可重新填写订阅表单恢复订阅。",
    };
  }

  const confirmation = new URLSearchParams(window.location.search).get(
    "confirmation",
  );
  const messages: Record<string, SubmissionState> = {
    confirmed: {
      mode: "success",
      message: "邮箱确认完成，下一期科技早报将发送到你的邮箱。",
    },
    used: {
      mode: "success",
      message: "这个确认链接已经使用过，你的订阅已生效。",
    },
    expired: {
      mode: "error",
      message: "确认链接已过期，请重新提交邮箱获取新链接。",
    },
    invalid: {
      mode: "error",
      message: "确认链接无效，请重新提交邮箱获取新链接。",
    },
    error: {
      mode: "error",
      message: "暂时无法确认订阅，请稍后再次打开邮件中的链接。",
    },
  };
  return confirmation ? messages[confirmation] || INITIAL_STATE : INITIAL_STATE;
}

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <rect x="3" y="5" width="18" height="14" rx="1" strokeWidth="1.6" />
      <path d="m4 7 8 6 8-6" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <path d="M5 12h13M14 7l5 5-5 5" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current">
      <path d="m5 12 4 4L19 6" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export default function App() {
  const stableOperationDays = getStableOperationDays();
  const [state, setState] = useState<SubmissionState>(initialSubmissionState);
  const [isConfirmationFlow] = useState(() =>
    new URLSearchParams(window.location.search).has("confirmation_token"),
  );
  const [isUnsubscribeFlow] = useState(() =>
    new URLSearchParams(window.location.search).has("unsubscribe_token"),
  );
  const [confirmationToken, setConfirmationToken] = useState(() =>
    new URLSearchParams(window.location.search).get("confirmation_token"),
  );
  const [unsubscribeToken, setUnsubscribeToken] = useState(() =>
    new URLSearchParams(window.location.search).get("unsubscribe_token"),
  );

  useEffect(() => {
    if (confirmationToken || unsubscribeToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [confirmationToken, unsubscribeToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.mode === "loading") return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    setState({ mode: "loading", message: "正在登记你的订阅信息…" });

    try {
      const result = await subscribe({
        name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""),
        company: String(formData.get("company") || ""),
      });
      setState({ mode: "success", message: result.message });
      form.reset();
    } catch (error) {
      setState({
        mode: "error",
        message: error instanceof Error ? error.message : "订阅失败，请稍后重试。",
      });
    }
  }

  async function handleConfirmation() {
    if (!confirmationToken || state.mode === "loading") return;
    setState({ mode: "loading", message: "正在确认你的邮箱…" });

    try {
      const result = await confirmSubscription(confirmationToken);
      setState({ mode: "success", message: result.message });
      setConfirmationToken(null);
    } catch (error) {
      setState({
        mode: "error",
        message:
          error instanceof Error
            ? error.message
            : "暂时无法确认订阅，请稍后重试。",
      });
    }
  }

  async function handleUnsubscribe() {
    if (!unsubscribeToken || state.mode === "loading") return;
    setState({ mode: "loading", message: "正在处理退订…" });

    try {
      const result = await unsubscribe(unsubscribeToken);
      setState({ mode: "success", message: result.message });
      setUnsubscribeToken(null);
    } catch (error) {
      setState({
        mode: "error",
        message:
          error instanceof Error
            ? error.message
            : "暂时无法退订，请稍后重试。",
      });
    }
  }

  const isLoading = state.mode === "loading";

  if (isConfirmationFlow || isUnsubscribeFlow) {
    return (
      <main className="page-grid min-h-screen text-[#172126] dark:text-[#e7e4d9]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-5 sm:px-8 sm:py-8">
          <header className="flex items-center border-b border-[#cfd7d5] pb-5 dark:border-[#354244]">
            <a href="/" className="flex items-center gap-3 no-underline">
              <span className="grid size-10 place-items-center border border-[#bd4f32] bg-[#bd4f32] text-[#fffaf1] dark:border-[#dd7659] dark:bg-[#dd7659] dark:text-[#101719]">
                <MailIcon />
              </span>
              <span>
                <strong className="block text-base tracking-tight">每日科技早报</strong>
                <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-[#637078] dark:text-[#aab1ae]">
                  EVERYDAY TECH NEWS
                </span>
              </span>
            </a>
          </header>

          <section className="flex flex-1 items-center justify-center py-10 sm:py-14">
            <div className="relative w-full max-w-xl">
              <div
                aria-hidden="true"
                className="absolute -inset-2 translate-x-1 translate-y-1 border border-[#bd4f32]/35 sm:-inset-3 sm:translate-x-3 sm:translate-y-3 dark:border-[#dd7659]/30"
              />
              <div className="relative border border-[#cbd4d2] bg-[rgba(255,254,249,0.94)] p-5 shadow-[0_28px_90px_rgba(35,48,48,0.12)] sm:p-10 dark:border-[#3a4647] dark:bg-[rgba(24,33,36,0.96)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.32)]">
                <p className="font-mono text-[11px] font-bold tracking-[0.16em] text-[#bd4f32] dark:text-[#dd7659]">
                  {isUnsubscribeFlow ? "UNSUBSCRIBE" : "EMAIL CONFIRMATION"}
                </p>
                <h1 className="mt-3 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
                  {isUnsubscribeFlow ? "退订每日科技早报" : "确认邮件订阅"}
                </h1>

                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-6 border px-4 py-4 text-sm leading-7 sm:mt-7 sm:px-5 ${
                    state.mode === "error"
                      ? "border-[#bd4f32]/45 bg-[#bd4f32]/5 text-[#8c3521] dark:border-[#dd7659]/45 dark:text-[#f0a18b]"
                      : state.mode === "success"
                        ? "border-[#2f6f62]/40 bg-[#2f6f62]/5 text-[#24564c] dark:border-[#79b3a5]/40 dark:text-[#93c8bb]"
                        : "border-[#cbd4d2] text-[#637078] dark:border-[#3a4647] dark:text-[#aab1ae]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {state.mode === "success" && <CheckIcon />}
                    <span className="flex-1">{state.message}</span>
                  </div>

                  {isConfirmationFlow &&
                    state.mode !== "success" &&
                    confirmationToken && (
                    <button
                      type="button"
                      onClick={handleConfirmation}
                      disabled={isLoading}
                      className="mt-5 flex w-full cursor-pointer items-center justify-center border-0 bg-[#bd4f32] px-5 py-3.5 font-bold text-[#fffaf1] transition hover:bg-[#8c3521] disabled:cursor-wait disabled:opacity-65 dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                    >
                      {isLoading ? "正在确认…" : "确认订阅"}
                    </button>
                  )}
                  {isUnsubscribeFlow &&
                    state.mode !== "success" &&
                    unsubscribeToken && (
                      <button
                        type="button"
                        onClick={handleUnsubscribe}
                        disabled={isLoading}
                        className="mx-auto mt-5 grid w-full max-w-xs cursor-pointer place-items-center border-0 bg-[#bd4f32] px-5 py-3.5 text-center font-bold leading-none text-[#fffaf1] transition hover:bg-[#8c3521] disabled:cursor-wait disabled:opacity-65 dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                      >
                        <span className="block w-full text-center">
                          {isLoading ? "正在退订…" : "确认退订"}
                        </span>
                      </button>
                    )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page-grid min-h-screen text-[#172126] dark:text-[#e7e4d9]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-[#cfd7d5] pb-5 dark:border-[#354244]">
          <a href="/" className="flex items-center gap-3 no-underline">
            <span className="grid size-10 place-items-center border border-[#bd4f32] bg-[#bd4f32] text-[#fffaf1] dark:border-[#dd7659] dark:bg-[#dd7659] dark:text-[#101719]">
              <MailIcon />
            </span>
            <span>
              <strong className="block text-base tracking-tight">每日科技早报</strong>
              <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-[#637078] dark:text-[#aab1ae]">
                EVERYDAY TECH NEWS
              </span>
            </span>
          </a>
          <span className="hidden border border-[#b9cbc5] px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-[#2f6f62] sm:block dark:border-[#466860] dark:text-[#79b3a5]">
            DAILY · 07:23 CST
          </span>
        </header>

        <section className="grid flex-1 gap-8 py-8 sm:gap-10 sm:py-14 lg:grid-cols-[1.08fr_0.92fr] lg:grid-rows-[auto_1fr] lg:items-center lg:gap-x-20 lg:gap-y-8 lg:py-20">
          <div className="order-1 max-w-2xl lg:col-start-1 lg:row-start-1">
            <p className="mb-3 font-mono text-[11px] font-bold tracking-[0.2em] text-[#bd4f32] sm:mb-5 sm:text-xs dark:text-[#dd7659]">
              CURATED, NOT CROWDED
            </p>
            <h1 className="max-w-[12ch] text-[clamp(2.3rem,11vw,6.9rem)] leading-[0.98] font-bold tracking-[-0.055em] sm:text-[clamp(3.4rem,8vw,6.9rem)] sm:leading-[0.94] sm:tracking-[-0.065em]">
              每天一封，
              <span className="block text-[#bd4f32] dark:text-[#dd7659]">刚好读完。</span>
            </h1>
          </div>

          <div className="relative order-2 mx-auto w-full max-w-xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute -inset-2 translate-x-1 translate-y-1 border border-[#bd4f32]/35 sm:-inset-3 sm:translate-x-3 sm:translate-y-3 dark:border-[#dd7659]/30"
            />
            <section className="relative border border-[#cbd4d2] bg-[rgba(255,254,249,0.94)] p-5 shadow-[0_28px_90px_rgba(35,48,48,0.12)] sm:p-9 dark:border-[#3a4647] dark:bg-[rgba(24,33,36,0.96)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.32)]">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="font-mono text-[11px] font-bold tracking-[0.16em] text-[#bd4f32] dark:text-[#dd7659]">
                    SUBSCRIPTION
                  </p>
                  <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
                    加入邮件列表
                  </h2>
                </div>
                <span className="grid size-10 place-items-center border border-[#b9cbc5] text-[#2f6f62] dark:border-[#466860] dark:text-[#79b3a5]">
                  <span className="size-2 bg-current" />
                </span>
              </div>

              <form className="mt-7 space-y-5 sm:mt-8" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold">你的称呼</span>
                  <input
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    minLength={1}
                    maxLength={50}
                    placeholder="例如：小林"
                    className="w-full rounded-none border border-[#9eaaa8] bg-white/35 px-4 py-3.5 text-base outline-none transition placeholder:text-[#8a9598] focus:border-[#bd4f32] focus:ring-2 focus:ring-[#bd4f32]/15 dark:border-[#536264] dark:bg-white/[0.025] dark:placeholder:text-[#778285] dark:focus:border-[#dd7659] dark:focus:ring-[#dd7659]/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold">接收邮箱</span>
                  <input
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                    className="w-full rounded-none border border-[#9eaaa8] bg-white/35 px-4 py-3.5 font-sans text-base outline-none transition placeholder:text-[#8a9598] focus:border-[#bd4f32] focus:ring-2 focus:ring-[#bd4f32]/15 dark:border-[#536264] dark:bg-white/[0.025] dark:placeholder:text-[#778285] dark:focus:border-[#dd7659] dark:focus:ring-[#dd7659]/20"
                  />
                </label>

                <label className="absolute -left-[9999px]" aria-hidden="true">
                  公司
                  <input
                    name="company"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="relative flex w-full cursor-pointer items-center justify-center rounded-none border-0 bg-[#bd4f32] px-12 py-4 text-center text-[#fffaf1] transition hover:bg-[#8c3521] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bd4f32] disabled:cursor-wait disabled:opacity-65 dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                >
                  <span className="block w-full text-center text-base font-bold">
                    {isLoading ? "正在订阅" : "订阅每日早报"}
                  </span>
                  {isLoading ? (
                    <span className="absolute right-5 size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <span className="absolute right-5">
                      <ArrowIcon />
                    </span>
                  )}
                </button>
              </form>

              {state.mode !== "idle" && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-5 flex items-start gap-3 border px-4 py-3.5 text-sm leading-6 ${
                    state.mode === "error"
                      ? "border-[#bd4f32]/45 bg-[#bd4f32]/5 text-[#8c3521] dark:border-[#dd7659]/45 dark:text-[#f0a18b]"
                      : state.mode === "success"
                        ? "border-[#2f6f62]/40 bg-[#2f6f62]/5 text-[#24564c] dark:border-[#79b3a5]/40 dark:text-[#93c8bb]"
                        : "border-[#cbd4d2] text-[#637078] dark:border-[#3a4647] dark:text-[#aab1ae]"
                  }`}
                >
                  {state.mode === "success" && <CheckIcon />}
                  <div className="flex-1">
                    <span>{state.message}</span>
                    {state.mode === "confirmation" && confirmationToken && (
                      <button
                        type="button"
                        onClick={handleConfirmation}
                        className="mt-5 flex w-full cursor-pointer items-center justify-center border-0 bg-[#bd4f32] px-5 py-3.5 font-bold text-[#fffaf1] transition hover:bg-[#8c3521] dark:bg-[#dd7659] dark:text-[#101719] dark:hover:bg-[#c86448]"
                      >
                        确认订阅
                      </button>
                    )}
                  </div>
                </div>
              )}

              <p className="mt-5 text-xs leading-6 text-[#6f7b80] dark:text-[#929c99]">
                提交后需在 24 小时内通过邮件确认。我们只将邮箱用于发送订阅内容，不会出售或共享。
              </p>
            </section>
          </div>

          <div className="order-3 max-w-2xl lg:col-start-1 lg:row-start-2">
            <p className="max-w-xl text-base leading-7 text-[#59666d] sm:text-lg sm:leading-8 dark:text-[#aab1ae]">
              从全天科技资讯中筛选、去重并排序，只保留值得关注的 25 条新闻。
              没有信息轰炸，也不需要不断刷新页面。
            </p>

            <div className="mt-6 flex max-w-xl items-center gap-3 border-l-2 border-[#2f6f62] bg-[#2f6f62]/5 px-4 py-3 text-sm text-[#526067] dark:border-[#79b3a5] dark:bg-[#79b3a5]/5 dark:text-[#b7bfbc]">
              <span className="size-2 shrink-0 bg-[#2f6f62] dark:bg-[#79b3a5]" />
              <span>
                自 {stableOperationStartLabel} 起，已稳定运行
                <strong className="mx-1 text-[#24564c] dark:text-[#93c8bb]">
                  {stableOperationDays.toLocaleString("zh-CN")}
                </strong>
                天
              </span>
            </div>

            <div className="mt-8 grid max-w-xl grid-cols-3 border-y border-[#cfd7d5] py-4 sm:mt-10 sm:py-5 dark:border-[#354244]">
              {[
                ["25", "每日精选"],
                ["0", "推广内容"],
                ["1", "封邮件"],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="border-r border-[#d8dfdf] px-2 first:pl-0 last:border-0 sm:px-3 dark:border-[#354244]"
                >
                  <strong className="block text-2xl text-[#2f6f62] dark:text-[#79b3a5]">
                    {value}
                  </strong>
                  <span className="mt-1 block text-xs text-[#637078] dark:text-[#aab1ae]">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[#cfd7d5] pt-5 text-xs text-[#637078] sm:flex-row sm:items-center sm:justify-between dark:border-[#354244] dark:text-[#929c99]">
          <span>新闻来自公开信息源，经自动过滤与排序。</span>
          <a
            href="https://github.com/nowscott/EverydayTechNews"
            target="_blank"
            rel="noreferrer"
            className="font-mono tracking-[0.08em] text-[#2f6f62] underline decoration-[#b9cbc5] underline-offset-4 dark:text-[#79b3a5] dark:decoration-[#466860]"
          >
            VIEW SOURCE ON GITHUB
          </a>
        </footer>
      </div>
    </main>
  );
}
