import { appInfo, createAnimatedValue, effect, Image, LayoutAnimation, mount, Overlay, reduceMotion, Scroll, signal, Storage, Text, untracked, View, windowSize, type JSX, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { currentUser, loadLoginQuestions, login, logout, restoreSession } from "./src/discuz/client";
import { loadProfile } from "./src/discuz/forum";
import type { Profile } from "./src/discuz/parse";
import { clearCredentials, loadCredentials, saveCredentials } from "./src/discuz/credentials";
import { hasSavedCookies, reloadCookies } from "./src/discuz/cookies";
import { initVault } from "./src/discuz/vault";
import { ImageViewer, viewerOpen } from "./src/ui/imageViewer";
import { Forum } from "./src/ui/Forum";
import { notify, Toaster } from "./src/ui/toast";
import { DownloadIcon, ThemeIcon } from "./src/ui/icons";
import { LineIcon } from "./src/ui/lineIcons";
import { hint } from "./src/ui/Hint";
import { hideSystemTitleBar } from "./src/ui/TitleBar";
import { SettingsSheet } from "./src/ui/SettingsSheet";
import { GearIcon } from "./src/ui/icons";
import { isPhoneDevice, keyboardInset } from "./src/ui/keyboard";
import { availableUpdate, checkForUpdate, installUpdate, skipUpdate, startUpdateCheck, updateLabel, type AvailableUpdate } from "./src/update";
import { appearanceMode, appearanceName, cycleAppearance, palette, restoreAppearance } from "./src/ui/appearance";
import { installMenu } from "./src/ui/commands";
import { CookieImportDialog, cookieImportOpen, setOnCookiesImported } from "./src/ui/CookieImport";
import { AboutDialog, aboutOpen } from "./src/ui/AboutDialog";
import { debugEnabled } from "./src/debugLog";


function Button(props: { label: string; disabled?: boolean; secondary?: boolean; onPress: () => void }) {
  const secondary = props.secondary === true;
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      style={{
        backgroundColor: secondary ? palette().surface : props.disabled ? palette().buttonDisabled : palette().button,
        borderWidth: secondary ? 1 : 0,
        borderColor: palette().border,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: secondary ? palette().text : palette().buttonText,
          fontSize: 14,
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}


function IconButton(props: { icon: JSX.Element; title: string; disabled?: boolean; onPress: () => void }) {
  return (
    <View
      onPress={props.disabled ? undefined : props.onPress}
      accessibilityLabel={props.title}
      tooltip={hint(props.title)}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
      }}
    >
      {props.icon}
    </View>
  );
}

const DEFAULT_LOGIN_QUESTIONS = [
  { id: 0, text: "安全提问（未设置请忽略）" },
  { id: 1, text: "母亲的名字" },
  { id: 2, text: "爷爷的名字" },
  { id: 3, text: "父亲出生的城市" },
  { id: 4, text: "您其中一位老师的名字" },
  { id: 5, text: "您个人计算机的型号" },
  { id: 6, text: "您最喜欢的餐馆名称" },
  { id: 7, text: "驾驶执照最后四位数字" },
];

const MENU_ROWS: [string, keyof Profile][] = [
  ["用户组", "group"],
  ["注册日期", "registered"],
  ["上次访问", "lastVisit"],
  ["最后发表", "lastPost"],
  ["帖子级别", "postLevel"],
  ["阅读权限", "readPermission"],
  ["帖子数", "posts"],
  ["日均发帖", "dailyPosts"],
  ["精华", "essence"],
  ["页面访问量", "pageViews"],
  ["总计在线（小时）", "onlineTotal"],
  ["本月在线（小时）", "onlineThisMonth"],
  ["积分", "credits"],
  ["威望", "prestige"],
  ["金钱", "money"],
];

function MenuRow(props: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ fontSize: 12, color: palette().muted }}>{props.label}</Text>
      <Text style={{ fontSize: 12, color: palette().text }}>{props.value}</Text>
    </View>
  );
}

const APP_VERSION_LABEL = (() => {
  try {
    const version = appInfo().version;
    return version ? `V${version}` : "";
  } catch {
    return "";
  }
})();

function MenuAction(props: { label: string; trailing?: string; dot?: () => boolean; onPress: () => void }) {
  const hover = createAnimatedValue(0);
  return (
    <View
      onPress={props.onPress}
      onMouseEnter={() => {
        hover.timing(1, { duration: 120 }).catch(() => undefined);
      }}
      onMouseLeave={() => {
        hover.timing(0, { duration: 120 }).catch(() => undefined);
      }}
      accessibilityLabel={props.label}
      style={{ paddingVertical: 6, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 6 }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 6,
          backgroundColor: palette().border,
          opacity: hover.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }),
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 13, color: palette().text, flex: 1 }}>{props.label}</Text>
        {/* The build, dimmed, to the right of the row it belongs to. A red dot marks a release
            the reader has not answered yet; it sits on the version so the badge itself carries it. */}
        {props.trailing ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11, color: palette().muted }}>{props.trailing}</Text>
            {props.dot?.() ? (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#e5484d" }} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function App() {
  // Nothing touches the network until the saved cookies are back in memory.
  const ready = signal(false);
  const user = signal<string | null>(currentUser());
  const name = signal("");
  const pass = signal("");
  const busy = signal(false);
  // The security question a member may have set: 0 is none (Discuz's "未设置请忽略").
  const questionId = signal(0);
  const answer = signal("");
  const questionsOpen = signal(false);
  const questions = signal(DEFAULT_LOGIN_QUESTIONS);
  const avatar = signal<string | null>(null);
  // The sign-in dialog, opened from the blank avatar while signed out.
  const dialogOpen = signal(false);
  // The account menu, opened from the avatar while signed in: the profile's fields and sign-out.
  // `avatarNode` is the avatar's node: the menu's overlay is placed against it, and sits above the
  // whole window (a sibling column drawn later would otherwise cover a menu that is only absolute).
  const menuOpen = signal(false);
  const profile = signal<Profile | null>(null);
  const avatarNode = signal<ViewRef | null>(null);
  // The sign-out confirmation, opened from the menu's Sign Out.
  const confirmOpen = signal(false);
  // The release offer: opened from the version badge, closed by 「是」 or 「忽略」.
  const updateOpen = signal(false);
  // The display settings panel, opened from the gear between the account and the theme.
  const settingsOpen = signal(false);
  // The forum's own 提醒 / 短消息 openers, handed up so the account card can call them directly:
  // the card lives here, but those two lists belong to the forum.
  const forumActions = signal<{ openNotices: () => void; openMessages: () => void } | null>(null);
  // Unread notices, reported by the forum: a red dot on the avatar is the only place they show
  // now that 提醒 has left the column's own rows.
  const noticesUnread = signal(0);
  // The same for private messages, so the card's two openers carry the dots the column does not.
  const messagesUnread = signal(0);

  // The last profile asked for. A slow answer for the previous account must not land on the
  // current one: signing out and in again would otherwise show the old name's avatar and fields.
  let profileToken = 0;
  function refreshProfile(name: string) {
    const token = ++profileToken;
    loadProfile(name)
      .then((p) => {
        if (token !== profileToken) return;
        avatar.set(p.avatar ?? null);
        profile.set(p);
      })
      .catch(() => {
        if (token !== profileToken) return;
        // No profile to show: the menu stops saying it is loading, and shows only Sign Out.
        avatar.set(null);
        profile.set({});
      });
  }

  function showProfile(name: string) {
    user.set(name);
    // Remembered so the next launch shows the account at once, without waiting for the forum.
    Storage.setItem("visual:lastUser", name).catch(() => undefined);
    refreshProfile(name);
  }

  function openMenu() {
    menuOpen.set(true);
    refreshProfile(user() ?? "");
  }

  function closeMenu() {
    menuOpen.set(false);
  }

  // The avatar and the account name both toggle this card. nsh's Overlay lets a press reach the
  // control underneath as well as firing onPressOutside, so tapping the avatar/name can run
  // both handlers for one tap. Whichever runs first, the card must end up closed. The outside
  // handler stamps the time when it closes the card; a toggle arriving for that same tap then
  // stands down instead of reopening it. This keeps the two entry points consistent and makes
  // repeated taps flip the state cleanly, without touching anything else on the page.
  let outsideClosedAt = 0;
  function outsideCloseMenu() {
    if (!menuOpen()) return;
    outsideClosedAt = Date.now();
    closeMenu();
  }
  function toggleMenu() {
    // A press on the avatar/name may also have been reported as an outside press; if that
    // already closed the card for this tap, don't turn straight around and open it again.
    if (Date.now() - outsideClosedAt < 200) return;
    if (menuOpen()) closeMenu();
    else openMenu();
  }

  async function signIn() {
    busy.set(true);
    try {
      const ok = await login(name(), pass(), questionId(), answer());
      if (ok) {
        saveCredentials({ name: name(), pass: pass() });
        showProfile(name());
        pass.set("");
        answer.set("");
        dialogOpen.set(false);
      } else {
        notify("sign-in", "登录失败。");
      }
    } catch (e) {
      notify("sign-in", `登录失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy.set(false);
    }
  }

  async function signOut() {
    busy.set(true);
    try {
      await logout();
    } catch {
      // The local session ends either way; the server's answer is not needed.
    }
    clearCredentials();
    avatar.set(null);
    profile.set(null);
    menuOpen.set(false);
    user.set(null);
    Storage.removeItem("visual:lastUser").catch(() => undefined);
    name.set("");
    pass.set("");
    busy.set(false);
  }

  restoreAppearance();
  installMenu();

  // Restores the session: the saved cookies first, then the saved password. Only a
  // refused password clears what is saved. With nothing saved, or a login that no
  // longer works, the sign-in dialog opens. Runs on launch and after a cookie import.
  function restoreLogin() {
    const saved = loadCredentials();
    busy.set(true);
    restoreSession(saved)
      .then((state) => {
        if (state === "signed-in") {
          // The same completion as a sign-in: the profile shows and the sign-in dialog closes.
          showProfile(currentUser() ?? saved?.name ?? "");
          dialogOpen.set(false);
        }
        else if (state === "signed-out") {
          if (saved) clearCredentials();
        } else if (state === "offline") notify("restore", "当前离线，已保留已保存的登录信息。");
      })
      .catch((e) => notify("restore", `恢复登录失败：${e instanceof Error ? e.message : String(e)}`))
      .finally(() => busy.set(false));
  }

  // Debug: an import of cookies signs in with them at once.
  setOnCookiesImported(restoreLogin);

  // The window opens at once: the vault (an encrypted cookie store) is read in the background and
  // the session restored after it, instead of holding the first screen until the forum answers.
  ready.set(true);
  // The last account shows in the corner at once; the session check follows and corrects it.
  Storage.getItem("visual:lastUser")
    .then((saved: string | null) => { if (saved && !user()) user.set(saved); })
    .catch(() => undefined);
  void initVault().then(() => {
    reloadCookies();
    if (hasSavedCookies()) restoreLogin();
  });

  // The account menu, above the avatar: the signed-in user's profile fields, then Sign Out.
  // Fields the page lacks are left out; until the profile arrives the menu says it is loading.
  const accountMenu = (): JSX.Element => {
    const p = profile();
    return (
      <View
        style={{
          width: 240,
          padding: 12,
          gap: 6,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 600, color: palette().text }}>{user() ?? ""}</Text>
        {p ? (
          <Each
            of={MENU_ROWS.flatMap(([label, key]) => {
              const value = p[key];
              return value ? [{ label, value }] : [];
            })}
            key={(row: { label: string; value: string }) => row.label}
          >
            {(row) => <MenuRow label={row().label} value={row().value} />}
          </Each>
        ) : (
          <Text style={{ fontSize: 12, color: palette().muted }}>加载中…</Text>
        )}
        {/* 提醒 / 短消息 as icon buttons, in the card the user already has open. The forum owns
            those two lists, so pressing one leaves a request for it and closes the card. */}
        <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
          <View
            onPress={() => { closeMenu(); forumActions()?.openNotices(); }}
            accessibilityLabel="提醒"
            style={{ flex: 1, position: "relative", flexDirection: "row", alignItems: "center",
                     justifyContent: "center", gap: 5, paddingVertical: 6, borderRadius: 8,
                     borderWidth: 1, borderColor: palette().border }}
          >
            <LineIcon name="bell" size={13} />
            <Text style={{ fontSize: 12, color: palette().text }}>提醒</Text>
            {/* The count the avatar's dot stands for, on the button that opens the list. */}
            {noticesUnread() > 0 ? (
              <View style={{ position: "absolute", top: 3, right: 5, width: 6, height: 6,
                             borderRadius: 3, backgroundColor: "#e5484d" }} />
            ) : null}
          </View>
          <View
            onPress={() => { closeMenu(); forumActions()?.openMessages(); }}
            accessibilityLabel="短消息"
            style={{ flex: 1, position: "relative", flexDirection: "row", alignItems: "center",
                     justifyContent: "center", gap: 5, paddingVertical: 6, borderRadius: 8,
                     borderWidth: 1, borderColor: palette().border }}
          >
            <LineIcon name="mail" size={13} />
            <Text style={{ fontSize: 12, color: palette().text }}>短消息</Text>
            {messagesUnread() > 0 ? (
              <View style={{ position: "absolute", top: 3, right: 5, width: 6, height: 6,
                             borderRadius: 3, backgroundColor: "#e5484d" }} />
            ) : null}
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: palette().border, marginVertical: 4 }} />
        {/* The build and the release it may be behind: the dot rides on the version, and a press
            asks about that release. Sign out is a row of its own below, as it always was. */}
        <MenuAction
          label="检查更新"
          trailing={APP_VERSION_LABEL}
          dot={() => availableUpdate() !== null}
          onPress={() => {
            closeMenu();
            openUpdate();
          }}
        />
        {/* The rule separates what asks a question from what ends the session: 退出登录 is the
            one row here that cannot be undone by pressing again. */}
        <View style={{ height: 1, backgroundColor: palette().border, marginVertical: 4 }} />
        <MenuAction
          label="退出登录"
          onPress={() => {
            closeMenu();
            confirmOpen.set(true);
          }}
        />
      </View>
    );
  };

  // Android installs nothing by itself, so applying an update is opening the release page, where
  // the browser downloads the APK and the system installs it over this one (same key: the sign-in
  // and the settings stay). The badge's press reaches the same place.
  const applyUpdate = () => {
    const update: AvailableUpdate | null = availableUpdate();
    if (!update) return;
    installUpdate(update)
      .then((result) => {
        if (result !== "opened") notify("update", "无法打开下载页，请稍后再试");
      })
      .catch(() => notify("update", "无法打开下载页，请稍后再试"));
  };

  // The version badge's press: offer the release the check already found, or look now when the
  // dot is off (the reader asked, so this one answers either way).
  const openUpdate = () => {
    if (availableUpdate()) {
      updateOpen.set(true);
      return;
    }
    notify("update", "正在检查新版本…");
    checkForUpdate(true)
      .then((found) => {
        if (found) updateOpen.set(true);
        else notify("update", "已是最新版本");
      })
      .catch(() => notify("update", "检查失败，请稍后再试"));
  };

  // The account row and its controls sit at the bottom of the channel column,
  // as the Claude Code sidebar keeps its account at the bottom left. Signed out,
  // the row is a blank avatar that opens the sign-in dialog.
  // `compact` is the channel rail's width: the avatar, theme and sign-out stack in a column.
  const accountFooter = (compact: boolean): JSX.Element => (
    <View style={{ borderTopWidth: 1, borderColor: palette().border }}>
      <View style={{ padding: compact ? 6 : 10, flexDirection: compact ? "column" : "row", alignItems: "center", gap: 8 }}>
        {user() ? (
          <>
            {/* The avatar opens the account menu; the menu closes on a press outside it. */}
            <View
              ref={(n: ViewRef | null) => avatarNode.set(n)}
              onPress={toggleMenu}
              accessibilityLabel="账户菜单"
              style={{ position: "relative" }}
            >
              {avatar() ? (
                <Image src={avatar()!} style={{ width: 24, height: 24, borderRadius: 12 }} />
              ) : (
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: palette().border,
                    backgroundColor: palette().surface,
                  }}
                />
              )}
              {/* 提醒 unread: 提醒 no longer has a row of its own in the column, so the avatar
                  carries the dot — the same red as the row's badge used to draw. */}
              {noticesUnread() > 0 ? (
                <View
                  accessibilityLabel="有未读提醒"
                  style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 4,
                           backgroundColor: "#e5484d", borderWidth: 1, borderColor: palette().surface }}
                />
              ) : null}
            </View>
            {/* An overlay, not an absolute view: it draws above the whole window, not just this column. */}
            {menuOpen() && avatarNode() ? (
              <Overlay anchor={avatarNode()} placement="top" align="start" offset={8} onPressOutside={outsideCloseMenu}>
                {accountMenu()}
              </Overlay>
            ) : null}
          </>
        ) : (
          <View
            onPress={() => dialogOpen.set(true)}
            accessibilityLabel="登录"
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: palette().border,
              backgroundColor: palette().surface,
            }}
          />
        )}
        {compact ? null : user() ? (
          // The name opens the same card as the avatar: both read as "this is me".
          <View
            onPress={toggleMenu}
            accessibilityLabel="账户菜单"
            style={{ flex: 1 }}
          >
            <Text style={{ fontSize: 13, color: palette().text }}>{user()!}</Text>
          </View>
        ) : (
          // Signed out, the name's place reads "Sign in" and opens the same dialog as the avatar.
          <View onPress={() => dialogOpen.set(true)} accessibilityLabel="登录" style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: palette().text }}>登录</Text>
          </View>
        )}
        {availableUpdate() ? (
          <IconButton
            icon={<DownloadIcon size={18} />}
            title={updateLabel(availableUpdate()!)}
            onPress={applyUpdate}
          />
        ) : null}
        <IconButton
          icon={<GearIcon size={17} />}
          title="显示设置"
          onPress={() => settingsOpen.set(true)}
        />
        <IconButton icon={<ThemeIcon size={16} mode={appearanceMode} />} title={`Theme: ${appearanceName(appearanceMode())}`} onPress={cycleAppearance} />
      </View>
    </View>
  );

  // The forum's login page names the security questions it accepts; its list replaces the
  // client's default one when it loads. A failure keeps the default list.
  effect(() => {
    if (!dialogOpen()) return;
    untracked(() => {
      void loadLoginQuestions().then((list) => {
        if (list.length > 0) questions.set(list);
      }).catch(() => undefined);
    });
  });

  // The sign-in dialog: a panel over the forum, with Cancel and Sign in.
  const signInDialog: JSX.Element = (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
    >
      <View
        style={{
          width: Math.min(320, windowSize().width - 40),
          padding: 16,
          gap: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>账户</Text>
        <Input
          placeholder="用户名"
          value={name()}
          onChange={({ value: text }: { value: string }) => name.set(text)}
          style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
        />
        <Input
          placeholder="密码"
          masked={true}
          value={pass()}
          onChange={({ value: text }: { value: string }) => pass.set(text)}
          // Return in the password field signs in, like the default button in the Swift sheet.
          onSubmit={() => {
            if (!busy() && name().length > 0 && pass().length > 0) void signIn();
          }}
          style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
        />
        {/* A member who set a security question answers it here; id 0 posts none. */}
        <View
          onPress={() => questionsOpen.set(!questionsOpen())}
          accessibilityLabel="安全提问"
          style={{
            height: 30, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1,
            borderColor: palette().border, backgroundColor: palette().bg,
            flexDirection: "row", alignItems: "center", gap: 6,
          }}
        >
          <Text style={{ fontSize: 13, color: questionId() === 0 ? palette().muted : palette().text, flex: 1, numberOfLines: 1 }}>
            {questions().find((q) => q.id === questionId())?.text ?? "安全提问（未设置请忽略）"}
          </Text>
          <Text style={{ fontSize: 11, color: palette().muted }}>▾</Text>
        </View>
        {questionsOpen() ? (
          <Scroll style={{ maxHeight: 168 }} contentStyle={{ gap: 1 }}>
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: palette().border, overflow: "hidden" }}>
              {questions().map((q) => (
                <View
                  onPress={() => {
                    questionId.set(q.id);
                    if (q.id === 0) answer.set("");
                    questionsOpen.set(false);
                  }}
                  style={{ paddingVertical: 7, paddingHorizontal: 8, backgroundColor: q.id === questionId() ? palette().selected : palette().bg }}
                >
                  <Text style={{ fontSize: 12.5, color: palette().text }}>{q.text}</Text>
                </View>
              ))}
            </View>
          </Scroll>
        ) : null}
        {questionId() > 0 ? (
          <Input
            placeholder="安全提问的答案"
            value={answer()}
            onChange={({ value: text }: { value: string }) => answer.set(text)}
            style={{ height: 36, paddingHorizontal: 10, fontSize: 14, color: palette().text, placeholderColor: palette().muted, caretColor: palette().link, borderRadius: 8, borderWidth: 1, borderColor: palette().border, backgroundColor: palette().bg }}
          />
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button label="取消" secondary={true} onPress={() => dialogOpen.set(false)} />
          <Button
            label={busy() ? "正在登录…" : "登录"}
            disabled={busy() || name().length === 0 || pass().length === 0}
            onPress={signIn}
          />
        </View>
      </View>
    </View>
  );

  // The sign-out confirmation: a panel over the forum, with Cancel and Sign Out.
  const signOutDialog: JSX.Element = (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
    >
      <View
        style={{
          width: 280,
          padding: 16,
          gap: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surface,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>退出登录？</Text>
        <Text style={{ fontSize: 13, color: palette().text }}>{`退出登录 ${user() ?? "此账户"}？`}</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button label="取消" secondary={true} onPress={() => confirmOpen.set(false)} />
          <Button
            label={busy() ? "正在退出…" : "退出登录"}
            disabled={busy()}
            onPress={() => {
              confirmOpen.set(false);
              signOut();
            }}
          />
        </View>
      </View>
    </View>
  );

  // The release offer: the version the check found, what it says, and the two answers. 「忽略」
  // keeps the version out of the badge until the next one; 「是」 opens the release page.
  // A function, not an element: the app's body runs once, so an element built here would hold
  // whatever the signal said at start-up. Called where the dialog is mounted.
  const updateDialog = (): JSX.Element | null => {
    const update = availableUpdate();
    if (!update) return null;
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.35)",
        }}
      >
        <View
          style={{
            width: Math.min(320, windowSize().width - 40),
            padding: 16,
            gap: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().surface,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: 600, color: palette().text }}>
            {`发现新版本 V${update.version}`}
          </Text>
          {update.notes ? (
            <Text style={{ fontSize: 13, color: palette().text }}>{update.notes}</Text>
          ) : null}
          <Text style={{ fontSize: 12, color: palette().muted }}>点「是」打开下载页，覆盖安装后登录状态不变。</Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="忽略"
              secondary={true}
              onPress={() => {
                updateOpen.set(false);
                void skipUpdate();
              }}
            />
            <Button
              label="是"
              onPress={() => {
                updateOpen.set(false);
                applyUpdate();
              }}
            />
          </View>
        </View>
      </View>
    );
  };

  // The whole interface used to be one `selectable` view so every text could be copied.
  // On Android that makes NSH wrap the entire window in a `SelectableView` selection layer
  // (it captures ACTION_DOWN to start a long-press text-selection gesture). That layer sits
  // above every child and swallows the single-tap (onPress) dispatch, so buttons and thread
  // rows stop responding and taps feel "off" (only the control's non-text area still fires).
  // Selection is therefore scoped off the root; if copy is wanted later, mark the specific
  // read-only text blocks `selectable` instead of the whole window.
  // Keep the content above the keyboard. The decision lives in keyboard.ts so the root's inset and
  // the reply box's own height cap read the same state — a single source of truth for both, in
  // portrait on a phone and in the tablet's split view alike.

  // The keyboard lifts the reply box by padding the root. Without an announced animation the
  // inset arrives as one step, so the bar teleports while the keyboard itself glides — and a
  // focused field yanked around mid-show can make Android retry the IME, which reads as "the
  // keyboard takes forever". Announcing a layout animation first turns the lift into a glide.
  // One APK, two device paths: on a phone the system's adjustResize moves the whole window,
  // `keyboardInset()` stays 0 and there is nothing to animate; on a tablet a reported IME
  // height can still change the inset, which keeps the verified 220 ms ease-in-out glide.
  let lastInset: number | null = null;
  effect(() => {
    const inset = keyboardInset();
    untracked(() => {
      // A phone device leaves the lift to the system's own adjustment (as the mobile app
      // does): its inset stays 0, so there is nothing to animate. The pad keeps the glide
      // that was verified in both orientations.
      if (lastInset !== null && inset !== lastInset && !reduceMotion() && !isPhoneDevice()) {
        LayoutAnimation.configureNext({ duration: 220, update: { type: "easeInEaseOut" } });
      }
      lastInset = inset;
    });
  });

  return (
    <View
      style={{
        flex: 1,
        paddingTop: "env(safe-area-inset-top)",
        paddingRight: "env(safe-area-inset-right)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        alignItems: "stretch",
        justifyContent: "flex-start",
        backgroundColor: palette().bg,
      }}
    >
      <View style={{ flex: 1, alignSelf: "stretch", paddingBottom: keyboardInset() }}>
        {ready() ? (
          <Forum
          user={user}
          footer={(compact) => accountFooter(compact)}
          onSignInNeeded={() => dialogOpen.set(true)}
          onActions={(api) => forumActions.set(api)}
          noticesUnread={noticesUnread}
          messagesUnread={messagesUnread}
        />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 14, color: palette().muted }}>正在恢复登录状态…</Text>
          </View>
        )}
      </View>
      {dialogOpen() ? signInDialog : null}
      {confirmOpen() ? signOutDialog : null}
      {updateOpen() ? updateDialog() : null}
      {debugEnabled && cookieImportOpen() ? <CookieImportDialog /> : null}
      {aboutOpen() ? <AboutDialog /> : null}
      {/* Mounted only while a picture is shown: the read has to happen in this
          reactive child position, not inside the viewer's own body, or the
          overlay never appears when `openImageViewer` sets it later. */}
      {settingsOpen() ? <SettingsSheet onClose={() => settingsOpen.set(false)} /> : null}
      {viewerOpen() ? <ImageViewer /> : null}
      {/* After the viewer, so a message about saving a picture shows over it. */}
      <Toaster />

    </View>
  );
}

hideSystemTitleBar();
mount(App);
startUpdateCheck();
