/* Secure SSC27 admin monitor. Never put a Supabase service-role key in this file. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://fiwqeivmieckzqglfrar.supabase.co";
  const SUPABASE_KEY = "sb_publishable_WGA-bPS2B7hxXHBEVk0r0A_mQkJFhAx";
  const client = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  const $ = id => document.getElementById(id);
  const state = { user: null, sessions: [], selectedId: null, channel: null, poll: null, refreshPromise: null, refreshPending: false, eventCache: {} };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    try { return date.toLocaleString("bn-BD", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return date.toLocaleString(); }
  }
  function fmtClock(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    try { return date.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch (_) { return date.toLocaleTimeString(); }
  }
  function isOnline(session) {
    const time = new Date(session.last_seen_at || 0).getTime();
    return session.status !== "left" && Number.isFinite(time) && Date.now() - time < 90000;
  }
  function isInQuiz(session) {
    return isOnline(session) && session.status === "active" && Boolean(session.current_quiz);
  }
  function setConnection(text, status) {
    const pill = $("connectionPill");
    if (!pill) return;
    pill.dataset.state = status === "ok" ? "ok" : status === "error" ? "error" : "warning";
    $("connectionText").textContent = text;
  }
  function showLoginMessage(text, isError) {
    $("loginMessage").textContent = text || "";
    $("loginMessage").style.color = isError ? "#b9483d" : "#2c7b4c";
  }
  function showErrorRow(message) {
    $("studentRows").innerHTML = '<tr><td colspan="5" class="empty">' + esc(message) + '</td></tr>';
  }
  async function requireAdmin(user) {
    if (!client || !user) return false;
    const { data, error } = await client.from("ssc27_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return Boolean(data && data.user_id === user.id);
  }
  async function activateAdmin(user) {
    let allowed = false;
    try { allowed = await requireAdmin(user); }
    catch (error) {
      console.error("[SSC27 admin] role check failed", error);
      showLoginMessage("অ্যাডমিন অনুমতি যাচাই করা যায়নি। ডেটাবেস/RLS সেটআপ পরীক্ষা করুন।", true);
      return false;
    }
    if (!allowed) {
      await client.auth.signOut();
      showLoginMessage("এই অ্যাকাউন্টে SSC 2027 Admin Panel-এর অনুমতি নেই।", true);
      return false;
    }
    state.user = user;
    $("loginView").hidden = true;
    $("dashboardView").hidden = false;
    await refreshSessions();
    startLiveUpdates();
    return true;
  }
  async function login(event) {
    event.preventDefault();
    if (!client) {
      showLoginMessage("Supabase client লোড হয়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।", true);
      return;
    }
    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "যাচাই হচ্ছে…";
    showLoginMessage("", false);
    try {
      const email = $("adminEmail").value.trim();
      const password = $("adminPassword").value;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error("ইমেইল/পাসওয়ার্ড যাচাই করা যায়নি");
      const ok = await activateAdmin(data.user);
      if (ok) $("adminPassword").value = "";
    } catch (error) {
      console.error("[SSC27 admin] sign-in failed", error);
      showLoginMessage("সাইন ইন ব্যর্থ। ইমেইল/পাসওয়ার্ড ঠিক আছে কি না দেখুন; অনুমোদিত অ্যাডমিন অ্যাকাউন্ট ব্যবহার করুন।", true);
    } finally {
      button.disabled = false;
      button.textContent = "নিরাপদে সাইন ইন করুন";
    }
  }
  async function refreshSessions() {
    if (!client || !state.user) return;
    if (state.refreshPromise) {
      state.refreshPending = true;
      return state.refreshPromise;
    }
    state.refreshPromise = (async () => {
      const { data, error } = await client.from("ssc27_sessions")
        .select("id,student_name,city,status,current_quiz,current_subject,total_questions,answered_count,correct_count,wrong_count,current_question_number,current_question_text,last_answer,last_event,created_at,started_at,last_seen_at,ended_at")
        .order("last_seen_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[SSC27 admin] loading sessions failed", error);
        setConnection("ডেটাবেস ত্রুটি", "error");
        showErrorRow("শিক্ষার্থীর তথ্য লোড করা যায়নি। ডেটা API permissions ও RLS policy পরীক্ষা করুন।");
        return;
      }
      state.sessions = data || [];
      if (!state.selectedId && state.sessions.length) state.selectedId = state.sessions[0].id;
      if (state.selectedId && !state.sessions.some(item => item.id === state.selectedId)) {
        state.selectedId = state.sessions.length ? state.sessions[0].id : null;
      }
      renderSessions();
      renderStats();
      $("lastUpdated").textContent = "সর্বশেষ আপডেট: " + fmtClock(new Date().toISOString());
      if (state.selectedId) await loadEvents(state.selectedId);
      else renderEmptyDetail();
    })().finally(async () => {
      state.refreshPromise = null;
      if (state.refreshPending) {
        state.refreshPending = false;
        await refreshSessions();
      }
    });
    return state.refreshPromise;
  }
  function renderStats() {
    const online = state.sessions.filter(isOnline).length;
    const answered = state.sessions.reduce((sum, item) => sum + (Number(item.answered_count) || 0), 0);
    const correct = state.sessions.reduce((sum, item) => sum + (Number(item.correct_count) || 0), 0);
    $("onlineCount").textContent = online.toLocaleString("bn-BD");
    $("totalCount").textContent = state.sessions.length.toLocaleString("bn-BD");
    $("answeredCount").textContent = answered.toLocaleString("bn-BD");
    $("accuracyCount").textContent = correct.toLocaleString("bn-BD");
  }
  function statusBadge(session) {
    if (isInQuiz(session)) return '<span class="status quiz">কুইজ করছে</span>';
    if (isOnline(session)) return '<span class="status">অনলাইনে</span>';
    return '<span class="status offline">অফলাইনে</span>';
  }
  function visibleSessions() {
    const query = $("searchInput").value.trim().toLocaleLowerCase();
    const filter = $("statusFilter").value;
    return state.sessions.filter(session => {
      const text = [session.student_name, session.city, session.current_quiz, session.current_subject].join(" ").toLocaleLowerCase();
      if (query && !text.includes(query)) return false;
      if (filter === "online" && !isOnline(session)) return false;
      if (filter === "quiz" && !isInQuiz(session)) return false;
      if (filter === "offline" && isOnline(session)) return false;
      return true;
    });
  }
  function renderSessions() {
    const rows = visibleSessions();
    if (!rows.length) {
      showErrorRow(state.sessions.length ? "এই ফিল্টারে কোনো শিক্ষার্থী পাওয়া যায়নি।" : "এখনো কোনো শিক্ষার্থী নাম/শহর দিয়ে অনুশীলন শুরু করেনি।");
      return;
    }
    $("studentRows").innerHTML = rows.map(session => {
      const selected = session.id === state.selectedId ? " selected" : "";
      const title = session.current_quiz || "এখনো কুইজ খোলেনি";
      const answered = Number(session.answered_count) || 0;
      const total = Number(session.total_questions) || 0;
      const progress = total > 0 ? answered.toLocaleString("bn-BD") + " / " + total.toLocaleString("bn-BD") : answered.toLocaleString("bn-BD") + " উত্তর";
      return '<tr class="' + selected.trim() + '" data-session-id="' + esc(session.id) + '" tabindex="0" aria-label="' + esc(session.student_name + " এর বিস্তারিত") + '">' +
        '<td data-label="শিক্ষার্থী"><div class="student-cell"><div class="student-name">' + esc(session.student_name) + '</div><div class="student-city">' + esc(session.city) + '</div></div></td>' +
        '<td data-label="স্ট্যাটাস">' + statusBadge(session) + '</td>' +
        '<td data-label="কুইজ"><div class="student-name" style="font-size:11px;max-width:180px;line-height:1.6">' + esc(title) + '</div><div class="student-city">' + esc(session.current_subject || "") + '</div></td>' +
        '<td data-label="উত্তর"><span class="num">' + esc(progress) + '</span></td>' +
        '<td data-label="সঠিক / ভুল"><span class="num">' + (Number(session.correct_count) || 0).toLocaleString("bn-BD") + ' <small>/</small> ' + (Number(session.wrong_count) || 0).toLocaleString("bn-BD") + '</span></td>' +
        '</tr>';
    }).join("");
    Array.from($("studentRows").querySelectorAll("tr[data-session-id]")).forEach(row => {
      const selectRow = () => {
        state.selectedId = row.dataset.sessionId;
        renderSessions();
        const current = state.sessions.find(s => s.id === state.selectedId);
        if (current) renderDetail(current, state.eventCache[state.selectedId] || []);
        loadEvents(state.selectedId);
      };
      row.addEventListener("click", selectRow);
      row.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRow(); } });
    });
    const selected = state.sessions.find(s => s.id === state.selectedId);
    if (selected) renderDetail(selected, state.eventCache[selected.id] || []);
  }
  async function loadEvents(sessionId) {
    if (!client || !state.user || !sessionId) return;
    const { data, error } = await client.from("ssc27_answer_events").select("id,session_id,event_type,quiz_title,subject,question_number,question_text,selected_answer,is_correct,event_at")
      .eq("session_id", sessionId).order("event_at", { ascending: false }).limit(100);
    if (error) {
      console.error("[SSC27 admin] loading answer timeline failed", error);
      state.eventCache[sessionId] = [];
      if (state.selectedId === sessionId) {
        const selected = state.sessions.find(s => s.id === sessionId);
        if (selected) renderDetail(selected, [], "প্রশ্ন/উত্তরের টাইমলাইন লোড করা যায়নি। অনুমতি ও Realtime/Data API সেটিং পরীক্ষা করুন।");
      }
      return;
    }
    state.eventCache[sessionId] = data || [];
    if (state.selectedId === sessionId) {
      const selected = state.sessions.find(s => s.id === sessionId);
      if (selected) renderDetail(selected, data || []);
    }
  }
  function renderEmptyDetail() {
    $("detailContent").className = "detail-empty";
    $("detailContent").innerHTML = '<div class="empty-icon">⌕</div><strong>একজন শিক্ষার্থী নির্বাচন করুন</strong><p>কুইজ খোলা, দেখা প্রশ্ন, নির্বাচিত উত্তর এবং সঠিক/ভুলের ফলাফল এখানে দেখা যাবে।</p>';
  }
  function labelForEvent(type) {
    const labels = {
      identity_submitted: "সাইটে প্রবেশ",
      quiz_opened: "কুইজ / অধ্যায় খোলা",
      quiz_started: "MCQ অনুশীলন শুরু",
      question_viewed: "প্রশ্ন দেখা",
      answer_submitted: "উত্তর নির্বাচন",
      quiz_completed: "কুইজ সম্পন্ন",
      quiz_closed: "কুইজ থেকে বের হয়েছে",
      session_left: "সেশন শেষ"
    };
    return labels[type] || type || "কার্যকলাপ";
  }
  function eventMarkup(ev) {
    let extra = "";
    if (ev.question_text) extra += '<div class="event-question">' + esc(ev.question_number ? "প্রশ্ন " + ev.question_number + ": " : "") + esc(ev.question_text) + '</div>';
    if (ev.event_type === "answer_submitted" && ev.selected_answer) {
      extra += '<div class="answer-line"><b>নির্বাচিত উত্তর:</b> ' + esc(ev.selected_answer) + '</div>';
      if (ev.is_correct === true) extra += '<span class="result-tag correct">✓ সঠিক</span>';
      else if (ev.is_correct === false) extra += '<span class="result-tag wrong">✕ ভুল</span>';
      else extra += '<span class="result-tag unknown">উত্তর রেকর্ড হয়েছে</span>';
    }
    if (ev.quiz_title && ["quiz_opened","quiz_started","quiz_completed","quiz_closed"].includes(ev.event_type)) {
      extra += '<div class="answer-line"><b>কুইজ:</b> ' + esc(ev.quiz_title) + (ev.subject ? ' · ' + esc(ev.subject) : "") + '</div>';
    }
    return '<article class="event"><div class="event-top"><div class="event-title">' + esc(labelForEvent(ev.event_type)) + '</div><time class="event-time">' + esc(fmtDate(ev.event_at)) + '</time></div>' + extra + '</article>';
  }
  function renderDetail(session, events, errorMessage) {
    if (!session) { renderEmptyDetail(); return; }
    $("detailContent").className = "detail-body";
    const answered = Number(session.answered_count) || 0;
    const correct = Number(session.correct_count) || 0;
    const wrong = Number(session.wrong_count) || 0;
    const progress = Number(session.total_questions) > 0 ? answered.toLocaleString("bn-BD") + " / " + Number(session.total_questions).toLocaleString("bn-BD") : answered.toLocaleString("bn-BD");
    const currentQuestion = session.current_question_text
      ? (session.current_question_number ? "প্রশ্ন " + session.current_question_number + " · " : "") + session.current_question_text
      : "এই মুহূর্তে কোনো প্রশ্ন শনাক্ত হয়নি।";
    const timeline = errorMessage ? '<div class="empty">' + esc(errorMessage) + '</div>' :
      (events.length ? events.map(eventMarkup).join("") : '<div class="empty">এই সেশনের কার্যকলাপ রেকর্ড হচ্ছে। নতুন কুইজ/উত্তর দিলে এখানে দেখা যাবে।</div>');
    $("detailContent").innerHTML =
      '<div class="student-title-row"><div><h2>' + esc(session.student_name) + '</h2><p>' + esc(session.city) + ' · সাইটে প্রবেশ: ' + esc(fmtDate(session.created_at)) + '</p></div>' + statusBadge(session) + '</div>' +
      '<div class="mini-stats"><div class="mini-stat"><strong>' + esc(progress) + '</strong><span>উত্তর / মোট প্রশ্ন</span></div><div class="mini-stat"><strong>' + correct.toLocaleString("bn-BD") + '</strong><span>সঠিক</span></div><div class="mini-stat"><strong>' + wrong.toLocaleString("bn-BD") + '</strong><span>ভুল</span></div></div>' +
      '<div class="current-box"><span class="label">CURRENT QUIZ / QUESTION</span><strong>' + esc(session.current_quiz || "এখনো কোনো কুইজ খোলেনি") + '</strong><p>' + esc(session.current_subject || "বিষয় শনাক্ত হয়নি") + '<br>' + esc(currentQuestion) + '<br>সর্বশেষ কার্যকলাপ: ' + esc(fmtDate(session.last_seen_at)) + '</p></div>' +
      '<div class="events-head"><h3>উত্তর ও কার্যকলাপ</h3><span>সর্বশেষ ' + Math.min(events.length, 100) + 'টি ইভেন্ট</span></div>' +
      '<div class="event-list">' + timeline + '</div>';
  }
  function startLiveUpdates() {
    if (state.channel) { client.removeChannel(state.channel); state.channel = null; }
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
    state.channel = client.channel("ssc27-live-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "ssc27_sessions" }, () => scheduleRefresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ssc27_answer_events" }, payload => {
        const id = payload && payload.new && payload.new.session_id;
        if (id && state.selectedId === id) loadEvents(id);
        scheduleRefresh();
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") setConnection("লাইভ সংযুক্ত", "ok");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnection("লাইভ সংযোগে সমস্যা", "error");
        else setConnection("লাইভ সংযোগ হচ্ছে…", "warning");
      });
    state.poll = setInterval(() => refreshSessions(), 15000);
  }
  let refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshSessions(), 350);
  }
  async function logout() {
    if (state.channel) await client.removeChannel(state.channel);
    if (state.poll) clearInterval(state.poll);
    state.channel = null; state.poll = null; state.user = null; state.sessions = []; state.selectedId = null;
    await client.auth.signOut();
    $("dashboardView").hidden = true;
    $("loginView").hidden = false;
    showLoginMessage("আপনি নিরাপদে লগ আউট করেছেন।", false);
  }
  function init() {
    if (!client) {
      showLoginMessage("Supabase client লোড হয়নি। সংযোগ বা CDN URL পরীক্ষা করুন।", true);
      $("loginButton").disabled = true;
      return;
    }
    $("loginForm").addEventListener("submit", login);
    $("logoutButton").addEventListener("click", logout);
    $("refreshButton").addEventListener("click", () => refreshSessions());
    $("searchInput").addEventListener("input", renderSessions);
    $("statusFilter").addEventListener("change", renderSessions);
    client.auth.getSession().then(({ data, error }) => {
      if (error) { showLoginMessage("লগইন সেশন যাচাই করা যায়নি। আবার সাইন ইন করুন।", true); return; }
      if (data && data.session && data.session.user) activateAdmin(data.session.user);
    }).catch(error => {
      console.error("[SSC27 admin] session restore failed", error);
      showLoginMessage("লগইন সেশন লোড করা যায়নি। আবার সাইন ইন করুন।", true);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();