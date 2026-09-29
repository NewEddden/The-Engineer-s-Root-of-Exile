(function () {
  const params = new URLSearchParams(location.search);

  const view = params.get("view");
  const isAll = view === "all";
  const isFrom = view === "from";
  const isRange = view === "range";

  const elSep = document.getElementById("btn-separate");
  const elAll = document.getElementById("btn-all");
  const elFrom = document.getElementById("btn-from");

  const elBar = document.getElementById("reader-bar");
  const elPrev = document.getElementById("btn-prev");
  const elNext = document.getElementById("btn-next");
  const elSelect = document.getElementById("chapter-select");
  const elContent = document.getElementById("reader-content");

  const elBarBottom = document.getElementById("reader-bar-bottom");
  const elPrevBottom = document.getElementById("btn-prev-bottom");
  const elNextBottom = document.getElementById("btn-next-bottom");
  const elSelectBottom = document.getElementById("chapter-select-bottom");

  // Sets the system Now Playing metadata
  // (Lock Screen, Control Center, CarPlay).
  // Only has an effect where the page owns the audio session;
  // harmless otherwise.
  function setMediaMetadata(titleText) {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleText,
      artist: "E. Cenatus",
      album: "The Engineer's Root of Exile",
      artwork: [
        {
          src: "assets/images/novel-cover-512.png",
          sizes: "512x512",
          type: "image/jpeg",
        },
        {
          src: "assets/images/novel-cover-1024.png",
          sizes: "1024x1024",
          type: "image/jpeg",
        },
      ],
    });
  }

  async function extractContent(url) {
    const res = await fetch(url, { cache: "no-cache" });

    if (!res.ok) {
      throw new Error(res.status + " fetching " + url);
    }

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
  // VIEW TOGGLE
  // ---------------------------------------------------------------------------

  function setToggle() {
    elAll.classList.toggle("solid", isAll);
    elFrom.classList.toggle("solid", isFrom);
    elSep.classList.toggle("solid", !isAll && !isFrom && !isRange);

    // Current chapter.
    // In range mode there is no ?ch, so use the start of the range.
    // Defaults to Chapter 1 if nothing is specified.
    const currentChapter = params.get("ch") || params.get("start") || 1;

    // Separate mode:
    // Return to the chapter currently being viewed.
    elSep.href = "read.html?ch=" + encodeURIComponent(currentChapter);

    // All mode:
    // Show every chapter.
    elAll.href = "read.html?view=all";

    // From mode:
    // Show every chapter starting with the current chapter.
    elFrom.href =
      "read.html?view=from&ch=" + encodeURIComponent(currentChapter);
  }

  // ---------------------------------------------------------------------------
  // RANGE PICKER
  // ---------------------------------------------------------------------------
  // Built here in JS so read.html needs no changes.
  // It copies the look of the "Read Starting From" button,
  // so it follows your existing CSS.
  //
  // URL format: read.html?view=range&start=2&end=20

  function buildRangePicker() {
    if (!elFrom) return null;

    const cs = getComputedStyle(elFrom);
    const accent = cs.color;
    const border = cs.borderTopColor || accent;

    const wrap = document.createElement("div");
    wrap.id = "range-picker";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Read a range of chapters");
    wrap.style.cssText =
      "display:flex;flex-wrap:wrap;align-items:center;justify-content:center;" +
      "gap:10px;flex-basis:100%;width:100%;margin:8px 0;" +
      "font-family:" + cs.fontFamily + ";" +
      "letter-spacing:" + cs.letterSpacing + ";" +
      "color:" + accent + ";";

    function numInput(label) {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.inputMode = "numeric";
      inp.min = "1";
      inp.setAttribute("aria-label", label);
      // font-size 16px stops iPhone Safari from zooming in on focus.
      inp.style.cssText =
        "width:4.5em;padding:12px 6px;text-align:center;" +
        "background:transparent;color:inherit;font-family:inherit;font-size:16px;" +
        "border:1px solid " + border + ";border-radius:" + cs.borderTopLeftRadius + ";";
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          go();
        }
      });
      return inp;
    }

    const from = numInput("First chapter");
    const to = numInput("Last chapter");

    const label = document.createElement("span");
    label.textContent = "to";

    // Same element type and classes as the From button, so it matches.
    const btn = document.createElement(elFrom.tagName);
    btn.className = elFrom.className;
    btn.classList.remove("solid");
    btn.classList.toggle("solid", isRange);
    btn.textContent = "Read Range";
    btn.setAttribute("role", "button");
    if (btn.tagName === "A") btn.href = "#";
    btn.style.margin = "0";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      go();
    });

    function go() {
      let a = parseInt(from.value, 10);
      let b = parseInt(to.value, 10);

      if (isNaN(a) && isNaN(b)) {
        from.focus();
        return;
      }
      if (isNaN(a)) a = b;
      if (isNaN(b)) b = a;
      if (a > b) [a, b] = [b, a];

      location.href = "read.html?view=range&start=" + a + "&end=" + b;
    }

    wrap.append(from, label, to, btn);
    elFrom.insertAdjacentElement("afterend", wrap);

    // Prefill from the URL so the current range (or chapter) shows.
    const start = params.get("start") || params.get("ch") || "";
    const end = params.get("end") || "";
    from.value = start;
    to.value = end;

    return { from, to };
  }

  // ---------------------------------------------------------------------------
  // CHAPTER DROPDOWN
  // ---------------------------------------------------------------------------

  // Build one chapter dropdown.
  // Called for both the top and bottom reader bars.
  function fillSelect(sel, chapters, ch) {
    sel.innerHTML = "";

    chapters.forEach((c) => {
      const opt = document.createElement("option");

      opt.value = c.n;
      opt.textContent = "Chapter " + c.n + ": " + c.title;

      if (c.n === ch.n) {
        opt.selected = true;
      }

      sel.appendChild(opt);
    });

    sel.onchange = () => {
      location.href = "read.html?ch=" + sel.value;
    };
  }

  // ---------------------------------------------------------------------------
  // SEPARATE MODE
  // ---------------------------------------------------------------------------

  async function renderSingle(chapters) {
    let n = parseInt(params.get("ch") || "", 10);

    let idx = chapters.findIndex((c) => c.n === n);

    if (idx === -1) {
      idx = 0;
    }

    const ch = chapters[idx];

    // Dropdowns (top + bottom)
    fillSelect(elSelect, chapters, ch);
    fillSelect(elSelectBottom, chapters, ch);

    // Previous / next by position,
    // so gaps in numbering don't break navigation.
    const prev = chapters[idx - 1];
    const next = chapters[idx + 1];

    wireNav(elPrev, prev, "← Prev");
    wireNav(elNext, next, "Next →");

    wireNav(elPrevBottom, prev, "← Prev");
    wireNav(elNextBottom, next, "Next →");

    document.title =
      "Ch " + ch.n + ": " + ch.title + " — The Engineer's Root of Exile";

    setMediaMetadata("Ch " + ch.n + ": " + ch.title);

    elContent.innerHTML = '<div class="loading">Loading chapter…</div>';

    try {
      const body = await extractContent(EROE.fileHref(ch.slug));

      elContent.innerHTML = body;

      window.scrollTo({
        top: 0,
      });
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------------------------
  // PREVIOUS / NEXT NAVIGATION
  // ---------------------------------------------------------------------------

  function wireNav(btn, target, label) {
    btn.textContent = label;

    if (target) {
      btn.removeAttribute("aria-disabled");

      btn.onclick = () => {
        location.href = "read.html?ch=" + target.n;
      };
    } else {
      btn.setAttribute("aria-disabled", "true");
      btn.onclick = null;
    }
  }

  // ---------------------------------------------------------------------------
  // ALL / FROM / RANGE MODE
  // ---------------------------------------------------------------------------

  // Renders a list of chapters one after another.
  // All, From and Range just pass in a different list.
  async function renderMany(list, title, mediaTitle) {
    // No chapter dropdown / prev / next
    // when viewing multiple chapters.
    elBar.style.display = "none";
    elBarBottom.style.display = "none";

    document.title = title + " — The Engineer's Root of Exile";
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
      "…</div>";

    try {
      const parts = await Promise.all(
        list.map((c) =>
          extractContent(EROE.fileHref(c.slug))
            .then((body) => ({
              c,
              body,
            }))
            .catch(() => ({
              c,
              body: '<p class="error">Could not load this chapter.</p>',
            })),
        ),
      );

      elContent.innerHTML = parts
        .map(
          ({ c, body }, i) =>
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

  // ---------------------------------------------------------------------------
  // ERROR HANDLING
  // ---------------------------------------------------------------------------

  function showError(e) {
    elContent.innerHTML =
      '<div class="error">Could not load chapter text.<br>' +
      (e && e.message ? e.message : "") +
      "<br><br>If you opened this page directly from your files, use a local server " +
      "(fetch is blocked on the file:// protocol).</div>";
  }

  // ---------------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------------

  setToggle();
  const picker = buildRangePicker();

  EROE.load()
    .then(({ chapters }) => {
      if (!chapters.length) {
        showError(new Error("chapters.json is empty."));

        return;
      }

      const first = chapters[0].n;
      const last = chapters[chapters.length - 1].n;

      // Limit the picker to real chapter numbers,
      // and default the end box to the latest chapter.
      if (picker) {
        picker.from.min = picker.to.min = first;
        picker.from.max = picker.to.max = last;
        if (!picker.from.value) picker.from.value = first;
        if (!picker.to.value) picker.to.value = last;
      }

      // ---------------------------------------------------------
      // ALL MODE
      // ---------------------------------------------------------
      if (isAll) {
        renderMany(chapters, "All chapters", "The Engineer's Root of Exile");
        return;
      }

      // ---------------------------------------------------------
      // FROM MODE
      // ---------------------------------------------------------
      if (isFrom) {
        const currentChapter = parseInt(params.get("ch") || "1", 10);

        let startIndex = chapters.findIndex((c) => c.n === currentChapter);

        // If the chapter exists, start there.
        // If it doesn't, fall back to the first chapter.
        if (startIndex === -1) startIndex = 0;

        const list = chapters.slice(startIndex);

        renderMany(list, "Chapters from " + list[0].n);

        return;
      }

      // ---------------------------------------------------------
      // RANGE MODE
      // ---------------------------------------------------------
      if (isRange) {
        let a = parseInt(params.get("start"), 10);
        let b = parseInt(params.get("end"), 10);

        if (isNaN(a)) a = first;
        if (isNaN(b)) b = a;
        if (a > b) [a, b] = [b, a];

        // Filter by chapter number, not position,
        // so gaps in numbering (e.g. no Chapter 7) don't break it.
        const list = chapters.filter((c) => c.n >= a && c.n <= b);

        let title;
        if (list.length === 1) {
          title = "Chapter " + list[0].n;
        } else if (list.length) {
          title = "Chapters " + list[0].n + "-" + list[list.length - 1].n;
        } else {
          title = "Chapters " + a + "-" + b;
        }

        renderMany(list, title);

        return;
      }

      // ---------------------------------------------------------
      // SEPARATE MODE
      // ---------------------------------------------------------
      renderSingle(chapters);
    })
    .catch(showError);
})();
