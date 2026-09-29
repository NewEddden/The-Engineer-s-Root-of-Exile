(function () {
  const params = new URLSearchParams(location.search);

  const view = params.get("view");
  const isAll = view === "all";
  const isFrom = view === "from";
  const isRange = view === "range";

  const elSep = document.getElementById("btn-separate");
  const elAll = document.getElementById("btn-all");
  const elFrom = document.getElementById("btn-from");
  const elRange = document.getElementById("btn-range");

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
    elRange.classList.toggle("solid", isRange);
    elSep.classList.toggle("solid", !isAll && !isFrom && !isRange);

    // Current chapter.
    // Defaults to Chapter 1 if no chapter is specified.
    const currentChapter = params.get("ch") || 1;

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

    // Range mode:
    // Show a range of chapters. Uses ?start and ?end query parameters.
    const start = params.get("start") || currentChapter;
    const end = params.get("end") || currentChapter;
    elRange.href =
      "read.html?view=range&start=" +
      encodeURIComponent(start) +
      "&end=" +
      encodeURIComponent(end);
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

    wireNav(elPrev, prev, "\u2190 Prev");
    wireNav(elNext, next, "Next \u2192");

    wireNav(elPrevBottom, prev, "\u2190 Prev");
    wireNav(elNextBottom, next, "Next \u2192");

    document.title =
      "Ch " + ch.n + ": " + ch.title + " \u2014 The Engineer's Root of Exile";

    setMediaMetadata("Ch " + ch.n + ": " + ch.title);

    elContent.innerHTML = '<div class="loading">Loading chapter\u2026</div>';

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
  // ALL / FROM MODE
  // ---------------------------------------------------------------------------

  async function renderAll(chapters, startIndex = 0, endIndex = undefined) {
    // If startIndex is 0 and endIndex is undefined:
    //   Show every chapter.
    //
    // If startIndex is, for example, 70 and endIndex is undefined:
    //   Show chapters starting from index 70 to the end.
    //   This is what makes "From" work.
    //
    // If startIndex is, for example, 1 and endIndex is 5:
    //   Show chapters from index 1 to index 5 (inclusive).
    //   This is what makes "Range" work.

    const chaptersToRender = chapters.slice(
      startIndex,
      endIndex !== undefined ? endIndex + 1 : undefined
    );

    // No chapter dropdown / prev / next
    // when viewing multiple chapters.
    elBar.style.display = "none";
    elBarBottom.style.display = "none";

    // Determine the title based on the mode.
    if (isRange && chaptersToRender.length > 0) {
      const firstCh = chaptersToRender[0].n;
      const lastCh = chaptersToRender[chaptersToRender.length - 1].n;
      document.title =
        "Chapters " +
        firstCh +
        "-" +
        lastCh +
        " \u2014 The Engineer's Root of Exile";

      setMediaMetadata("Chapters " + firstCh + "-" + lastCh);
    } else if (isFrom && chaptersToRender.length > 0) {
      document.title =
        "Chapters from " +
        chaptersToRender[0].n +
        " \u2014 The Engineer's Root of Exile";

      setMediaMetadata("Chapters from " + chaptersToRender[0].n);
    } else {
      document.title = "All chapters \u2014 The Engineer's Root of Exile";

      setMediaMetadata("The Engineer's Root of Exile");
    }

    elContent.innerHTML =
      '<div class="loading">Loading ' +
      chaptersToRender.length +
      " chapters\u2026</div>";

    try {
      const parts = await Promise.all(
        chaptersToRender.map((c) =>
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

  EROE.load()
    .then(({ chapters }) => {
      if (!chapters.length) {
        showError(new Error("chapters.json is empty."));

        return;
      }

      // ---------------------------------------------------------
      // ALL MODE
      // ---------------------------------------------------------
      if (isAll) {
        renderAll(chapters, 0);
        return;
      }

      // ---------------------------------------------------------
      // FROM MODE
      // ---------------------------------------------------------
      if (isFrom) {
        const currentChapter = parseInt(params.get("ch") || "1", 10);

        const startIndex = chapters.findIndex((c) => c.n === currentChapter);

        // If the chapter exists, start there.
        // If it doesn't, fall back to the first chapter.
        renderAll(chapters, startIndex === -1 ? 0 : startIndex);

        return;
      }

      // ---------------------------------------------------------
      // RANGE MODE
      // ---------------------------------------------------------
      if (isRange) {
        const startChapter = parseInt(params.get("start") || "1", 10);
        const endChapter = parseInt(params.get("end") || "1", 10);

        const startIndex = chapters.findIndex((c) => c.n === startChapter);
        const endIndex = chapters.findIndex((c) => c.n === endChapter);

        // If chapters exist, use those indices.
        // If they don't, fall back to showing just the first chapter.
        const finalStart = startIndex === -1 ? 0 : startIndex;
        const finalEnd = endIndex === -1 ? 0 : endIndex;

        renderAll(chapters, finalStart, finalEnd);

        return;
      }

      // ---------------------------------------------------------
      // SEPARATE MODE
      // ---------------------------------------------------------
      renderSingle(chapters);
    })
    .catch(showError);
})();
