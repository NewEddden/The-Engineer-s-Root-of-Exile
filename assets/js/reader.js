/* reader.js - the reader shell (read.html).

   URL format
     read.html?ch=12                       one chapter
     read.html?view=all                    every chapter
     read.html?view=from&ch=12             chapter 12 to the end
     read.html?view=range&start=2&end=20   chapters 2 to 20
     &mode=listen                          open the Listen tab (single chapter only)

   Listen tab
     The player UI is wired up, but no narration engine ships with it.
     Plug one in later with EROE.registerTTS(engine). See the TTS ADAPTER
     section near the bottom for the shape an engine needs. */

(function () {
  const params = new URLSearchParams(location.search);

  const view = params.get("view");
  const isAll = view === "all";
  const isFrom = view === "from";
  const isRange = view === "range";
  const isMany = isAll || isFrom || isRange;

  const $ = (id) => document.getElementById(id);

  // View options
  const elSep = $("btn-separate");
  const elAll = $("btn-all");
  const elFrom = $("btn-from");
  const elRange = $("btn-range");
  const fromPicker = $("from-picker");
  const rangePicker = $("range-picker");
  const selFromStart = $("from-start");
  const selRangeStart = $("range-start");
  const selRangeEnd = $("range-end");

  // Tabs
  const tabRead = $("tab-read");
  const tabListen = $("tab-listen");
  const paneRead = $("pane-read");
  const paneListen = $("pane-listen");

  // Navigation bars
  const elBar = $("reader-bar");
  const elPrev = $("btn-prev");
  const elNext = $("btn-next");
  const elSelect = $("chapter-select");
  const elBarBottom = $("reader-bar-bottom");
  const elPrevBottom = $("btn-prev-bottom");
  const elNextBottom = $("btn-next-bottom");
  const elSelectBottom = $("chapter-select-bottom");

  const elContent = $("reader-content");

  const SITE = "The Engineer's Root of Exile";

  // ---------------------------------------------------------------------------
  // SMALL HELPERS
  // ---------------------------------------------------------------------------

  // Browser storage can throw (private mode, blocked cookies). Never let it
  // break the page.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* ignore */
      }
    },
  };

  // Tab choice: URL wins, then whatever the reader used last.
  let mode =
    params.get("mode") === "listen" || params.get("mode") === "read"
      ? params.get("mode")
      : store.get("eroe.mode", "read");
  if (isMany) mode = "read"; // listening is one chapter at a time

  function singleHref(n, extra) {
    let href = "read.html?ch=" + encodeURIComponent(n);
    if (mode === "listen") href += "&mode=listen";
    if (extra) href += extra;
    return href;
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s;
  }

  // Lock Screen / Control Center / CarPlay metadata.
  // Only has an effect where the page owns the audio session.
  function setMediaMetadata(titleText) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined")
      return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleText,
      artist: "E. Cenatus",
      album: SITE,
      artwork: [
        {
          src: "assets/images/novel-cover-512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "assets/images/novel-cover-1024.png",
          sizes: "1024x1024",
          type: "image/png",
        },
      ],
    });
  }

  async function extractContent(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " fetching " + url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node =
      doc.querySelector("#chapter-content") ||
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.body;
    return node ? node.innerHTML : html;
  }

  // ---------------------------------------------------------------------------
  // READ / LISTEN TABS
  // ---------------------------------------------------------------------------

  function applyMode() {
    const listen = mode === "listen";
    tabRead.setAttribute("aria-selected", String(!listen));
    tabListen.setAttribute("aria-selected", String(listen));
    paneRead.hidden = listen;
    paneListen.hidden = !listen;
    document.body.classList.toggle("is-listening", listen);
  }

  function switchMode(next) {
    if (next === mode) return;

    // Listening needs a single chapter. From a multi-chapter view,
    // jump to the first chapter of what was on screen.
    if (next === "listen" && isMany) {
      store.set("eroe.mode", "listen");
      const first = params.get("ch") || params.get("start") || 1;
      location.href =
        "read.html?ch=" + encodeURIComponent(first) + "&mode=listen";
      return;
    }

    mode = next;
    store.set("eroe.mode", mode);
    applyMode();

    // Keep the URL shareable without reloading.
    const p = new URLSearchParams(location.search);
    if (mode === "listen") p.set("mode", "listen");
    else p.delete("mode");
    history.replaceState(null, "", "read.html?" + p.toString());

    if (mode !== "listen") Player.pause();
    if (currentChapter) wireSingleNav(); // links carry the mode
  }

  tabRead.addEventListener("click", () => switchMode("read"));
  tabListen.addEventListener("click", () => switchMode("listen"));

  // Left/right arrows move between the two tabs.
  [tabRead, tabListen].forEach((tab) =>
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const other = tab === tabRead ? tabListen : tabRead;
      other.focus();
      other.click();
    }),
  );

  // ---------------------------------------------------------------------------
  // VIEW OPTIONS (the four cards)
  // ---------------------------------------------------------------------------

  // Which card is checked. From/Range cards can be picked without leaving
  // the page, so this can differ from the view actually on screen.
  let picked = isAll ? "all" : isFrom ? "from" : isRange ? "range" : "separate";

  function applyPicked() {
    const map = { separate: elSep, all: elAll, from: elFrom, range: elRange };
    Object.entries(map).forEach(([key, el]) => {
      const on = key === picked;
      el.setAttribute("aria-checked", String(on));
      el.classList.toggle("is-active", on);
    });
    fromPicker.hidden = picked !== "from";
    rangePicker.hidden = picked !== "range";
  }

  const currentFromUrl = params.get("ch") || params.get("start") || 1;
  elSep.href = "read.html?ch=" + encodeURIComponent(currentFromUrl);
  elAll.href = "read.html?view=all";

  elFrom.addEventListener("click", () => {
    picked = "from";
    applyPicked();
    selFromStart.focus({ preventScroll: true });
  });
  elRange.addEventListener("click", () => {
    picked = "range";
    applyPicked();
    selRangeStart.focus({ preventScroll: true });
  });

  fromPicker.addEventListener("submit", (e) => {
    e.preventDefault();
    location.href =
      "read.html?view=from&ch=" + encodeURIComponent(selFromStart.value);
  });

  rangePicker.addEventListener("submit", (e) => {
    e.preventDefault();
    let a = parseInt(selRangeStart.value, 10);
    let b = parseInt(selRangeEnd.value, 10);
    if (a > b) [a, b] = [b, a];
    location.href = "read.html?view=range&start=" + a + "&end=" + b;
  });

  // Fill the picker dropdowns once chapters load.
  function fillPickers(chapters) {
    const opts = (sel) => {
      sel.innerHTML = "";
      chapters.forEach((c) => {
        const o = document.createElement("option");
        o.value = c.n;
        o.textContent = c.n;
        o.title = "Chapter " + c.n + ": " + c.title;
        sel.appendChild(o);
      });
    };
    [selFromStart, selRangeStart, selRangeEnd].forEach(opts);

    const first = chapters[0].n;
    const last = chapters[chapters.length - 1].n;
    const byN = new Map(chapters.map((c) => [c.n, c]));
    const pick = (v, fallback) =>
      byN.has(parseInt(v, 10)) ? parseInt(v, 10) : fallback;

    selFromStart.value = pick(params.get("ch") || params.get("start"), first);
    selRangeStart.value = pick(params.get("start") || params.get("ch"), first);
    selRangeEnd.value = pick(params.get("end"), last);

    // A line under each picker naming what will load.
    const titleOf = (n) => (byN.get(n) ? byN.get(n).title : "");
    function updateHints() {
      const s = parseInt(selFromStart.value, 10);
      const count = chapters.filter((c) => c.n >= s).length;
      $("from-hint").textContent =
        titleOf(s) +
        " · " +
        count +
        (count === 1 ? " chapter" : " chapters") +
        " to the end";

      let a = parseInt(selRangeStart.value, 10);
      let b = parseInt(selRangeEnd.value, 10);
      if (a > b) [a, b] = [b, a];
      const n = chapters.filter((c) => c.n >= a && c.n <= b).length;
      $("range-hint").textContent =
        titleOf(a) +
        " to " +
        titleOf(b) +
        " · " +
        n +
        (n === 1 ? " chapter" : " chapters");
    }
    [selFromStart, selRangeStart, selRangeEnd].forEach((s) =>
      s.addEventListener("change", updateHints),
    );
    updateHints();
  }

  // ---------------------------------------------------------------------------
  // CHAPTER DROPDOWN + PREV / NEXT
  // ---------------------------------------------------------------------------

  let allChapters = [];
  let currentChapter = null;
  let currentIndex = -1;

  function fillSelect(sel, chapters, ch) {
    sel.innerHTML = "";
    chapters.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.n;
      opt.textContent = "Chapter " + c.n + ": " + c.title;
      if (c.n === ch.n) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      location.href = singleHref(sel.value);
    };
  }

  function wireNav(btn, target) {
    if (target) {
      btn.removeAttribute("aria-disabled");
      btn.disabled = false;
      btn.title = "Chapter " + target.n + ": " + target.title;
      btn.onclick = () => {
        location.href = singleHref(target.n);
      };
    } else {
      btn.setAttribute("aria-disabled", "true");
      btn.disabled = true;
      btn.removeAttribute("title");
      btn.onclick = null;
    }
  }

  function wireSingleNav() {
    const prev = allChapters[currentIndex - 1];
    const next = allChapters[currentIndex + 1];
    [elPrev, elPrevBottom].forEach((b) => wireNav(b, prev));
    [elNext, elNextBottom].forEach((b) => wireNav(b, next));
    Player.setNeighbours(prev, next);
  }

  // ---------------------------------------------------------------------------
  // SEPARATE MODE
  // ---------------------------------------------------------------------------

  async function renderSingle(chapters) {
    const n = parseInt(params.get("ch") || "", 10);
    let idx = chapters.findIndex((c) => c.n === n);
    if (idx === -1) idx = 0;

    currentIndex = idx;
    currentChapter = chapters[idx];
    const ch = currentChapter;

    fillSelect(elSelect, chapters, ch);
    fillSelect(elSelectBottom, chapters, ch);
    wireSingleNav();

    document.title = "Ch " + ch.n + ": " + ch.title + " - " + SITE;
    setMediaMetadata("Ch " + ch.n + ": " + ch.title);
    Player.setChapter(ch);

    elContent.innerHTML = '<div class="loading">Loading chapter&hellip;</div>';

    try {
      elContent.innerHTML = await extractContent(EROE.fileHref(ch.slug));
      window.scrollTo({ top: 0 });
      Player.contentReady(elContent);
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------------------------
  // ALL / FROM / RANGE MODE
  // ---------------------------------------------------------------------------

  async function renderMany(list, title, mediaTitle) {
    // No chapter dropdown / prev / next when viewing several chapters.
    elBar.hidden = true;
    elBarBottom.hidden = true;

    document.title = title + " - " + SITE;
    setMediaMetadata(mediaTitle || title);

    if (!list.length) {
      elContent.innerHTML =
        '<div class="error">No chapters in that range.</div>';
      return;
    }

    elContent.innerHTML =
      '<div class="loading">Loading ' +
      list.length +
      (list.length === 1 ? " chapter" : " chapters") +
      "&hellip;</div>";

    try {
      const parts = await Promise.all(
        list.map((c) =>
          extractContent(EROE.fileHref(c.slug))
            .then((body) => ({ c, body }))
            .catch(() => ({
              c,
              body: '<p class="error">Could not load chapter ' + c.n + ".</p>",
            })),
        ),
      );

      elContent.innerHTML = parts
        .map(
          ({ body }, i) =>
            (i > 0 ? '<hr class="all-sep">' : "") +
            "<section>" +
            body +
            "</section>",
        )
        .join("");
    } catch (e) {
      showError(e);
    }
  }

  function showError(e) {
    elContent.innerHTML =
      '<div class="error">Could not load chapter text.<br>' +
      (e && e.message ? e.message : "") +
      "<br><br>If you opened this page directly from your files, use a local server " +
      "(fetch is blocked on the file:// protocol).</div>";
  }

  // ---------------------------------------------------------------------------
  // LISTEN PLAYER
  // ---------------------------------------------------------------------------
  // All the buttons work as UI. Audio needs an engine (see TTS ADAPTER).

  const Player = (function () {
    const elTitle = $("player-title");
    const elStatus = $("player-status");
    const elStatusText = $("player-status-text");
    const elVoiceName = $("player-voice-name");
    const elNote = $("player-note");
    const btnPlay = $("pl-play");
    const btnPrev = $("pl-prev");
    const btnNext = $("pl-next");
    const selSpeed = $("pl-speed");
    const selVoice = $("pl-voice");
    const inVolume = $("pl-volume");
    const inSeek = $("pl-seek");
    const elTime = $("pl-time");
    const elDuration = $("pl-duration");

    const prefs = Object.assign(
      { rate: 1, volume: 80, voice: "" },
      store.get("eroe.listen", {}),
    );

    let engine = null;
    let chapter = null;
    let contentEl = null;
    let prev = null;
    let next = null;
    let state = "idle"; // idle | loading | playing | paused | ended
    let duration = NaN;
    let loadedFor = null;
    let seeking = false;

    function savePrefs() {
      store.set("eroe.listen", prefs);
    }

    // Slider fill (gold up to the thumb).
    function paintSlider(input) {
      const min = +input.min || 0;
      const max = +input.max || 100;
      const pct = ((+input.value - min) / (max - min)) * 100;
      input.style.setProperty("--pct", pct + "%");
    }

    function note(text) {
      elNote.textContent = text || "";
      elNote.hidden = !text;
    }

    function setStatus(s) {
      state = s;
      const labels = {
        unavailable: "Coming soon",
        idle: "Ready",
        loading: "Loading",
        playing: "Playing",
        paused: "Paused",
        ended: "Finished",
      };
      const shown = engine ? s : "unavailable";
      elStatus.dataset.state = shown;
      elStatusText.textContent = labels[shown] || "";
      const playing = engine && s === "playing";
      btnPlay.classList.toggle("is-playing", !!playing);
      btnPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
      if ("mediaSession" in navigator && engine) {
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      }
    }

    function setTime(t) {
      elTime.textContent = fmtTime(t);
      if (!seeking && isFinite(duration) && duration > 0) {
        inSeek.value = Math.round((t / duration) * 1000);
        paintSlider(inSeek);
      }
    }

    function setDuration(d) {
      duration = d;
      elDuration.textContent = fmtTime(d);
      inSeek.disabled = !(engine && isFinite(d) && d > 0);
    }

    function fillVoices(list) {
      selVoice.innerHTML = "";
      if (!list || !list.length) {
        selVoice.innerHTML = '<option value="">Default</option>';
        selVoice.disabled = true;
        elVoiceName.textContent = "Default";
        return;
      }
      list.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = v.name;
        selVoice.appendChild(o);
      });
      selVoice.disabled = false;
      if (list.some((v) => v.id === prefs.voice)) selVoice.value = prefs.voice;
      prefs.voice = selVoice.value;
      elVoiceName.textContent =
        selVoice.options[selVoice.selectedIndex].textContent;
    }

    async function ensureLoaded() {
      if (!engine || !chapter || !contentEl) return false;
      if (loadedFor === chapter.n) return true;
      setStatus("loading");
      try {
        const info =
          (await engine.load({
            chapter,
            text: contentEl.innerText,
            element: contentEl,
            rate: prefs.rate,
            volume: prefs.volume / 100,
            voice: prefs.voice,
            onTime: (t, d) => {
              if (d != null && d !== duration) setDuration(d);
              setTime(t);
            },
            onState: (s) => setStatus(s),
            onEnded: () => {
              setStatus("ended");
              if (next) location.href = singleHref(next.n, "&autoplay=1");
            },
          })) || {};
        loadedFor = chapter.n;
        setDuration(info.duration);
        setTime(0);
        setStatus("paused");
        return true;
      } catch (e) {
        setStatus("idle");
        note("Could not prepare audio: " + (e && e.message ? e.message : e));
        return false;
      }
    }

    async function togglePlay() {
      if (!engine) {
        note("Audio narration isn't available yet. The chapter text is below.");
        return;
      }
      note("");
      if (state === "playing") {
        engine.pause();
        setStatus("paused");
        return;
      }
      if (await ensureLoaded()) {
        engine.play();
        setStatus("playing");
      }
    }

    function pause() {
      if (engine && state === "playing") {
        engine.pause();
        setStatus("paused");
      }
    }

    function wireMediaSession() {
      if (!("mediaSession" in navigator) || !engine) return;
      const ms = navigator.mediaSession;
      const safe = (action, fn) => {
        try {
          ms.setActionHandler(action, fn);
        } catch (e) {
          /* unsupported action */
        }
      };
      safe("play", togglePlay);
      safe("pause", pause);
      safe(
        "previoustrack",
        prev ? () => (location.href = singleHref(prev.n)) : null,
      );
      safe(
        "nexttrack",
        next ? () => (location.href = singleHref(next.n)) : null,
      );
    }

    // ---- control wiring ----
    btnPlay.addEventListener("click", togglePlay);
    btnPrev.addEventListener("click", () => {
      if (prev) location.href = singleHref(prev.n);
    });
    btnNext.addEventListener("click", () => {
      if (next) location.href = singleHref(next.n);
    });

    selSpeed.value = String(prefs.rate);
    if (!selSpeed.value) selSpeed.value = "1";
    selSpeed.addEventListener("change", () => {
      prefs.rate = parseFloat(selSpeed.value);
      savePrefs();
      if (engine && engine.setRate) engine.setRate(prefs.rate);
    });

    selVoice.addEventListener("change", () => {
      prefs.voice = selVoice.value;
      elVoiceName.textContent =
        selVoice.options[selVoice.selectedIndex].textContent;
      savePrefs();
      if (engine && engine.setVoice) engine.setVoice(prefs.voice);
    });

    inVolume.value = prefs.volume;
    paintSlider(inVolume);
    inVolume.addEventListener("input", () => {
      prefs.volume = +inVolume.value;
      paintSlider(inVolume);
      savePrefs();
      if (engine && engine.setVolume) engine.setVolume(prefs.volume / 100);
    });

    paintSlider(inSeek);
    inSeek.addEventListener("input", () => {
      seeking = true;
      paintSlider(inSeek);
      if (isFinite(duration))
        elTime.textContent = fmtTime((inSeek.value / 1000) * duration);
    });
    inSeek.addEventListener("change", () => {
      seeking = false;
      if (engine && engine.seek && isFinite(duration)) {
        engine.seek((inSeek.value / 1000) * duration);
      }
    });

    setStatus("idle");

    return {
      setChapter(ch) {
        chapter = ch;
        elTitle.textContent = "Chapter " + ch.n + ": " + ch.title;
        loadedFor = null;
        setDuration(NaN);
        setTime(0);
        // chapters.json minutes is reading time, not listening time,
        // so it is not shown as a duration.
      },
      setNeighbours(p, n) {
        prev = p;
        next = n;
        btnPrev.disabled = !p;
        btnNext.disabled = !n;
        btnPrev.title = p ? "Chapter " + p.n + ": " + p.title : "";
        btnNext.title = n ? "Chapter " + n.n + ": " + n.title : "";
        wireMediaSession();
      },
      contentReady(el) {
        contentEl = el;
        if (engine && mode === "listen" && params.get("autoplay") === "1")
          togglePlay();
      },
      register(e) {
        engine = e;
        loadedFor = null;
        note("");
        Promise.resolve(e.voices ? e.voices() : [])
          .then(fillVoices)
          .catch(() => fillVoices([]));
        setStatus("idle");
        wireMediaSession();
        if (contentEl && mode === "listen" && params.get("autoplay") === "1")
          togglePlay();
      },
      pause,
    };
  })();

  // ---------------------------------------------------------------------------
  // TTS ADAPTER (left open on purpose)
  // ---------------------------------------------------------------------------
  // To add narration later, load a script after reader.js that calls:
  //
  //   EROE.registerTTS({
  //     voices()            -> [{ id, name }] or a Promise of that (optional)
  //     load(opts)          -> Promise<{ duration }>   duration in seconds, or NaN
  //        opts = { chapter, text, element, rate, volume, voice,
  //                 onTime(seconds, duration?), onState("playing"|"paused"|"loading"),
  //                 onEnded() }
  //     play(), pause()
  //     seek(seconds)       (optional)
  //     setRate(r)          (optional)
  //     setVolume(0..1)     (optional)
  //     setVoice(id)        (optional)
  //   });
  //
  // `element` is the chapter article, so an engine can wrap words in
  // <span class="tts-word is-current"> for read-along highlighting.
  // A script that loads BEFORE reader.js can set window.EROE_TTS instead.

  EROE.registerTTS = (engine) => Player.register(engine);
  if (window.EROE_TTS) Player.register(window.EROE_TTS);

  // ---------------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------------

  applyMode();
  applyPicked();

  EROE.load()
    .then(({ chapters }) => {
      if (!chapters.length) {
        showError(new Error("chapters.json is empty."));
        return;
      }
      allChapters = chapters;
      fillPickers(chapters);

      const first = chapters[0].n;

      if (isAll) {
        renderMany(chapters, "All chapters", SITE);
        return;
      }

      if (isFrom) {
        const start = parseInt(params.get("ch") || "1", 10);
        let i = chapters.findIndex((c) => c.n === start);
        if (i === -1) i = 0;
        const list = chapters.slice(i);
        renderMany(list, "Chapters from " + list[0].n);
        return;
      }

      if (isRange) {
        let a = parseInt(params.get("start"), 10);
        let b = parseInt(params.get("end"), 10);
        if (isNaN(a)) a = first;
        if (isNaN(b)) b = a;
        if (a > b) [a, b] = [b, a];
        // Filter by number, not position, so gaps in numbering don't break it.
        const list = chapters.filter((c) => c.n >= a && c.n <= b);
        const title =
          list.length === 1
            ? "Chapter " + list[0].n
            : list.length
              ? "Chapters " + list[0].n + "-" + list[list.length - 1].n
              : "Chapters " + a + "-" + b;
        renderMany(list, title);
        return;
      }

      renderSingle(chapters);
    })
    .catch(showError);
})();
