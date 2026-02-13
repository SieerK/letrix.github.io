(() => {
  const WORD_LEN = 5;
  const BOARD_COUNT = 4;

  const WORDLIST_URL =
    "https://raw.githubusercontent.com/SieerK/termo/main/palavras-5.txt";

  // ===== DOM =====
  const grids = Array.from(document.querySelectorAll(".game main .grid"));
  const keys = Array.from(document.querySelectorAll(".key"));
  const restartBtn = document.querySelector(".btn-restart");

  if (grids.length < BOARD_COUNT) {
    console.error(
      `QuadLetrix: preciso de ${BOARD_COUNT} grids (4 <main> dentro de .game). Encontrei:`,
      grids.length
    );
    return;
  }

  const boards = grids.slice(0, BOARD_COUNT).map((gridEl, i) => ({
    gridEl,
    blocks: Array.from(gridEl.querySelectorAll(".block")),
    secret: null,
    solved: false,
    id: i,
  }));

  // linhas = total de blocos / 5 (ex.: 35/5 = 7)
  const ROWS = Math.floor(boards[0].blocks.length / WORD_LEN);
  const MAX_ATTEMPTS = ROWS;

  // checagem: todos os boards devem ter mesmo tamanho
  for (let i = 1; i < BOARD_COUNT; i++) {
    const r = Math.floor(boards[i].blocks.length / WORD_LEN);
    if (r !== ROWS) {
      console.warn(
        `QuadLetrix: o board ${i} tem número de linhas diferente. (${r} vs ${ROWS})`
      );
    }
  }

  let attempt = 0;
  let cursor = 0;
  let gameOver = false;
  let isRevealing = false;

  // buffer único da tentativa
  let currentGuess = Array(WORD_LEN).fill("");

  let words = [];
  let dict = null;

  // estado das teclas (não rebaixar cor)
  const keyState = new Map();
  const prio = { absent: 1, present: 2, correct: 3 };

  function normalize(s) {
    return s.toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  }

  function idx(r, c) {
    return r * WORD_LEN + c;
  }

  function blockAt(bi, r, c) {
    return boards[bi]?.blocks[idx(r, c)];
  }

  function setBlock(bi, r, c, letter) {
    const b = blockAt(bi, r, c);
    if (!b) return;
    b.textContent = letter;
    b.dataset.letter = letter;
  }

  function clearBlock(bi, r, c) {
    const b = blockAt(bi, r, c);
    if (!b) return;
    b.textContent = "";
    b.dataset.letter = "";
  }

  function shakeRow(r) {
    for (let bi = 0; bi < BOARD_COUNT; bi++) {
      if (boards[bi].solved) continue;
      for (let c = 0; c < WORD_LEN; c++) {
        const b = blockAt(bi, r, c);
        if (!b) continue;
        b.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-6px)" },
            { transform: "translateX(6px)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 220, iterations: 1 }
        );
      }
    }
  }

  // ===== UI: linha ativa + cursor (trava board resolvido) =====
  function updateActiveStyles() {
    for (let bi = 0; bi < BOARD_COUNT; bi++) {
      const solved = boards[bi].solved;

      boards[bi].blocks.forEach((b, i) => {
        const r = Math.floor(i / WORD_LEN);
        const c = i % WORD_LEN;

        b.classList.remove("active-row", "locked", "cursor");

        const hasResult =
          b.classList.contains("correct") ||
          b.classList.contains("present") ||
          b.classList.contains("absent");

        if (solved) {
          b.classList.add("locked");
          return;
        }

        if (r !== attempt) {
          b.classList.add("locked");
          return;
        }

        if (!gameOver && !hasResult) b.classList.add("active-row");
        if (!gameOver && c === cursor) b.classList.add("cursor");
      });
    }
  }

  // ===== Clique nos blocos para mover cursor =====
  for (let bi = 0; bi < BOARD_COUNT; bi++) {
    boards[bi].blocks.forEach((blockEl, i) => {
      blockEl.addEventListener("click", () => {
        if (gameOver || isRevealing) return;
        if (boards[bi].solved) return;

        const r = Math.floor(i / WORD_LEN);
        const c = i % WORD_LEN;
        if (r !== attempt) return;

        cursor = c;
        updateActiveStyles();
      });
    });
  }

  // ===== Teclas =====
  function paintKey(letter, state) {
    const L = normalize(letter);
    const current = keyState.get(L);
    if (current && prio[current] >= prio[state]) return;

    keyState.set(L, state);
    keys.forEach((btn) => {
      const t = normalize(btn.textContent.trim());
      if (t === L) {
        btn.classList.remove("absent", "present", "correct");
        btn.classList.add(state);
      }
    });
  }

  // ===== Avaliação =====
  function evaluate(guess, secretWord) {
    const res = Array(WORD_LEN).fill("absent");
    const s = secretWord.split("");
    const g = guess.split("");

    // corretos
    for (let i = 0; i < WORD_LEN; i++) {
      if (g[i] === s[i]) {
        res[i] = "correct";
        s[i] = null;
        g[i] = null;
      }
    }

    // presentes
    for (let i = 0; i < WORD_LEN; i++) {
      if (g[i] == null) continue;
      const j = s.indexOf(g[i]);
      if (j !== -1) {
        res[i] = "present";
        s[j] = null;
      }
    }

    return res;
  }

  function isValidWord(guess) {
    if (!/^[A-Z]{5}$/.test(guess)) return false;
    return dict ? dict.has(guess) : true;
  }

  // ===== Guess buffer =====
  function getGuess() {
    return currentGuess.join("");
  }

  function isRowFilled() {
    return currentGuess.every((ch) => ch && ch.length === 1);
  }

  // ===== Flip =====
  function wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  const FLIP_HALF_MS = 200;
  const FLIP_STAGGER_MS = 160;

  async function flipReveal(blockEl, stateClass, delayMs) {
    if (!blockEl) return;
    await wait(delayMs);

    const a1 = blockEl.animate(
      [{ transform: "rotateX(0deg)" }, { transform: "rotateX(90deg)" }],
      { duration: FLIP_HALF_MS, easing: "ease-in", fill: "forwards" }
    );
    await a1.finished;

    blockEl.classList.remove("absent", "present", "correct", "cursor", "active-row");
    blockEl.classList.add(stateClass);

    const a2 = blockEl.animate(
      [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }],
      { duration: FLIP_HALF_MS, easing: "ease-out", fill: "forwards" }
    );
    await a2.finished;

    blockEl.style.transform = "";
  }

  async function applyResultWithFlip(bi, r, guess, res) {
    for (let c = 0; c < WORD_LEN; c++) paintKey(guess[c], res[c]);

    const tasks = [];
    for (let c = 0; c < WORD_LEN; c++) {
      tasks.push(flipReveal(blockAt(bi, r, c), res[c], c * FLIP_STAGGER_MS));
    }
    await Promise.all(tasks);
  }

  // ===== Entrada =====
  function addLetter(ch) {
    if (gameOver || isRevealing) return;
    const L = normalize(ch);
    if (!/^[A-Z]$/.test(L)) return;

    currentGuess[cursor] = L;

    for (let bi = 0; bi < BOARD_COUNT; bi++) {
      if (!boards[bi].solved) setBlock(bi, attempt, cursor, L);
    }

    if (cursor < WORD_LEN - 1) cursor++;
    updateActiveStyles();
  }

  function backspace() {
    if (gameOver || isRevealing) return;

    if (currentGuess[cursor]) {
      currentGuess[cursor] = "";
      for (let bi = 0; bi < BOARD_COUNT; bi++) {
        if (!boards[bi].solved) clearBlock(bi, attempt, cursor);
      }
    } else if (cursor > 0) {
      cursor--;
      currentGuess[cursor] = "";
      for (let bi = 0; bi < BOARD_COUNT; bi++) {
        if (!boards[bi].solved) clearBlock(bi, attempt, cursor);
      }
    }

    updateActiveStyles();
  }

  function moveCursor(delta) {
    if (gameOver || isRevealing) return;
    cursor = Math.max(0, Math.min(WORD_LEN - 1, cursor + delta));
    updateActiveStyles();
  }

  function endGame(message) {
    gameOver = true;
    updateActiveStyles();
    if (restartBtn) restartBtn.hidden = false;
    setTimeout(() => alert(message), 50);
  }

  function pickSecrets(count) {
    // tenta pegar palavras distintas; se a lista for pequena, permite repetição
    if (!words.length) {
      const fallback = ["CASAS", "PEDRA", "NUVEM", "TERRA"];
      return Array.from({ length: count }, (_, i) => fallback[i % fallback.length]);
    }

    const picks = [];
    const used = new Set();

    const maxTries = 5000;
    let tries = 0;

    while (picks.length < count && tries < maxTries) {
      tries++;
      const w = words[Math.floor(Math.random() * words.length)];
      if (words.length >= count) {
        if (used.has(w)) continue;
        used.add(w);
      }
      picks.push(w);
    }

    // se não deu pra completar (lista pequena), completa com aleatório
    while (picks.length < count) {
      picks.push(words[Math.floor(Math.random() * words.length)]);
    }

    return picks;
  }

  function resetAllBlocks() {
    for (let bi = 0; bi < BOARD_COUNT; bi++) {
      boards[bi].solved = false;
      boards[bi].blocks.forEach((b) => {
        b.textContent = "";
        b.dataset.letter = "";
        b.classList.remove("correct", "present", "absent", "cursor", "active-row", "locked");
        b.style.transform = "";
      });
    }
  }

  function newGame() {
    attempt = 0;
    cursor = 0;
    gameOver = false;
    isRevealing = false;

    currentGuess = Array(WORD_LEN).fill("");

    resetAllBlocks();

    keys.forEach((k) => k.classList.remove("correct", "present", "absent"));
    keyState.clear();

    const secrets = pickSecrets(BOARD_COUNT);
    for (let bi = 0; bi < BOARD_COUNT; bi++) boards[bi].secret = secrets[bi];

    if (restartBtn) restartBtn.hidden = true;
    updateActiveStyles();
  }

  async function submit() {
    if (gameOver || isRevealing) return;

    if (!isRowFilled()) {
      shakeRow(attempt);
      return;
    }

    const guess = getGuess();
    if (!isValidWord(guess)) {
      shakeRow(attempt);
      return;
    }

    isRevealing = true;

    const tasks = [];
    for (let bi = 0; bi < BOARD_COUNT; bi++) {
      if (boards[bi].solved) continue;

      const res = evaluate(guess, boards[bi].secret);
      tasks.push(applyResultWithFlip(bi, attempt, guess, res));

      if (guess === boards[bi].secret) boards[bi].solved = true;
    }

    await Promise.all(tasks);
    isRevealing = false;

    if (boards.every((b) => b.solved)) {
      endGame("Você acertou as QUATRO! 🎉🎉🎉🎉");
      return;
    }

    attempt++;
    cursor = 0;
    currentGuess = Array(WORD_LEN).fill("");

    if (attempt >= MAX_ATTEMPTS) {
      endGame(`Fim de jogo! As palavras eram: ${boards.map(b => b.secret).join(", ")}`);
      return;
    }

    updateActiveStyles();
  }

  function handleInput(input) {
    if (gameOver || isRevealing) return;

    if (input === "ENTER") return submit();
    if (input === "BACKSPACE") return backspace();
    addLetter(input);
  }

  // ===== Teclado físico =====
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Backspace", "Enter"].includes(e.key)) {
      e.preventDefault();
    }

    if (e.key === "ArrowLeft") return moveCursor(-1);
    if (e.key === "ArrowRight") return moveCursor(1);

    if (e.key === "Enter") return handleInput("ENTER");
    if (e.key === "Backspace") return handleInput("BACKSPACE");

    if (e.key.length === 1) handleInput(e.key);
  });

  // ===== Teclado na tela =====
  keys.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (gameOver || isRevealing) return;
      const label = btn.textContent.trim();
      if (label.toUpperCase() === "ENTER") return handleInput("ENTER");
      if (label === "⌫") return handleInput("BACKSPACE");
      handleInput(label);
    });
  });

  if (restartBtn) restartBtn.addEventListener("click", newGame);

  // ===== Carregar lista =====
  async function loadWords() {
    try {
      const resp = await fetch(WORDLIST_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const txt = await resp.text();

      words = txt
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => normalize(w))
        .filter((w) => w.length === WORD_LEN && /^[A-Z]{5}$/.test(w));

      dict = new Set(words);
    } catch (err) {
      dict = null;
      words = [];
      console.warn("Não consegui carregar a lista de palavras, usando fallback.", err);
    }

    newGame();
  }

  updateActiveStyles();
  loadWords();
})();
