/* SSC 2027 student-side progress monitor.
   The Supabase publishable key is intentionally public; database RLS/RPC validates all writes. */
(function () {
  "use strict";

  const SUPABASE_URL = "https://fiwqeivmieckzqglfrar.supabase.co";
  const SUPABASE_KEY = "sb_publishable_WGA-bPS2B7hxXHBEVk0r0A_mQkJFhAx";
  const STORAGE_KEY = "ssc27_live_monitor_session_v1";
  const supabaseClient = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
    : null;

  let session = readSession();
  let lastQuestionKey = "";
  let quizScreenActive = false;
  let lastTrackingToastAt = 0;
  let connectionPill = null;
  let scanTimer = null;

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); }
    catch (_) { return null; }
  }
  function saveSession() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (_) {}
  }
  function safeText(value, max) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 1800);
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isVisible(el) {
    if (!el || el.hidden) return false;
    const style = window.getComputedStyle ? getComputedStyle(el) : null;
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
  }
  function makeToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function styleOnce() {
    if (document.getElementById("ssc27-track-style")) return;
    const style = document.createElement("style");
    style.id = "ssc27-track-style";
    style.textContent = `
      #ssc27-identity-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(12,34,28,.68);backdrop-filter:blur(9px);font-family:system-ui,-apple-system,"Noto Sans Bengali",sans-serif;color:#173d35}
      #ssc27-identity-card{width:min(100%,470px);max-height:calc(100dvh - 36px);overflow:auto;background:#fffefa;border:1px solid #dbe7dd;border-radius:26px;box-shadow:0 28px 90px rgba(0,0,0,.3);padding:clamp(22px,5vw,34px)}
      .ssc27-kicker{display:inline-flex;align-items:center;gap:8px;color:#397a5a;background:#eaf5ec;padding:7px 11px;border-radius:99px;font-size:12px;font-weight:800;letter-spacing:.02em}
      #ssc27-identity-card h2{font-size:clamp(23px,5vw,30px);line-height:1.3;letter-spacing:-.5px;margin:16px 0 9px;color:#173d35}
      #ssc27-identity-card p{line-height:1.75;color:#607068;font-size:14px;margin:0 0 18px}
      .ssc27-field{display:block;font-size:13px;font-weight:750;color:#284c3d;margin:14px 0 6px}
      .ssc27-input{width:100%;min-height:48px;border:1px solid #d8e3da;border-radius:13px;padding:12px 14px;background:#fff;font:inherit;color:#173d35;outline:none}
      .ssc27-input:focus{border-color:#4b926c;box-shadow:0 0 0 4px rgba(75,146,108,.13)}
      #ssc27-consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:#4d6257;font-size:12px;line-height:1.7}
      #ssc27-consent input{margin-top:4px;accent-color:#247052;flex:0 0 auto}
      #ssc27-enter{width:100%;min-height:49px;border:0;border-radius:13px;background:linear-gradient(135deg,#194d3d,#267557);color:white;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 8px 22px rgba(25,77,61,.19)}
      #ssc27-enter:disabled{opacity:.6;cursor:wait}
      #ssc27-offline-enter{display:none;width:100%;margin-top:10px;min-height:43px;border:1px solid #d4ddd4;border-radius:12px;background:#fff;color:#455b4d;font-weight:700;cursor:pointer}
      #ssc27-form-error{min-height:20px;margin:11px 0 0!important;color:#a13b30!important;font-size:12px!important}
      #ssc27-tracking-pill{position:fixed;left:12px;bottom:12px;z-index:2147482000;border:1px solid #cbded0;background:rgba(255,255,255,.95);box-shadow:0 6px 20px rgba(20,49,35,.12);border-radius:999px;padding:8px 12px;font:700 11px/1.2 system-ui,sans-serif;color:#28593f;display:flex;align-items:center;gap:7px;pointer-events:none}
      #ssc27-tracking-pill .dot{width:7px;height:7px;border-radius:50%;background:#2d9660;flex:0 0 auto}
      #ssc27-tracking-pill[data-state="error"]{color:#8d3b31;border-color:#f0d3ce}
      #ssc27-tracking-pill[data-state="error"] .dot{background:#c74d40}
      #ssc27-tracking-pill[data-state="offline"]{color:#7a6130;border-color:#eadab3}
      #ssc27-tracking-pill[data-state="offline"] .dot{background:#c09238}
      #ssc27-track-toast{position:fixed;left:12px;right:12px;bottom:52px;margin:auto;max-width:480px;z-index:2147482500;border-radius:13px;padding:12px 15px;background:#fff5e9;color:#704521;border:1px solid #ead5b8;box-shadow:0 8px 25px rgba(0,0,0,.12);font:600 12px/1.65 system-ui,sans-serif}
      #ssc27-admin-footer-link{display:inline-block;margin:16px 0 6px;color:#6a8174;font:600 11px/1.4 system-ui,sans-serif;text-decoration:none;opacity:.85}
      #ssc27-admin-footer-link:hover{color:#1a5f42;text-decoration:underline;opacity:1}
      @media(max-width:520px){#ssc27-identity-card{border-radius:21px;padding:22px 18px}#ssc27-tracking-pill{left:8px;bottom:8px;padding:7px 10px;font-size:10px}}
      @media(prefers-reduced-motion:reduce){#ssc27-identity-overlay *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }
  function setPill(text, state) {
    if (!connectionPill) {
      connectionPill = document.createElement("div");
      connectionPill.id = "ssc27-tracking-pill";
      connectionPill.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="label"></span>';
      document.body.appendChild(connectionPill);
    }
    connectionPill.dataset.state = state || "ok";
    connectionPill.querySelector(".label").textContent = text;
  }
  function showToast(message) {
    const now = Date.now();
    if (now - lastTrackingToastAt < 25000) return;
    lastTrackingToastAt = now;
    const previous = document.getElementById("ssc27-track-toast");
    if (previous) previous.remove();
    const el = document.createElement("div");
    el.id = "ssc27-track-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 9000);
  }
  function addAdminLink() {
    if (document.getElementById("ssc27-admin-footer-link")) return;
    const footer = document.querySelector(".footer, footer");
    const link = document.createElement("a");
    link.id = "ssc27-admin-footer-link";
    link.href = "./admin.html";
    link.textContent = "অ্যাডমিন প্যানেল";
    link.setAttribute("aria-label", "SSC 2027 অ্যাডমিন প্যানেল");
    if (footer) footer.appendChild(link);
    else {
      link.style.position = "fixed";
      link.style.right = "10px";
      link.style.bottom = "10px";
      link.style.zIndex = "1000";
      link.style.background = "rgba(255,255,255,.86)";
      link.style.padding = "5px 8px";
      link.style.borderRadius = "8px";
      document.body.appendChild(link);
    }
  }
  function showIdentityGate() {
    styleOnce();
    const existing = document.getElementById("ssc27-identity-overlay");
    if (existing) return;
    const overlay = document.createElement("div");
    overlay.id = "ssc27-identity-overlay";
    overlay.innerHTML = `
      <section id="ssc27-identity-card" role="dialog" aria-modal="true" aria-labelledby="ssc27-gate-heading">
        <span class="ssc27-kicker">SSC 2027 · MCQ PRACTICE</span>
        <h2 id="ssc27-gate-heading">শুরু করার আগে পরিচয় দিন</h2>
        <p>নাম ও শহর/জেলা লিখে অনুশীলন শুরু করুন। আপনার খোলা কুইজ, দেখা প্রশ্ন, দেওয়া উত্তর এবং সঠিক/ভুলের অগ্রগতি লাইভ Admin Panel-এ দেখা যাবে। এই তথ্য কেবল পড়াশোনার অগ্রগতি পর্যবেক্ষণের জন্য ব্যবহার করা হবে।</p>
        <form id="ssc27-identity-form">
          <label class="ssc27-field" for="ssc27-student-name">আপনার নাম</label>
          <input class="ssc27-input" id="ssc27-student-name" name="student_name" maxlength="80" autocomplete="name" required minlength="2" placeholder="যেমন: Rahim Ahmed">
          <label class="ssc27-field" for="ssc27-student-city">শহর / জেলা</label>
          <input class="ssc27-input" id="ssc27-student-city" name="city" maxlength="80" autocomplete="address-level2" required minlength="2" placeholder="যেমন: ঢাকা">
          <label id="ssc27-consent" for="ssc27-consent-check">
            <input id="ssc27-consent-check" type="checkbox" required>
            <span>আমি বুঝেছি যে আমার MCQ অনুশীলনের অগ্রগতি ও নির্বাচিত উত্তর অনুমোদিত অ্যাডমিন দেখতে পারবেন।</span>
          </label>
          <button id="ssc27-enter" type="submit">অনুশীলন শুরু করুন <span aria-hidden="true">→</span></button>
          <button id="ssc27-offline-enter" type="button">লাইভ ট্র্যাকিং ছাড়া প্রবেশ করুন</button>
          <p id="ssc27-form-error" aria-live="polite"></p>
        </form>
      </section>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    const nameInput = overlay.querySelector("#ssc27-student-name");
    window.setTimeout(() => nameInput.focus({ preventScroll: true }), 60);
    overlay.querySelector("#ssc27-identity-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      const name = safeText(nameInput.value, 80);
      const city = safeText(overlay.querySelector("#ssc27-student-city").value, 80);
      const consent = overlay.querySelector("#ssc27-consent-check").checked;
      const error = overlay.querySelector("#ssc27-form-error");
      const enter = overlay.querySelector("#ssc27-enter");
      const offline = overlay.querySelector("#ssc27-offline-enter");
      if (name.length < 2 || city.length < 2 || !consent) {
        error.textContent = "নাম, শহর/জেলা এবং সম্মতির ঘর পূরণ করুন।";
        return;
      }
      if (!supabaseClient) {
        error.textContent = "লাইভ ট্র্যাকিং লাইব্রেরি লোড হয়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
        offline.style.display = "block";
        return;
      }
      enter.disabled = true;
      enter.textContent = "সংযোগ করা হচ্ছে…";
      error.textContent = "";
      offline.style.display = "none";
      const token = makeToken();
      try {
        const { data, error: rpcError } = await supabaseClient.rpc("ssc27_start_session", {
          p_student_name: name, p_city: city, p_session_token: token
        });
        if (rpcError) throw rpcError;
        const id = typeof data === "string" ? data : (Array.isArray(data) ? data[0] : data);
        if (!id || typeof id !== "string") throw new Error("সেশন আইডি পাওয়া যায়নি");
        session = { id, token, name, city, status: "ready", currentQuiz: "", currentSubject: "", answers: {}, totalQuestions: 0, consentedAt: new Date().toISOString() };
        saveSession();
        closeIdentityGate(overlay);
        startMonitoring();
        setPill("লাইভ ট্র্যাকিং চালু", "ok");
      } catch (err) {
        console.error("[SSC27 tracking] start session failed", err);
        error.textContent = "লাইভ ট্র্যাকিং চালু করা যায়নি। আবার চেষ্টা করুন; না হলে ট্র্যাকিং ছাড়া অনুশীলন চালাতে পারবেন।";
        offline.style.display = "block";
        enter.disabled = false;
        enter.textContent = "আবার চেষ্টা করুন";
      }
    });
    overlay.querySelector("#ssc27-offline-enter").addEventListener("click", function () {
      closeIdentityGate(overlay);
      setPill("লাইভ ট্র্যাকিং বন্ধ", "offline");
      showToast("এই সেশনে লাইভ অগ্রগতি সেভ হচ্ছে না। Admin Panel-এ আপনার বর্তমান কার্যকলাপ দেখা নাও যেতে পারে।");
    });
  }
  function closeIdentityGate(overlay) {
    if (overlay) overlay.remove();
    document.body.style.overflow = "";
    addAdminLink();
  }
  function questionCards() {
    const nodes = Array.from(document.querySelectorAll("#questionText,.qcard,.question-card,.question-item,[data-question-index],.quiz-question,.mcq-question,.question-block"));
    return nodes.filter(el => isVisible(el) && safeText(el.innerText || el.textContent, 1800).length > 10);
  }
  function findQuestionCard(from) {
    if (!from || !from.closest) return null;
    return from.closest(".qcard,.question-card,.question-item,[data-question-index],.quiz-question,.mcq-question,.question-block,article");
  }
  function questionLabel(card) {
    if (!card) return "";
    if (card.id === "questionText") return safeText(card.innerText || card.textContent, 1800);
    const liveQuestion = card.querySelector && card.querySelector("#questionText");
    if (liveQuestion) return safeText(liveQuestion.innerText || liveQuestion.textContent, 1800);
    const el = card.querySelector("[data-question-text],.question-text,.question-title,.question-statement,h2,h3,h4");
    const candidate = safeText(el ? (el.innerText || el.textContent) : "", 1800);
    if (candidate) return candidate;
    const text = safeText(card.innerText || card.textContent, 1800);
    return text.slice(0, 900);
  }
  function questionNumber(card, clickedCard) {
    const quizCount = safeText(document.querySelector("#quizCount")?.textContent || "", 80);
    const quizMatch = quizCount.match(/(\d+)\s*\/\s*(\d+)/);
    if (quizMatch) return Number(quizMatch[1]);
    const el = card || clickedCard;
    if (el) {
      for (const key of ["questionIndex", "questionNumber", "index"]) {
        const raw = el.dataset && el.dataset[key];
        if (raw != null && /^\d+$/.test(raw)) {
          const n = Number(raw);
          return key === "questionIndex" || n === 0 ? n + 1 : n;
        }
      }
      const label = safeText(el.querySelector(".question-number,.q-number,.question-count")?.textContent || "", 80);
      const m = label.match(/(?:প্রশ্ন|question|q)\s*#?\s*(\d+)/i) || label.match(/\b(\d+)\s*\//);
      if (m) return Number(m[1]);
    }
    const progress = safeText(document.querySelector(".question-progress,.progress-text,.question-counter,[aria-label*='progress']")?.textContent || "", 120);
    const m = progress.match(/(?:প্রশ্ন|question)?\s*(\d+)\s*(?:\/|of|এর মধ্যে)\s*\d+/i);
    if (m) return Number(m[1]);
    const cards = questionCards();
    if (el && cards.length > 1) return cards.indexOf(el) + 1;
    return cards.length ? 1 : null;
  }
  function getQuizTitle(fallback) {
    const liveTitle = safeText(document.querySelector("#quizSubjectName")?.textContent || "", 180);
    if (liveTitle && isVisible(document.querySelector("#quizSubjectName"))) return liveTitle;
    const titleSelectors = ["[data-quiz-title]", "#quizTitle", ".quiz-title", ".quiz-header h1", ".quiz-header h2", ".quiz-heading h1", ".quiz-heading h2"];
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      const value = safeText(el && (el.innerText || el.textContent), 180);
      if (value && !/^(?:mcq|ssc\s*2027|প্রশ্ন|অনুশীলন)$/i.test(value)) return value;
    }
    const active = document.querySelector(".filter-btn.active,.category-btn.active,[data-category][aria-pressed='true'],[data-subject][aria-pressed='true']");
    const activeText = safeText(active && (active.innerText || active.textContent), 180);
    if (activeText && !/সব অধ্যায়|সব বিষয়|all categories/i.test(activeText)) return activeText;
    const heading = document.querySelector(".main-panel .section-heading h2,.main-panel h1,.main-panel h2,.quiz-panel h2");
    const headingText = safeText(heading && (heading.innerText || heading.textContent), 180);
    if (headingText && !/প্রশ্ন বেছে নাও|mcq অনুশীলন|প্রশ্নব্যাংক|প্রশ্নসমূহ/i.test(headingText)) return headingText;
    return safeText(fallback || session?.currentQuiz || "SSC 2027 · MCQ অনুশীলন", 180);
  }
  function getSubject() {
    const liveSubject = safeText(document.querySelector("#quizSubjectName")?.textContent || "", 120);
    if (liveSubject && isVisible(document.querySelector("#quizSubjectName"))) return liveSubject;
    const attr = document.querySelector("[data-subject]");
    if (attr && attr.getAttribute("data-subject")) return safeText(attr.getAttribute("data-subject"), 120);
    const chip = document.querySelector(".syllabus-chip,.subject-chip,.active-subject");
    return safeText(chip && (chip.innerText || chip.textContent), 120);
  }
  function getTotalQuestions() {
    const liveCount = safeText(document.querySelector("#quizCount")?.textContent || "", 80);
    const liveMatch = liveCount.match(/(\d+)\s*\/\s*(\d+)/);
    if (liveMatch) return Math.min(2000, Number(liveMatch[2]));
    const subjectCount = safeText(document.querySelector("#quizSubjectEn")?.textContent || "", 100);
    const subjectMatch = subjectCount.match(/(\d+)\s*MCQ/i);
    if (subjectMatch) return Math.min(2000, Number(subjectMatch[1]));
    const progressEls = document.querySelectorAll(".question-progress,.progress-text,.question-counter,[data-total-questions]");
    for (const el of progressEls) {
      const attr = el.getAttribute("data-total-questions");
      if (attr && /^\d+$/.test(attr)) return Math.min(2000, Number(attr));
      const value = safeText(el.innerText || el.textContent, 120);
      const m = value.match(/(?:প্রশ্ন|question)?\s*\d+\s*(?:\/|of|এর মধ্যে)\s*(\d+)/i);
      if (m) return Math.min(2000, Number(m[1]));
    }
    const countInput = document.querySelector("#questionCount,select[name='questionCount'],input[name='questionCount'],[data-question-count]");
    if (countInput) {
      const value = Number(countInput.value || countInput.getAttribute("data-question-count"));
      if (Number.isFinite(value) && value > 0) return Math.min(2000, Math.floor(value));
    }
    const cards = questionCards();
    return cards.length > 1 ? Math.min(2000, cards.length) : (session?.totalQuestions || 0);
  }
  function counts() {
    const answers = session && session.answers ? Object.values(session.answers) : [];
    return {
      answered: answers.length,
      correct: answers.filter(a => a && a.correct === true).length,
      wrong: answers.filter(a => a && a.correct === false).length
    };
  }
  function trackEvent(eventType, data) {
    if (!session || !session.id || !session.token) return Promise.resolve(false);
    data = data || {};
    const quizTitle = safeText(data.quizTitle !== undefined ? data.quizTitle : (session.currentQuiz || getQuizTitle()), 180);
    const subject = safeText(data.subject !== undefined ? data.subject : getSubject(), 120);
    if (data.quizTitle !== undefined) session.currentQuiz = quizTitle;
    if (data.subject !== undefined && subject) session.currentSubject = subject;
    const tally = counts();
    const total = Number.isFinite(data.totalQuestions) ? data.totalQuestions : getTotalQuestions();
    if (total > 0) session.totalQuestions = Math.min(2000, total);
    if (data.status) session.status = data.status;
    saveSession();
    if (!supabaseClient) return Promise.resolve(false);
    return supabaseClient.rpc("ssc27_track_event", {
      p_session_id: session.id,
      p_session_token: session.token,
      p_event_type: eventType,
      p_quiz_title: quizTitle || null,
      p_subject: subject || null,
      p_question_number: Number.isFinite(data.questionNumber) ? data.questionNumber : null,
      p_question_text: data.questionText ? safeText(data.questionText, 1800) : null,
      p_selected_answer: data.selectedAnswer ? safeText(data.selectedAnswer, 500) : null,
      p_is_correct: typeof data.isCorrect === "boolean" ? data.isCorrect : null,
      p_total_questions: session.totalQuestions || total || 0,
      p_answered_count: tally.answered,
      p_correct_count: tally.correct,
      p_wrong_count: tally.wrong,
      p_status: data.status || session.status || "ready"
    }).then(({ error }) => {
      if (error) {
        console.error("[SSC27 tracking] event failed", eventType, error);
        setPill("লাইভ ট্র্যাকিং সমস্যা", "error");
        showToast("লাইভ অগ্রগতি পাঠাতে সমস্যা হয়েছে। সংযোগ ঠিক হলে আবার চেষ্টা করুন।");
        return false;
      }
      setPill("লাইভ ট্র্যাকিং চালু", "ok");
      return true;
    }).catch(err => {
      console.error("[SSC27 tracking] request failed", eventType, err);
      setPill("লাইভ ট্র্যাকিং সমস্যা", "error");
      return false;
    });
  }
  function determineCorrectness(option, card) {
    const classes = String(option && option.className || "");
    if (/(^|[\s_-])(correct|is-correct|option-correct|right-answer|success)([\s_-]|$)/i.test(classes)) return true;
    if (/(^|[\s_-])(incorrect|is-wrong|option-wrong|wrong-answer|danger)([\s_-]|$)/i.test(classes)) return false;
    const feedback = safeText(card && card.querySelector(".feedback,.answer-feedback,.explanation,.result-message,.answer-status")?.innerText || "", 500);
    if (/(আপনার উত্তর সঠিক|সঠিক উত্তর|উত্তরটি সঠিক|correct answer|correct!|^সঠিক\b)/i.test(feedback)) return true;
    if (/(উত্তর ভুল|ভুল উত্তর|উত্তরটি ভুল|incorrect|wrong answer|^ভুল\b)/i.test(feedback)) return false;
    return null;
  }
  function recordAnswer(option) {
    if (!session || !option) return;
    const card = document.querySelector(".qcard") || findQuestionCard(option) || option.parentElement;
    const title = getQuizTitle(session.currentQuiz);
    const n = questionNumber(card, card);
    const livePrompt = document.querySelector("#questionText");
    const qText = safeText(livePrompt ? (livePrompt.innerText || livePrompt.textContent) : questionLabel(card), 1800);
    const answer = safeText(option.innerText || option.textContent || option.getAttribute("aria-label") || "", 500);
    const liveOptions = Array.from(document.querySelectorAll("#options button.option,.options button.option,button.option"));
    const selectedNow = liveOptions.find(btn => safeText(btn.innerText || btn.textContent, 500) === answer && (btn.classList.contains("correct") || btn.classList.contains("wrong"))) || liveOptions.find(btn => safeText(btn.innerText || btn.textContent, 500) === answer);
    const correct = determineCorrectness(selectedNow || option, document.querySelector("#feedback") || card);
    const key = title + "|" + (n == null ? "unknown-" + qText.slice(0, 70) : String(n)) + "|" + qText.slice(0, 70);
    if (!session.answers) session.answers = {};
    session.answers[key] = { quiz: title, number: n, question: qText, answer, correct, at: new Date().toISOString() };
    saveSession();
    trackEvent("answer_submitted", {
      quizTitle: title, subject: getSubject(), questionNumber: n,
      questionText: qText, selectedAnswer: answer, isCorrect: correct,
      status: "active", totalQuestions: getTotalQuestions()
    });
  }
  function hasQuizOptions() {
    return Array.from(document.querySelectorAll("#options button.option,.options button.option,.option-btn,.answer-option,[data-option],.quiz-option,button.option,input[type='radio']")).some(isVisible);
  }
  function currentQuestionInfo() {
    const cards = questionCards();
    const livePrompt = document.querySelector("#questionText");
    const card = document.querySelector(".qcard") || livePrompt || cards[0] || document.querySelector(".question-card,.quiz-question,.mcq-question");
    return { number: questionNumber(card, card), text: livePrompt ? safeText(livePrompt.innerText || livePrompt.textContent, 1800) : questionLabel(card), card, total: getTotalQuestions() };
  }
  function scanQuizState() {
    if (!session) return;
    const active = hasQuizOptions();
    if (active && !quizScreenActive) {
      quizScreenActive = true;
      session.status = "active";
      const title = getQuizTitle(session.currentQuiz);
      trackEvent("quiz_started", { quizTitle: title, subject: getSubject(), status: "active", totalQuestions: getTotalQuestions() });
    } else if (!active && quizScreenActive) {
      quizScreenActive = false;
      const bodyText = safeText(document.body.innerText || "", 5000);
      const completed = /(ফলাফল দেখুন|আপনার ফলাফল|কুইজ সম্পন্ন|অনুশীলন সম্পন্ন|quiz completed|your score|result summary)/i.test(bodyText);
      trackEvent(completed ? "quiz_completed" : "quiz_closed", {
        quizTitle: getQuizTitle(session.currentQuiz), subject: getSubject(),
        status: "ready", totalQuestions: getTotalQuestions()
      });
      if (!completed) session.status = "ready";
      saveSession();
    }
    if (!active) return;
    const info = currentQuestionInfo();
    const title = getQuizTitle(session.currentQuiz);
    const key = title + "|" + (info.number == null ? "" : info.number) + "|" + safeText(info.text, 120);
    if (info.text && key !== lastQuestionKey) {
      lastQuestionKey = key;
      trackEvent("question_viewed", {
        quizTitle: title, subject: getSubject(), questionNumber: info.number,
        questionText: info.text, status: "active", totalQuestions: info.total
      });
    }
  }
  function scheduleScan(delay) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanQuizState, delay || 150);
  }
  function startMonitoring() {
    if (!session || !session.id) return;
    styleOnce();
    addAdminLink();
    setPill("লাইভ ট্র্যাকিং চালু", "ok");
    trackEvent("heartbeat", { status: "ready" });
    document.addEventListener("click", function (event) {
      const target = event.target && event.target.closest
        ? event.target.closest("button,a,[role='button'],.filter-btn,.category-card,.subject-card,.chapter-card,[data-category],[data-subject]")
        : null;
      if (!target) return;
      const label = safeText(target.innerText || target.textContent || target.getAttribute("aria-label"), 180);
      const option = target.matches("#options button.option,.options button.option,.option-btn,.answer-option,[data-option],.quiz-option,button.option")
        ? target
        : (target.closest("#options button.option,.options button.option,.option-btn,.answer-option,[data-option],.quiz-option,button.option"));
      if (option) {
        window.setTimeout(() => {
          recordAnswer(option);
          scheduleScan(50);
        }, 280);
        return;
      }
      const startLabel = /(শুরু করুন|শুরু করো|কুইজ শুরু|অনুশীলন শুরু|start quiz|start practice|begin quiz)/i.test(label);
      const nextLabel = /(পরবর্তী|পরের প্রশ্ন|next question|next)/i.test(label);
      const finishLabel = /(কুইজ শেষ|পরীক্ষা শেষ|ফলাফল দেখুন|ফলাফল দেখো|জমা দিন|submit quiz|finish quiz|end quiz)/i.test(label);
      const categoryClick = target.matches(".filter-btn,.category-btn,.category-card,.subject-card,.chapter-card,[data-category],[data-subject]") &&
        label && !/সব অধ্যায়|সব বিষয়|all categories|home|save|bookmarks/i.test(label);
      if (categoryClick) {
        window.setTimeout(() => {
          const selected = safeText(target.getAttribute("data-category") || target.getAttribute("data-subject") || label, 180);
          trackEvent("quiz_opened", { quizTitle: getQuizTitle(selected), subject: getSubject() || selected, status: "ready" });
          scheduleScan(80);
        }, 120);
      }
      if (startLabel || nextLabel || finishLabel) {
        window.setTimeout(() => {
          if (finishLabel) trackEvent("quiz_completed", { quizTitle: getQuizTitle(), subject: getSubject(), status: "active", totalQuestions: getTotalQuestions() });
          scheduleScan(30);
        }, 300);
      }
    }, true);
    const observer = new MutationObserver(() => scheduleScan(180));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "aria-pressed"] });
    window.setInterval(() => {
      if (!session) return;
      trackEvent("heartbeat", { status: quizScreenActive ? "active" : (session.status === "left" ? "left" : "ready") });
    }, 25000);
    window.addEventListener("pagehide", function () {
      trackEvent("session_left", { status: "left" });
    });
    scheduleScan(300);
  }
  function init() {
    styleOnce();
    addAdminLink();
    if (session && session.id && session.token) {
      startMonitoring();
    } else {
      showIdentityGate();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();